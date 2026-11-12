"""Compose connector delivery with unchanged fixed/reference/text readiness."""
from contextlib import asynccontextmanager
from fastapi.responses import JSONResponse
from recorded_application import app
from connector_worker import lifespan as connector_lifespan, queue_ready

existing_lifespan = app.router.lifespan_context


@asynccontextmanager
async def lifespan(application):
    async with existing_lifespan(application), connector_lifespan(application):
        yield


app.router.lifespan_context = lifespan


@app.middleware('http')
async def connector_readiness(request, call_next):
    if request.url.path in ('/ready', '/health') and not await queue_ready():
        return JSONResponse({'status': 'unavailable', 'connectorConsumerReady': False}, status_code=503)
    return await call_next(request)
