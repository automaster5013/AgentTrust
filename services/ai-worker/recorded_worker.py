"""Dedicated recorded-text queue; never consumes fixed or reference-provider work."""
import asyncio
import contextlib
import json
import pathlib
import re
import time
from contextlib import asynccontextmanager
from uuid import UUID
from recorded_evaluator import evaluate, validate_sample, unavailable
from recorded_profiles import execution_profile

STREAM = 'STACK_RECORDED_TEXT_EVALUATIONS'
SUBJECT = 'stack.recorded-text-evaluations'
DURABLE = 'python-recorded-text-evaluator'
state = {'ready': False, 'connection': None}


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate recorded field')
        result[key] = value
    return result


def scoped_job(raw):
    if not isinstance(raw, bytes) or len(raw) > 4096:
        raise ValueError('Invalid recorded job size')
    value = json.loads(raw.decode('utf-8', errors='strict'), object_pairs_hook=unique_object,
                       parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Invalid recorded constant')))
    identifiers = ['runId', 'organizationId', 'projectId', 'campaignId', 'agentVersionId', 'datasetVersionId']
    fields = set(identifiers + ['scenario', 'provider', 'caseId', 'executionProfileSha256', 'recordedCase'])
    if not isinstance(value, dict) or set(value) != fields or value['scenario'] != 'quality' or value['provider'] != 'synthetic':
        raise ValueError('Invalid recorded job fields')
    for name in identifiers:
        if not isinstance(value[name], str) or str(UUID(value[name])) != value[name]:
            raise ValueError('Invalid recorded scope')
    fingerprint = value['executionProfileSha256']
    if not isinstance(fingerprint, str) or not re.fullmatch('[a-f0-9]{64}', fingerprint):
        raise ValueError('Invalid recorded profile')
    case = validate_sample(value['recordedCase'])
    if value['caseId'] != case['id']:
        raise ValueError('Recorded case ID differs')
    return value


async def process(message, client, token):
    try:
        body = scoped_job(message.data)
    except (ValueError, TypeError, UnicodeError):
        await message.term()
        return
    started = time.monotonic()
    if body['executionProfileSha256'] != execution_profile()['contentSha256']:
        result = unavailable()
    else:
        result = evaluate(body['recordedCase'])
        if time.monotonic() - started >= 1:
            result = unavailable()
    # Bounded local evaluation makes no reservation or inference request.
    response = await client.post('/internal/completions', json={**body, 'result': result},
                                 headers={'X-AgentTrust-Worker-Token': token})
    if response.status_code == 200 and response.json().get('accepted') is True and response.json().get('runId') == body['runId']:
        await message.ack_sync(timeout=2)
    elif response.status_code in [400, 404, 409, 422]:
        await message.term()
    else:
        await message.nak(delay=3)


async def consume(connection, subscription):
    import httpx
    import nats
    async with httpx.AsyncClient(base_url='http://stack-core-api:8080', timeout=5, follow_redirects=False, trust_env=False) as client:
        token = pathlib.Path('/run/secrets/stack-worker-token').read_text(encoding='utf-8')
        if not re.fullmatch('[a-f0-9]{64}', token):
            raise RuntimeError('Recorded completion configuration unavailable')
        while True:
            state['ready'] = connection.is_connected
            try:
                messages = await subscription.fetch(batch=1, timeout=2)
            except nats.errors.TimeoutError:
                continue
            except Exception:
                state['ready'] = False
                await asyncio.sleep(1)
                continue
            for message in messages:
                try:
                    await process(message, client, token)
                except Exception:
                    with contextlib.suppress(Exception):
                        await message.nak(delay=3)


async def queue_ready():
    from nats.js.api import AckPolicy
    connection = state['connection']
    if not state['ready'] or connection is None or not connection.is_connected:
        return False
    try:
        async with asyncio.timeout(1):
            info = await connection.jetstream(timeout=0.4).consumer_info(STREAM, DURABLE)
            config = info.config
            return (state['connection'] is connection and state['ready'] is True and connection.is_connected
                    and info.stream_name == STREAM and info.name == DURABLE and config.durable_name == DURABLE
                    and config.filter_subject == SUBJECT and config.ack_policy == AckPolicy.EXPLICIT
                    and config.ack_wait == 15 and config.max_deliver == 20 and config.max_ack_pending == 8)
    except Exception:
        return False


@asynccontextmanager
async def lifespan(application):
    import nats
    from nats.js.api import AckPolicy, ConsumerConfig, RetentionPolicy, StorageType, StreamConfig
    token = pathlib.Path('/run/secrets/stack-nats-token').read_text(encoding='utf-8')
    if not re.fullmatch('[a-f0-9]{64}', token):
        raise RuntimeError('Recorded queue configuration unavailable')
    connection = await nats.connect('nats://stack-nats:4222', token=token, connect_timeout=2, max_reconnect_attempts=-1)
    state['connection'] = connection
    task = None
    try:
        stream = connection.jetstream()
        config = StreamConfig(name=STREAM, subjects=[SUBJECT], retention=RetentionPolicy.WORK_QUEUE, storage=StorageType.FILE,
                              max_msgs=10000, max_bytes=16*1024*1024, max_msg_size=4096, max_age=86400, duplicate_window=120)
        try:
            existing = await stream.stream_info(STREAM)
            if existing.config.subjects != [SUBJECT] or existing.config.max_msg_size != 4096 or existing.config.retention != RetentionPolicy.WORK_QUEUE:
                raise RuntimeError('Recorded stream configuration differs')
        except nats.js.errors.NotFoundError:
            await stream.add_stream(config=config)
        subscription = await stream.pull_subscribe(SUBJECT, durable=DURABLE, stream=STREAM,
            config=ConsumerConfig(durable_name=DURABLE, ack_policy=AckPolicy.EXPLICIT, ack_wait=15, max_deliver=20, max_ack_pending=8))
        task = asyncio.create_task(consume(connection, subscription))
        task.add_done_callback(lambda _: state.update(ready=False))
        state['ready'] = True
        yield
    finally:
        state.update(ready=False, connection=None)
        if task is not None:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        await connection.close()
