"""Bounded synthetic evaluator. No provider calls, code execution, or caller-selected URLs."""
import hmac
import asyncio
import contextlib
import json
import os
import pathlib
import re
from typing import Literal
from uuid import UUID
from contextlib import asynccontextmanager
import httpx
import nats
from nats.js.api import AckPolicy, ConsumerConfig, RetentionPolicy, StorageType, StreamConfig

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from features import rule_features, VERSION, DIMENSIONS
from telemetry import configure,evaluation_event
from providers import evaluate_provider,unavailable

worker_state = {'ready': False}


def scoped_job(raw: bytes):
    if len(raw) > 4096:
        raise ValueError('Oversized job')
    body = EvaluationRequest.model_validate_json(raw)
    for value in (body.runId, body.organizationId, body.projectId):
        if str(UUID(value)) != value:
            raise ValueError('Invalid job scope')
    return body


async def consume(connection, subscription):
    async with httpx.AsyncClient(timeout=5, follow_redirects=False, trust_env=False) as client:
        token = pathlib.Path('/run/secrets/stack-worker-token').read_text(encoding='utf-8')
        while True:
            worker_state['ready'] = connection.is_connected
            try:
                messages = await subscription.fetch(batch=1, timeout=2)
            except nats.errors.TimeoutError:
                continue
            except Exception:
                worker_state['ready'] = False
                await asyncio.sleep(1)
                continue
            worker_state['ready'] = connection.is_connected
            for message in messages:
                try:
                    body = scoped_job(message.data)
                except (ValueError, TypeError):
                    with contextlib.suppress(Exception):
                        await message.term()
                    continue
                try:
                    if body.provider=='synthetic':result=evaluate(body.scenario)
                    else:
                        # A lost reservation response burns the reservation. Never repeat an ambiguous provider call.
                        reservation=await client.post('http://stack-core-api:8080/internal/provider-reservations',json=body.model_dump(),headers={'X-AgentTrust-Worker-Token':token})
                        accepted=reservation.status_code==200 and reservation.json().get('allowed') is True and reservation.json().get('runId')==body.runId and reservation.json().get('reservedInputTokens')==256 and reservation.json().get('reservedOutputTokens')==128
                        if accepted:
                            evaluation_event()
                            result=await evaluate_provider(body.provider,body.scenario,client)
                        else:result=unavailable(body.provider)
                    payload = {**body.model_dump(), 'result': result}
                    response = await client.post('http://stack-core-api:8080/internal/completions', json=payload, headers={'X-AgentTrust-Worker-Token': token})
                    if response.status_code == 200 and response.json().get('accepted') is True and response.json().get('runId') == body.runId:
                        await message.ack_sync(timeout=2)
                    elif response.status_code in (400, 404, 409, 422):
                        await message.term()
                    else:
                        await message.nak(delay=3)
                except Exception:
                    with contextlib.suppress(Exception):
                        await message.nak(delay=3)


@asynccontextmanager
async def lifespan(application):
    token = pathlib.Path('/run/secrets/stack-nats-token').read_text(encoding='utf-8')
    if not re.fullmatch('[a-f0-9]{64}', token):
        raise RuntimeError('Queue configuration unavailable')
    connection = await nats.connect('nats://stack-nats:4222', token=token, connect_timeout=2, max_reconnect_attempts=-1)
    stream = connection.jetstream()
    configuration = StreamConfig(name='STACK_EVALUATIONS', subjects=['stack.evaluations'], retention=RetentionPolicy.WORK_QUEUE, storage=StorageType.FILE, max_msgs=10000, max_bytes=16*1024*1024, max_msg_size=4096, max_age=86400, duplicate_window=120)
    try:
        await stream.stream_info('STACK_EVALUATIONS')
    except nats.js.errors.NotFoundError:
        await stream.add_stream(config=configuration)
    subscription = await stream.pull_subscribe('stack.evaluations', durable='python-evaluator', stream='STACK_EVALUATIONS', config=ConsumerConfig(durable_name='python-evaluator', ack_policy=AckPolicy.EXPLICIT, ack_wait=15, max_deliver=20, max_ack_pending=32))
    task = asyncio.create_task(consume(connection, subscription))
    task.add_done_callback(lambda completed: worker_state.update(ready=False))
    worker_state['ready'] = True
    try:
        yield
    finally:
        worker_state['ready'] = False
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
        await connection.close()


app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
configure(app)


class EvaluationRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    scenario: Literal['pass', 'block', 'missing_evidence', 'error']
    runId: str
    organizationId: str
    projectId: str
    provider: Literal['synthetic','ollama','openai','openai-compatible']='synthetic'


def evaluate(scenario: str) -> dict:
    evaluation_event()
    outcomes = {
        'pass': ('succeeded', 'pass', 'pass', 'Synthetic output satisfies the requirement.'),
        'block': ('succeeded', 'block', 'fail', 'A required rule failed.'),
        'missing_evidence': ('succeeded', 'inconclusive', 'inconclusive', 'Required evidence is missing.'),
        'error': ('failed', 'inconclusive', 'inconclusive', 'Synthetic execution failed.'),
    }
    state, decision, status, reason = outcomes[scenario]
    return {'state': state, 'decision': decision, 'rules': [
        {'id': 'required-output', 'required': True, 'status': status, 'reason': reason}
    ], 'executionEngine': 'python-synthetic'}


@app.middleware('http')
async def bounded_request(request: Request, call_next):
    if request.method == 'POST':
        content_type = request.headers.get('content-type', '').split(';')[0]
        if content_type != 'application/json':
            return JSONResponse({'code': 'INVALID_REQUEST'}, status_code=415)
        body = b''
        async for part in request.stream():
            body += part
            if len(body) > 4096:
                return JSONResponse({'code': 'REQUEST_TOO_LARGE'}, status_code=413)
        request._body = body
    return await call_next(request)


def authorized(token: str | None):
    path = pathlib.Path(os.environ.get('STACK_WORKER_TOKEN_FILE', '/run/secrets/stack-worker-token'))
    expected = path.read_text(encoding='utf-8')
    if not re.fullmatch('[a-f0-9]{64}', expected):
        raise HTTPException(503, detail='Worker configuration unavailable')
    if token is None or not hmac.compare_digest(token, expected):
        raise HTTPException(401, detail='Authentication required')


@app.get('/health')
def health():
    if not worker_state['ready']:
        raise HTTPException(503, detail='Consumer unavailable')
    return {'status': 'UP', 'runtime': 'python-fastapi'}


@app.post('/evaluate')
def evaluation(body: EvaluationRequest, x_agenttrust_worker_token: str | None = Header(default=None)):
    authorized(x_agenttrust_worker_token)
    if body.provider!='synthetic':raise HTTPException(422,detail='Provider execution requires durable reservation')
    for value in (body.runId, body.organizationId, body.projectId):
        try:
            if str(UUID(value)) != value:
                raise ValueError()
        except ValueError:
            raise HTTPException(422, detail='Invalid scope') from None
    return {**body.model_dump(), 'result': evaluate(body.scenario)}


class FeatureRule(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    id: str = Field(min_length=1, max_length=100)
    required: bool
    status: Literal['pass', 'fail', 'inconclusive']
    reason: str = Field(max_length=500)


class FeatureResult(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    state: Literal['succeeded', 'failed']
    decision: Literal['pass', 'block', 'inconclusive']
    executionEngine: Literal['python-synthetic', 'python-unavailable', 'java-synthetic','python-ollama','python-openai','python-openai-compatible']
    rules: list[FeatureRule] = Field(min_length=1, max_length=100)


class FeatureRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    runId: str
    organizationId: str
    projectId: str
    contentSha256: str = Field(pattern=r'^[a-f0-9]{64}$')
    result: FeatureResult


@app.post('/features')
def features(body: FeatureRequest, x_agenttrust_worker_token: str | None = Header(default=None)):
    authorized(x_agenttrust_worker_token)
    for value in (body.runId, body.organizationId, body.projectId):
        try:
            if str(UUID(value)) != value:
                raise ValueError()
        except ValueError:
            raise HTTPException(422, detail='Invalid scope') from None
    return {'runId': body.runId, 'organizationId': body.organizationId, 'projectId': body.projectId,
            'contentSha256': body.contentSha256, 'featureVersion': VERSION, 'dimensions': DIMENSIONS,
            'vector': rule_features(body.result.model_dump())}
