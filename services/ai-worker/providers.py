"""Fixed prompts and server-owned provider profiles. No user-selected URL, tools or retries."""
import asyncio,hashlib,json,os,pathlib,re
import httpx

MODEL='qwen3:0.6b'
MODEL_DIGEST='sha256:6f76d4346c34ba89df6e137fb661b4bb4daf322c1151b6ef0dfda981070a851f'
SOURCE_MANIFEST_DIGEST='sha256:7df6b6e09427a769808717c0a93cadc4ae99ed4eb8bf5ca557c90846becea435'
PROMPTS={'pass':'Return only this JSON object: {"answer":"READY"}. /no_think','block':'Return only this JSON object: {"answer":"DENIED"}. /no_think','missing_evidence':'Return only an empty JSON object: {}. /no_think'}
MAX_OUTPUT_TOKENS=128
LOCAL_PROVIDER_TIMEOUT=60
PAID_PROVIDER_TIMEOUT=20
def strict_json(raw):
 def pairs(items):
  value={}
  for key,item in items:
   if key in value:raise ValueError('Duplicate JSON field')
   value[key]=item
  return value
 return json.loads(raw,object_pairs_hook=pairs,parse_constant=lambda _:(_ for _ in ()).throw(ValueError('Non-finite JSON')))

async def bounded_json(client,url,body=None,headers=None):
 async with client.stream('POST' if body is not None else 'GET',url,json=body,headers=headers,timeout=httpx.Timeout(LOCAL_PROVIDER_TIMEOUT if url.startswith('http://stack-ollama:11434/') else PAID_PROVIDER_TIMEOUT,connect=2,write=2,pool=2)) as response:
  if response.status_code!=200 or response.headers.get('content-type','').split(';')[0]!='application/json':raise ValueError('Provider unavailable')
  raw=b''
  async for chunk in response.aiter_bytes():
   raw+=chunk
   if len(raw)>8192:raise ValueError('Provider response too large')
  value=strict_json(raw)
  if not isinstance(value,dict):raise ValueError('Invalid provider response')
  return value

def profile(provider):
 if provider=='ollama':return ('http://stack-ollama:11434',MODEL,None)
 if provider not in ['openai','openai-compatible'] or provider=='openai' and os.environ.get('STACK_ENABLE_PAID_PROVIDERS')!='true':raise ValueError('Provider disabled')
 # A separately configured egress profile is required; process environment never chooses arbitrary hosts.
 if provider=='openai':url='https://api.openai.com';model=os.environ.get('STACK_OPENAI_MODEL','');key_file='/run/secrets/stack-openai-key'
 else:url='http://stack-ollama:11434';model=MODEL;key_file=None
 if not re.fullmatch(r'[A-Za-z0-9._:-]{1,100}',model):raise ValueError('Provider model unavailable')
 key=pathlib.Path(key_file).read_text(encoding='utf-8').strip() if key_file else None
 if key is not None and (not 20<len(key)<512 or any(ord(c)<33 or ord(c)>126 for c in key)):raise ValueError('Provider credential unavailable')
 return url,model,key

async def generate(provider,scenario,client):
 url,model,key=profile(provider)
 prompt=PROMPTS[scenario]
 if len(prompt.encode('utf-8'))>256:raise ValueError('Input budget exceeded')
 headers={'Authorization':'Bearer '+key} if key else None
 if provider in ['ollama','openai-compatible']:
  inventory=await bounded_json(client,url+'/api/tags')
  if not any(row.get('name')==MODEL and row.get('digest')==SOURCE_MANIFEST_DIGEST.removeprefix('sha256:') for row in inventory.get('models',[])):raise ValueError('Model digest mismatch')
 if provider=='ollama':
  value=await bounded_json(client,url+'/api/generate',{'model':model,'prompt':prompt,'stream':False,'think':False,'format':'json','keep_alive':0,'options':{'num_predict':MAX_OUTPUT_TOKENS,'num_ctx':1024,'num_thread':2,'temperature':0,'seed':1}})
  if value.get('done') is not True or value.get('done_reason')!='stop' or value.get('model')!=model or type(value.get('eval_count')) is not int or not 0<value['eval_count']<=MAX_OUTPUT_TOKENS:raise ValueError('Incomplete provider output')
  output=value['response']
 elif provider=='openai':
  value=await bounded_json(client,url+'/v1/responses',{'model':model,'input':prompt,'max_output_tokens':MAX_OUTPUT_TOKENS,'store':False,'stream':False,'tools':[]},headers)
  if value.get('status')!='completed' or value.get('model')!=model or type(value.get('usage',{}).get('output_tokens')) is not int or not 0<value['usage']['output_tokens']<=MAX_OUTPUT_TOKENS:raise ValueError('Incomplete provider output')
  messages=value.get('output',[])
  if len(messages)!=1 or messages[0].get('type')!='message' or messages[0].get('role')!='assistant':raise ValueError('Unsupported provider output')
  content=messages[0].get('content',[])
  if len(content)!=1 or content[0].get('type')!='output_text':raise ValueError('Missing output')
  output=content[0]['text']
 else:
  value=await bounded_json(client,url+'/v1/chat/completions',{'model':model,'messages':[{'role':'user','content':prompt}],'max_tokens':MAX_OUTPUT_TOKENS,'stream':False,'temperature':0,'seed':1,'reasoning_effort':'none','response_format':{'type':'json_object'}},headers)
  choices=value.get('choices',[])
  if len(choices)!=1 or choices[0].get('finish_reason')!='stop' or value.get('model')!=model or type(value.get('usage',{}).get('completion_tokens')) is not int or not 0<value['usage']['completion_tokens']<=MAX_OUTPUT_TOKENS:raise ValueError('Incomplete provider output')
  message=choices[0]['message']
  if message.get('role')!='assistant' or message.get('tool_calls'):raise ValueError('Unsupported tool output')
  output=message['content']
 if not isinstance(output,str) or len(output.encode())>2048:raise ValueError('Invalid generated output')
 generated=strict_json(output)
 if not isinstance(generated,dict) or set(generated)-{'answer'} or 'answer' in generated and not isinstance(generated['answer'],str):raise ValueError('Invalid evidence schema')
 status='inconclusive' if not generated.get('answer') else 'pass' if generated['answer']=='READY' else 'fail'
 decision={'pass':'pass','fail':'block','inconclusive':'inconclusive'}[status]
 return {'state':'succeeded','decision':decision,'executionEngine':'python-'+provider,'rules':[{'id':'required-output','required':True,'status':status,'reason':'Fixed JSON answer requirement evaluated; raw model text is not retained.'},{'id':'provider-model','required':False,'status':'pass','reason':provider+' / '+model+(' / '+MODEL_DIGEST+' / source '+SOURCE_MANIFEST_DIGEST if provider!='openai' else '')},{'id':'output-sha256','required':False,'status':'pass','reason':hashlib.sha256(output.encode()).hexdigest()}]}

def unavailable(provider):
 return {'state':'failed','decision':'inconclusive','executionEngine':'python-'+provider,'rules':[{'id':'provider-availability','required':True,'status':'inconclusive','reason':'Provider configuration, budget, response or evidence was unavailable; no synthetic fallback.'}]}

async def evaluate_provider(provider,scenario,client):
 try:
  async with asyncio.timeout(LOCAL_PROVIDER_TIMEOUT if provider in ['ollama','openai-compatible'] else PAID_PROVIDER_TIMEOUT):return await generate(provider,scenario,client)
 except Exception:return unavailable(provider)
