"""Read-only queue readiness without changing versioned evaluator sources."""
import asyncio
import contextlib
import pathlib
from contextlib import asynccontextmanager
import nats
from nats.js.api import AckPolicy
from fastapi.responses import JSONResponse
from quality_application import app
from app import worker_state
from quality_worker import state as reference_state

CONSUMERS = (
    ('STACK_EVALUATIONS', 'python-evaluator', 'stack.evaluations', 32),
    ('STACK_QUALITY_EVALUATIONS', 'python-reference-evaluator', 'stack.quality-evaluations', 8),
)
inspection = {'connection': None}
evaluator_lifespan = app.router.lifespan_context

@asynccontextmanager
async def lifespan(application):
    async with evaluator_lifespan(application):
        connection = await nats.connect('nats://stack-nats:4222',
            token=pathlib.Path('/run/secrets/stack-nats-token').read_text(encoding='utf-8'),
            connect_timeout=2, max_reconnect_attempts=-1)
        inspection['connection'] = connection
        try:
            yield
        finally:
            inspection['connection'] = None
            with contextlib.suppress(Exception):
                async with asyncio.timeout(2):
                    await connection.close()

async def queue_ready(connection, fixed_ready, reference_ready):
    if not fixed_ready or not reference_ready or connection is None or not connection.is_connected:
        return False
    try:
        async with asyncio.timeout(1):
            stream = connection.jetstream(timeout=0.4)
            for stream_name, durable, subject, pending in CONSUMERS:
                info = await stream.consumer_info(stream_name, durable)
                config = info.config
                if (info.stream_name != stream_name or info.name != durable
                    or config.durable_name != durable or config.filter_subject != subject
                    or config.ack_policy != AckPolicy.EXPLICIT or config.ack_wait != 15
                    or config.max_deliver != 20 or config.max_ack_pending != pending):
                    return False
        return True
    except Exception:
        return False

app.router.lifespan_context = lifespan

@app.get('/ready')
async def ready():
    available = await queue_ready(inspection['connection'], worker_state['ready'], reference_state['ready'])
    return JSONResponse({'contract': 'agenttrust-worker-readiness-v1', 'ready': available,
        'fixedConsumerReady': worker_state['ready'] is True,
        'referenceConsumerReady': reference_state['ready'] is True,
        'queueReady': available}, status_code=200 if available else 503)
