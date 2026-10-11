"""Fixed local model transport for immutable, bounded reference-answer cases."""
import asyncio
import httpx
from providers import bounded_json,profile,MODEL,SOURCE_MANIFEST_DIGEST,MODEL_DIGEST,MAX_OUTPUT_TOKENS,LOCAL_PROVIDER_TIMEOUT,unavailable
from quality_evaluator import validate_case,agreement

PROMPT_PREFIX='Return JSON with one string field "answer". /no_think\n'
VERIFIER_URL='http://stack-quality-verifier:9105/grade'

async def generated_output(provider,case,client):
 if provider not in ['ollama','openai-compatible']:raise ValueError('Reference provider disabled')
 validate_case(case)
 url,model,_=profile(provider)
 prompt=PROMPT_PREFIX+case['input']
 if len(prompt.encode('utf-8'))>256:raise ValueError('Input reservation exceeded')
 inventory=await bounded_json(client,url+'/api/tags')
 if not any(row.get('name')==MODEL and row.get('digest')==SOURCE_MANIFEST_DIGEST.removeprefix('sha256:') for row in inventory.get('models',[])):raise ValueError('Model digest mismatch')
 if provider=='ollama':
  value=await bounded_json(client,url+'/api/generate',{'model':model,'prompt':prompt,'stream':False,'think':False,'format':'json','keep_alive':0,'options':{'num_predict':MAX_OUTPUT_TOKENS,'num_ctx':1024,'num_thread':2,'temperature':0,'seed':1}})
  if value.get('done') is not True or value.get('done_reason')!='stop' or value.get('model')!=model or type(value.get('eval_count')) is not int or not 0<value['eval_count']<=MAX_OUTPUT_TOKENS:raise ValueError('Incomplete provider output')
  output=value.get('response')
 else:
  value=await bounded_json(client,url+'/v1/chat/completions',{'model':model,'messages':[{'role':'user','content':prompt}],'max_tokens':MAX_OUTPUT_TOKENS,'stream':False,'temperature':0,'seed':1,'reasoning_effort':'none','response_format':{'type':'json_object'}})
  choices=value.get('choices',[])
  if len(choices)!=1 or choices[0].get('finish_reason')!='stop' or value.get('model')!=model or type(value.get('usage',{}).get('completion_tokens')) is not int or not 0<value['usage']['completion_tokens']<=MAX_OUTPUT_TOKENS:raise ValueError('Incomplete provider output')
  message=choices[0].get('message',{})
  if message.get('role')!='assistant' or message.get('tool_calls'):raise ValueError('Unsupported model output')
  output=message.get('content')
 if not isinstance(output,str) or len(output.encode('utf-8'))>2048:raise ValueError('Invalid generated output')
 return output

async def evaluate_reference(provider,case,client,token,fingerprint):
 try:
  async with asyncio.timeout(LOCAL_PROVIDER_TIMEOUT):
   output=await generated_output(provider,case,client)
   async with asyncio.timeout(17):
    proof=await bounded_json(client,VERIFIER_URL,{'actual':output,'expected':case['expected'],'validatorProfileSha256':fingerprint},{'X-AgentTrust-Worker-Token':token})
   result=agreement(output,case['expected'],proof,fingerprint,provider)
   result['rules'].append({'id':'provider-model','required':False,'status':'pass','reason':provider+' / '+MODEL+' / '+MODEL_DIGEST+' / source '+SOURCE_MANIFEST_DIGEST})
   return result
 except Exception:return unavailable(provider)
