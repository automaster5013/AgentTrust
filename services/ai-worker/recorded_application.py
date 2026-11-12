"""Compose recorded-text delivery with the unchanged fixed/reference readiness app."""
from contextlib import asynccontextmanager
from fastapi.responses import JSONResponse
from operations_application import app
from recorded_worker import lifespan as recorded_lifespan, queue_ready

existing_lifespan = app.router.lifespan_context


@asynccontextmanager
async def lifespan(application):
    async with existing_lifespan(application), recorded_lifespan(application):
        yield


app.router.lifespan_context = lifespan


@app.middleware('http')
async def recorded_readiness(request, call_next):
    if request.url.path in ('/ready', '/health') and not await queue_ready():
        return JSONResponse({'status': 'unavailable', 'recordedConsumerReady': False}, status_code=503)
    return await call_next(request)
