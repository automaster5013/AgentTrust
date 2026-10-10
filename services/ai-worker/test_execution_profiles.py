import asyncio,json,pathlib
import httpx,pytest
from app import consume,scoped_job
from execution_profiles import execution_profile,matches_profile,canonical
from uuid import uuid4

def test_actual_model_prompt_and_timeout_changes_cannot_reuse_profile(monkeypatch):
 import providers
 original=execution_profile('ollama')['contentSha256'];assert matches_profile('ollama',original)
 monkeypatch.setattr(providers,'MODEL','changed-model');assert not matches_profile('ollama',original)
 monkeypatch.setattr(providers,'MODEL','qwen3:0.6b');monkeypatch.setattr(providers,'LOCAL_PROVIDER_TIMEOUT',59);assert not matches_profile('ollama',original)
 monkeypatch.setattr(providers,'LOCAL_PROVIDER_TIMEOUT',60);monkeypatch.setattr(providers,'PROMPTS',{**providers.PROMPTS,'pass':'changed prompt'});assert not matches_profile('ollama',original)

def test_legacy_single_runs_remain_unbound_but_profile_only_jobs_are_refused():
 assert matches_profile('openai',None)
 body={key:str(uuid4()) for key in ['runId','organizationId','projectId']};body['scenario']='pass';body['executionProfileSha256']='0'*64
 with pytest.raises(ValueError):scoped_job(canonical(body))

def test_each_profile_binds_public_evaluator_source_and_verifier():
 for provider in ['synthetic','ollama','openai-compatible']:
  value=execution_profile(provider);assert len(value['contentSha256'])==64;definition=value['definition'];assert len(definition['implementationSha256'])==len(definition['profileVerifierSha256'])==64;assert definition['maxAttempts']==1 and not definition['callerSelectedUrlAllowed'];assert not matches_profile(provider,'0'*64)

def test_drifted_campaign_profile_fails_before_provider_reservation_or_model_call(monkeypatch):
 body={key:str(uuid4()) for key in ['runId','organizationId','projectId','campaignId','agentVersionId','datasetVersionId']};body.update(caseId='required-pass',scenario='pass',provider='ollama',executionProfileSha256='0'*64);calls=[]
 class Message:
  data=canonical(body)
  async def ack_sync(self,**kwargs):pass
  async def nak(self,**kwargs):raise AssertionError('Unexpected retry')
  async def term(self):raise AssertionError('Unexpected rejection')
 class Subscription:
  sent=False
  async def fetch(self,**kwargs):
   if self.sent:raise asyncio.CancelledError()
   self.sent=True;return [Message()]
 class Connection:is_connected=True
 def handler(request):
  calls.append(request.url.path);assert request.url.path=='/internal/completions';value=json.loads(request.content);assert value['executionProfileSha256']=='0'*64 and value['result']['state']=='failed' and value['result']['decision']=='inconclusive';return httpx.Response(200,json={'accepted':True,'runId':body['runId']})
 original_client=httpx.AsyncClient;original_read=pathlib.Path.read_text
 monkeypatch.setattr(pathlib.Path,'read_text',lambda self,*a,**kw:'a'*64 if str(self)=='/run/secrets/stack-worker-token' else original_read(self,*a,**kw))
 monkeypatch.setattr(httpx,'AsyncClient',lambda **kwargs:original_client(transport=httpx.MockTransport(handler),**kwargs))
 async def run():
  with pytest.raises(asyncio.CancelledError):await consume(Connection(),Subscription())
 asyncio.run(run());assert calls==['/internal/completions']
