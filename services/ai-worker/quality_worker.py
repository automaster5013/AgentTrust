"""Separate durable reference consumer; fixed-scenario source hashes remain unchanged."""
import asyncio,contextlib,json,pathlib,re
from contextlib import asynccontextmanager
from typing import Literal
from uuid import UUID
import httpx,nats
from nats.js.api import AckPolicy,ConsumerConfig,RetentionPolicy,StorageType,StreamConfig
from pydantic import BaseModel,ConfigDict,Field,model_validator
import providers
from app import maintain_delivery
from quality_evaluator import validate_case
from quality_profiles import execution_profile
from quality_provider import evaluate_reference
from telemetry import evaluation_event,evaluation_span,worker_headers

state={'ready':False}
class QualityCase(BaseModel):
 model_config=ConfigDict(extra='forbid',strict=True)
 input:str
 expected:str
 contentSha256:str=Field(pattern=r'^[a-f0-9]{64}$')
 @model_validator(mode='after')
 def bounded(self):validate_case(self.model_dump());return self

class QualityJob(BaseModel):
 model_config=ConfigDict(extra='forbid',strict=True)
 scenario:Literal['quality']
 provider:Literal['ollama','openai-compatible']
 runId:str
 organizationId:str
 projectId:str
 campaignId:str
 caseId:str=Field(pattern=r'^[a-z][a-z0-9-]{0,63}$')
 agentVersionId:str
 datasetVersionId:str
 executionProfileSha256:str=Field(pattern=r'^[a-f0-9]{64}$')
 qualityCase:QualityCase
 @model_validator(mode='after')
 def scoped(self):
  for item in [self.runId,self.organizationId,self.projectId,self.campaignId,self.agentVersionId,self.datasetVersionId]:
   if str(UUID(item))!=item:raise ValueError('Invalid reference scope')
  return self

def scoped_job(raw):
 if len(raw)>4096:raise ValueError('Oversized reference job')
 return QualityJob.model_validate(providers.strict_json(raw))

def current_profile(provider,fingerprint):
 constants={key:getattr(providers,key) for key in ['MODEL','MODEL_DIGEST','SOURCE_MANIFEST_DIGEST']}
 return execution_profile(provider,constants,fingerprint)

async def consume(connection,subscription,fingerprint):
 async with httpx.AsyncClient(base_url='http://stack-core-api:8080',timeout=5,follow_redirects=False,trust_env=False) as client:
  token=pathlib.Path('/run/secrets/stack-worker-token').read_text(encoding='utf-8')
  while True:
   state['ready']=connection.is_connected
   try:messages=await subscription.fetch(batch=1,timeout=2)
   except nats.errors.TimeoutError:continue
   except Exception:state['ready']=False;await asyncio.sleep(1);continue
   for message in messages:
    try:body=scoped_job(message.data)
    except (ValueError,TypeError):
     with contextlib.suppress(Exception):await message.term()
     continue
    try:
     with evaluation_span(getattr(message,'headers',None)):
      payload=body.model_dump()
      if current_profile(body.provider,fingerprint)['contentSha256']!=body.executionProfileSha256:result=providers.unavailable(body.provider)
      else:
       reservation=await client.post('/internal/provider-reservations',json=payload,headers=worker_headers(token))
       accepted=reservation.status_code==200 and reservation.json().get('allowed') is True and reservation.json().get('runId')==body.runId and reservation.json().get('reservedInputTokens')==256 and reservation.json().get('reservedOutputTokens')==128
       if accepted:
        evaluation_event()
        async with asyncio.timeout(2):await message.in_progress()
        heartbeat=asyncio.create_task(maintain_delivery(message))
        try:result=await evaluate_reference(body.provider,body.qualityCase.model_dump(),client,token,fingerprint)
        finally:
         heartbeat.cancel()
         with contextlib.suppress(asyncio.CancelledError):await heartbeat
       else:result=providers.unavailable(body.provider)
      response=await client.post('/internal/completions',json={**payload,'result':result},headers=worker_headers(token))
      if response.status_code==200 and response.json().get('accepted') is True and response.json().get('runId')==body.runId:await message.ack_sync(timeout=2)
      elif response.status_code in [400,404,409,422]:await message.term()
      else:await message.nak(delay=3)
    except Exception:
     with contextlib.suppress(Exception):await message.nak(delay=3)

@asynccontextmanager
async def lifespan(application):
 fingerprint=json.loads(pathlib.Path('/app/quality-validator-profile.json').read_text(encoding='utf-8'))['validatorProfileSha256']
 if not re.fullmatch('[a-f0-9]{64}',fingerprint):raise RuntimeError('Reference verifier configuration unavailable')
 token=pathlib.Path('/run/secrets/stack-nats-token').read_text(encoding='utf-8')
 if not re.fullmatch('[a-f0-9]{64}',token):raise RuntimeError('Reference queue configuration unavailable')
 connection=await nats.connect('nats://stack-nats:4222',token=token,connect_timeout=2,max_reconnect_attempts=-1)
 stream=connection.jetstream()
 config=StreamConfig(name='STACK_QUALITY_EVALUATIONS',subjects=['stack.quality-evaluations'],retention=RetentionPolicy.WORK_QUEUE,storage=StorageType.FILE,max_msgs=10000,max_bytes=16*1024*1024,max_msg_size=4096,max_age=86400,duplicate_window=120)
 try:await stream.stream_info(config.name)
 except nats.js.errors.NotFoundError:await stream.add_stream(config=config)
 subscription=await stream.pull_subscribe('stack.quality-evaluations',durable='python-reference-evaluator',stream=config.name,config=ConsumerConfig(durable_name='python-reference-evaluator',ack_policy=AckPolicy.EXPLICIT,ack_wait=15,max_deliver=20,max_ack_pending=8))
 task=asyncio.create_task(consume(connection,subscription,fingerprint));task.add_done_callback(lambda _:state.update(ready=False));state['ready']=True
 try:yield
 finally:
  state['ready']=False;task.cancel()
  with contextlib.suppress(asyncio.CancelledError):await task
  await connection.close()
