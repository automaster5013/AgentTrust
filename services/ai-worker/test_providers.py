import asyncio,json
import httpx,pytest
from providers import evaluate_provider,strict_json,MODEL,MODEL_DIGEST,SOURCE_MANIFEST_DIGEST,MAX_OUTPUT_TOKENS

def execute(provider,scenario,handler):
 async def run():
  async with httpx.AsyncClient(transport=httpx.MockTransport(handler),follow_redirects=False,trust_env=False) as client:return await evaluate_provider(provider,scenario,client)
 return asyncio.run(run())

def inventory(request):return httpx.Response(200,json={'models':[{'name':MODEL,'digest':SOURCE_MANIFEST_DIGEST.removeprefix('sha256:')}]})

@pytest.mark.parametrize('output,decision',[('{"answer":"READY"}','pass'),('{"answer":"DENIED"}','block'),('{}','inconclusive')])
def test_actual_output_determines_verdict(output,decision):
 requests=[]
 def handler(request):
  requests.append(request)
  if request.url.path=='/api/tags':return inventory(request)
  body=json.loads(request.content);assert body['stream'] is False and body['options']['num_predict']==MAX_OUTPUT_TOKENS and body['think'] is False
  return httpx.Response(200,json={'model':MODEL,'response':output,'done':True,'done_reason':'stop','eval_count':12})
 result=execute('ollama','pass',handler);assert result['decision']==decision and result['executionEngine']=='python-ollama' and len(requests)==2 and output not in json.dumps(result)

@pytest.mark.parametrize('failure',['redirect','too-large','truncated','digest','duplicate','tool','missing-usage','error'])
def test_faults_never_fallback_or_allow(failure):
 requests=[]
 def handler(request):
  requests.append(request)
  if request.url.path=='/api/tags':return httpx.Response(200,json={'models':[]}) if failure=='digest' else inventory(request)
  if failure=='redirect':return httpx.Response(302,headers={'location':'https://outside.invalid'})
  if failure=='too-large':return httpx.Response(200,content=b'x'*8193,headers={'content-type':'application/json'})
  if failure=='error':raise httpx.ReadTimeout('Synthetic timeout')
  return httpx.Response(200,json={'model':MODEL,'response':'{"answer":"READY","answer":"READY"}' if failure=='duplicate' else '{"tool":"run"}' if failure=='tool' else '{"answer":"READY"}','done':True,'done_reason':'length' if failure=='truncated' else 'stop','eval_count':None if failure=='missing-usage' else 12})
 result=execute('ollama','pass',handler);assert result['state']=='failed' and result['decision']=='inconclusive' and result['executionEngine']=='python-ollama' and len(requests)<=2

def test_paid_provider_disabled_without_explicit_configuration(monkeypatch):
 monkeypatch.delenv('STACK_ENABLE_PAID_PROVIDERS',raising=False)
 def forbidden(request):raise AssertionError('Disabled provider made a network request')
 assert execute('openai','pass',forbidden)['decision']=='inconclusive'

def test_duplicate_json_is_rejected():
 with pytest.raises(ValueError):strict_json('{"a":1,"a":2}')

def test_compatible_chat_contract(monkeypatch):
 monkeypatch.setenv('STACK_ENABLE_PAID_PROVIDERS','true')
 def handler(request):
  if request.url.path=='/api/tags':return inventory(request)
  assert request.url.host=='stack-ollama' and request.url.path=='/v1/chat/completions';body=json.loads(request.content);assert body['max_tokens']==128 and body['stream'] is False and body['reasoning_effort']=='none' and body['response_format']=={'type':'json_object'}
  return httpx.Response(200,json={'model':MODEL,'choices':[{'finish_reason':'stop','message':{'role':'assistant','content':'{"answer":"READY"}'}}],'usage':{'completion_tokens':12}})
 assert execute('openai-compatible','pass',handler)['decision']=='pass'

def test_openai_responses_contract_and_incomplete_refusal(monkeypatch):
 import providers,secrets
 key=secrets.token_hex(32)
 monkeypatch.setattr(providers,'profile',lambda provider:('https://api.openai.com','fixture-model',key))
 def handler(request):
  assert request.url==httpx.URL('https://api.openai.com/v1/responses') and request.headers['authorization']=='Bearer '+key
  body=json.loads(request.content);assert body['store'] is False and body['max_output_tokens']==128 and body['tools']==[] and 'previous_response_id' not in body
  return httpx.Response(200,json={'status':'completed','model':'fixture-model','usage':{'output_tokens':12},'output':[{'type':'message','role':'assistant','content':[{'type':'output_text','text':'{"answer":"READY"}'}]}]})
 assert execute('openai','pass',handler)['decision']=='pass'
 def incomplete(request):return httpx.Response(200,json={'status':'incomplete','model':'fixture-model','usage':{'output_tokens':128},'output':[]})
 assert execute('openai','pass',incomplete)['decision']=='inconclusive'
