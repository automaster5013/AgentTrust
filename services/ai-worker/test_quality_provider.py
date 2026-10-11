import asyncio,json
import httpx,pytest
from providers import MODEL,SOURCE_MANIFEST_DIGEST
from quality_provider import evaluate_reference,PROMPT_PREFIX
from test_quality_evaluator import sample,proof

def execute(provider,case,handler):
 async def run():
  async with httpx.AsyncClient(transport=httpx.MockTransport(handler),follow_redirects=False,trust_env=False) as client:return await evaluate_reference(provider,case,client,'a'*64,'a'*64)
 return asyncio.run(run())

@pytest.mark.parametrize('provider',['ollama','openai-compatible'])
@pytest.mark.parametrize('passed',[True,False])
def test_actual_output_reaches_independent_verifier_without_reference_in_prompt(provider,passed):
 requests=[];case=sample('Return READY','PRIVATE_REFERENCE_CANARY');output='{"answer":"PRIVATE_REFERENCE_CANARY"}' if passed else '{"answer":"DENIED"}'
 def handler(request):
  requests.append(request);body=json.loads(request.content) if request.content else None
  assert request.url.host in ['stack-ollama','stack-quality-verifier']
  if request.url.path=='/api/tags':return httpx.Response(200,json={'models':[{'name':MODEL,'digest':SOURCE_MANIFEST_DIGEST.removeprefix('sha256:')}]})
  if request.url.path=='/grade':
   assert body=={'actual':output,'expected':case['expected'],'validatorProfileSha256':'a'*64};assert request.headers['x-agenttrust-worker-token']=='a'*64
   return httpx.Response(200,json=proof(passed))
  assert 'PRIVATE_REFERENCE_CANARY' not in request.content.decode()
  if provider=='ollama':
   assert body['prompt']==PROMPT_PREFIX+case['input'] and body['options']['num_predict']==128
   return httpx.Response(200,json={'model':MODEL,'response':output,'done':True,'done_reason':'stop','eval_count':12})
  assert body['messages'][0]['content']==PROMPT_PREFIX+case['input'] and body['max_tokens']==128
  return httpx.Response(200,json={'model':MODEL,'choices':[{'finish_reason':'stop','message':{'role':'assistant','content':output}}],'usage':{'completion_tokens':12}})
 result=execute(provider,case,handler)
 assert result['decision']==('pass' if passed else 'block') and result['executionEngine']=='python-'+provider
 assert len(requests)==3 and 'PRIVATE_REFERENCE_CANARY' not in json.dumps(result)

@pytest.mark.parametrize('failure',['digest','timeout','redirect','truncated','too-large','verifier','disagreement','hash'])
def test_failure_does_not_repeat_model_or_fallback(failure):
 requests=[]
 def handler(request):
  requests.append(request)
  if request.url.path=='/api/tags':return httpx.Response(200,json={'models':[] if failure=='digest' else [{'name':MODEL,'digest':SOURCE_MANIFEST_DIGEST.removeprefix('sha256:')}]})
  if request.url.path=='/grade':
   if failure=='verifier':return httpx.Response(503,json={'error':'unavailable'})
   return httpx.Response(200,json={**proof(failure!='disagreement'),**({'validatorProfileSha256':'b'*64} if failure=='hash' else {})})
  if failure=='timeout':raise httpx.ReadTimeout('PRIVATE_ERROR')
  if failure=='redirect':return httpx.Response(302,headers={'location':'http://outside.invalid'})
  return httpx.Response(200,json={'model':MODEL,'response':'x'*2049 if failure=='too-large' else '{"answer":"READY"}','done':True,'done_reason':'length' if failure=='truncated' else 'stop','eval_count':12})
 result=execute('ollama',sample(),handler)
 assert result['decision']=='inconclusive' and result['state']=='failed' and len(requests)<=3
 assert sum(request.url.path=='/api/generate' for request in requests)<=1

def test_paid_provider_and_tampered_case_fail_before_network():
 def forbidden(request):raise AssertionError('Unexpected request')
 assert execute('openai',sample(),forbidden)['decision']=='inconclusive'
 assert execute('ollama',{**sample(),'expected':'Changed'},forbidden)['decision']=='inconclusive'
