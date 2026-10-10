"""Bounded synthetic evaluator. No provider calls, code execution, or caller-selected URLs."""
import hmac
import os
import pathlib
import re
from typing import Literal
from uuid import UUID

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


class EvaluationRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    scenario: Literal['pass', 'block', 'missing_evidence', 'error']
    runId: str
    organizationId: str
    projectId: str


def evaluate(scenario: str) -> dict:
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
    return {'status': 'UP', 'runtime': 'python-fastapi'}


@app.post('/evaluate')
def evaluation(body: EvaluationRequest, x_agenttrust_worker_token: str | None = Header(default=None)):
    authorized(x_agenttrust_worker_token)
    for value in (body.runId, body.organizationId, body.projectId):
        try:
            if str(UUID(value)) != value:
                raise ValueError()
        except ValueError:
            raise HTTPException(422, detail='Invalid scope') from None
    return {**body.model_dump(), 'result': evaluate(body.scenario)}
