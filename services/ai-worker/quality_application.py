"""Compose both lifespans without altering the historical evaluator implementation."""
from contextlib import asynccontextmanager
from fastapi.responses import JSONResponse
from app import app,lifespan as fixed_lifespan
from quality_worker import lifespan as reference_lifespan,state

@asynccontextmanager
async def lifespan(application):
 async with fixed_lifespan(application),reference_lifespan(application):yield

app.router.lifespan_context=lifespan
@app.middleware('http')
async def reference_health(request,call_next):
 if request.url.path=='/health' and not state['ready']:return JSONResponse({'status':'unavailable'},status_code=503)
 return await call_next(request)
