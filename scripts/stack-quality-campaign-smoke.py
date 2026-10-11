"""Actual scoped reference campaigns, independent graders, immutable binding and recovery."""
import base64,datetime,hashlib,json,pathlib,re,subprocess,time,urllib.request,urllib.error,uuid
from stack_test_client import StackClient
from stack_campaign_evidence import verify_parent,verify_child
root=pathlib.Path(__file__).resolve().parent.parent
directory=root/'.local'/('stack-quality-campaign-'+str(uuid.uuid4()));directory.mkdir();clients=[];stopped=[];stage='login'
report={'completed':False,'checks':[],'realLocalInference':True,'paidApiCalls':False,'rawGeneratedTextPrinted':False,'legacyDatabaseWrites':False,'currentDeploymentAuthority':False,'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
def sha(value):return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
def command(args,**kwargs):return subprocess.run(args,cwd=root,capture_output=True,text=True,encoding='utf-8',errors='replace',check=True,timeout=180,**kwargs).stdout
def stop(service):
 container='agenttrust-stack-'+service+'-1';state=json.loads(command(['docker','inspect',container]))[0]
 assert state['Config']['Labels']['com.docker.compose.project']=='agenttrust' and state['Config']['Labels']['com.docker.compose.service']=='stack-'+service and state['State']['Running']
 command(['docker','stop',container]);stopped.append(container)
def restore(container):
 command(['docker','start',container]);until=time.monotonic()+90
 while time.monotonic()<until:
  state=json.loads(command(['docker','inspect',container]))[0]
  if state['State']['Running'] and state['State'].get('Health',{}).get('Status')=='healthy':stopped.remove(container);return
  time.sleep(.5)
 raise ValueError('Service restoration unavailable')
def create(client,agent,data):return client.request('campaigns','POST',{'agentVersionId':agent['id'],'datasetVersionId':data['id'],'requiresApproval':True},{'Idempotency-Key':str(uuid.uuid4())})
def wait(client,record):
 until=time.monotonic()+140
 while record['state']=='queued' and time.monotonic()<until:time.sleep(.5);record=client.request('campaigns/'+record['id'])
 assert record['state']!='queued';return record
def evidence(client,id):
 until=time.monotonic()+45
 while time.monotonic()<until:
  try:return client.request('campaigns/'+id+'/evidence')
  except AssertionError:
   if report.get('unexpectedHttpStatus') not in [409,503]:raise
   time.sleep(.5)
 raise ValueError('Reference archive unavailable')
def reserve(body,expected=200):
 token=(root/'.local/stack/worker-token').read_text(encoding='utf-8')
 request=urllib.request.Request('http://127.0.0.1:4321/internal/provider-reservations',data=json.dumps(body).encode(),headers={'Content-Type':'application/json','X-AgentTrust-Worker-Token':token},method='POST')
 try:
  with urllib.request.urlopen(request,timeout=5) as response:assert response.status==expected;return json.loads(response.read(8193))
 except urllib.error.HTTPError as error:assert error.code==expected;return None

def attempts(ids):
 assert len(ids)==8 and len(set(ids))==8 and all(str(uuid.UUID(value))==value for value in ids)
 state=json.loads(command(['docker','inspect','agenttrust-stack-db-1']))[0]
 assert state['Config']['Labels']['com.docker.compose.project']=='agenttrust' and state['Config']['Labels']['com.docker.compose.service']=='stack-db'
 # Only fresh owned run UUIDs enter this fixed query. Return aggregate counts,
 # never recorded input, reference or model bytes.
 values=','.join("'"+value+"'" for value in ids)
 query="SELECT count(*)::text||'|'||count(DISTINCT run_id)::text||'|'||count(*) FILTER(WHERE reserved_input_tokens=256 AND reserved_output_tokens=128)::text FROM stack_provider_attempts WHERE run_id IN ("+values+");"
 measured=command(['docker','exec','-i','agenttrust-stack-db-1','psql','-U','agenttrust_stack','-d','agenttrust_stack','-v','ON_ERROR_STOP=1','-At'],input=query).strip()
 assert measured=='8|8|8'
try:
 assert (root/'.local/stack/providers-enabled').exists();credentials=json.loads((root/'.local/stack/demo-credentials.json').read_text(encoding='utf-8'))
 admin=StackClient('http://127.0.0.1:4320',credentials,report,clients);owner=admin.login('demo-admin')
 foreign=StackClient('http://127.0.0.1:4320',credentials,report,clients);foreign.login('other-admin')
 viewer=StackClient('http://127.0.0.1:4320',credentials,report,clients);viewer.login('demo-viewer');suffix=uuid.uuid4().hex[:12]
 cases=[{'id':'green','scenario':'quality','required':True,'input':'Respond exactly with {"answer":"GREEN"}.','expected':'GREEN'},{'id':'blue','scenario':'quality','required':False,'input':'Respond exactly with {"answer":"BLUE"}.','expected':'BLUE'}]
 body={'key':'reference-data-'+suffix,'version':1,'evaluationMode':'reference-answer','cases':cases};data=admin.request('versions/datasets','POST',body)
 assert data['content_sha256']==sha(data['definition']) and admin.request('versions/datasets','POST',body)['id']==data['id']
 admin.request('versions/datasets','POST',{**body,'cases':[{**cases[0],'expected':'RED'},cases[1]]},expected=409)
 for invalid in [cases+[{'id':'third','scenario':'quality','required':True,'input':'x','expected':'x'}],[{**cases[0],'input':'é'*97}],[{**cases[0],'expected':'x'*129}],[{**cases[0],'scenario':'pass'}],[{**cases[0],'url':'http://outside.invalid'}]]:admin.request('versions/datasets','POST',{**body,'version':2,'cases':invalid},expected=400)
 viewer.request('versions/datasets','POST',{**body,'version':2},expected=403);foreign.request('versions/datasets/'+data['id'],expected=404)
 report['checks'].append('bounded immutable reference versions enforce exact replay, UTF8 limits and tenant roles')
 stage='actual-reference-inference';records=[];agents=[];run_ids=[]
 for version,provider in enumerate(['ollama','openai-compatible'],1):
  agent_body={'key':'reference-agent-'+suffix,'version':version,'provider':provider,'description':'Bounded exact reference evaluation','evaluationMode':'reference-answer'}
  agent=admin.request('versions/agents','POST',agent_body);agents.append(agent);assert agent['content_sha256']==sha(agent['definition']) and agent['definition']['executionProfileSha256']==sha(agent['definition']['executionProfile'])
  admin.request('versions/agents','POST',{**agent_body,'evaluationMode':'fixed-scenarios'},expected=409)
  record=wait(admin,create(admin,agent,data));assert record['state']=='succeeded' and record['decision']=='pass' and len(record['cases'])==2
  for case in record['cases']:
   child=admin.request('runs/'+case['runId']);assert child['scenario']=='quality' and child['provider']==provider and child['result']['executionEngine']=='python-'+provider and child['decision']=='pass'
   rules=child['result']['rules'];assert any(rule['id']=='reference-answer' and rule['required'] and rule['status']=='pass' for rule in rules) and any(rule['id']=='verifier-agreement' and rule['required'] and 'Promptfoo 0.124.1' in rule['reason'] for rule in rules)
   assert not any('GREEN' in rule['reason'] or 'BLUE' in rule['reason'] for rule in rules);run_ids.append(case['runId'])
  assert not admin.request('campaigns/'+record['id']+'/gate')['deploymentAllowed'];admin.request('campaigns/'+record['id']+'/reviews','POST',{'decision':'approved','reason':'Actual immutable reference cases reviewed'});assert admin.request('campaigns/'+record['id']+'/gate')['deploymentAllowed'];foreign.request('campaigns/'+record['id'],expected=404);records.append(record)
  report['checks'].append(provider+' actual bound dataset inference agrees with Python and Promptfoo; approval remains separate')
 stage='wrong-reference';wrong=admin.request('versions/datasets','POST',{**body,'version':2,'cases':[{**cases[0],'expected':'RED'}]});blocked=wait(admin,create(admin,agents[0],wrong));assert blocked['state']=='succeeded' and blocked['decision']=='block' and not admin.request('campaigns/'+blocked['id']+'/gate')['deploymentAllowed'];admin.request('campaigns/'+blocked['id']+'/reviews','POST',{'decision':'approved','reason':'Cannot override wrong reference'},expected=409);report['checks'].append('actual model output conflicting with immutable reference blocks release')
 stage='mixed-contract';fixed=admin.request('versions/datasets','POST',{'key':'fixed-reference-control-'+suffix,'version':1,'cases':[{'id':'ready','scenario':'pass','required':True}]});admin.request('campaigns','POST',{'agentVersionId':agents[0]['id'],'datasetVersionId':fixed['id'],'requiresApproval':True},{'Idempotency-Key':str(uuid.uuid4())},expected=409);report['checks'].append('fixed and reference contracts cannot be mixed')
 stage='frozen-reference-archive';record=records[0];proof=evidence(admin,record['id']);references=verify_parent(proof,owner,record)
 for case,reference in zip(record['cases'],references):
  child=admin.request('runs/'+case['runId']);verify_child(admin.request('runs/'+case['runId']+'/evidence'),owner,child,reference)
 assert evidence(viewer,record['id'])['contentSha256']==proof['contentSha256'];foreign.request('campaigns/'+record['id']+'/evidence',expected=404)
 receipt=admin.request('campaigns/'+record['id']+'/receipts','POST',{'note':'Reference campaign historical observation'},{'Idempotency-Key':str(uuid.uuid4())});payload=json.loads(base64.b64decode(receipt['payloadBase64'],validate=True));assert payload['observedGate']['deploymentAllowed'] and not payload['currentDeploymentAuthority']
 bundle=admin.request('campaigns/'+record['id']+'/receipts/'+receipt['receiptId']+'/bundle');path=directory/'bundle.json';path.open('x',encoding='utf-8').write(json.dumps(bundle,ensure_ascii=False)+'\n')
 verified=json.loads(command(['node','--experimental-strip-types','scripts/stack-verify-campaign-receipt.ts','--bundle',str(path),'--trusted-public-key',str(root/'.local/stack/gate-keys/public-key.pem'),'--organization',owner['organizationId'],'--project',owner['projectId'],'--campaign',record['id']]))
 assert verified['signatureVerified'] and verified['childBytesVerified'] and not verified['currentDeploymentAuthority']
 admin.request('campaigns/'+record['id']+'/reviews','POST',{'decision':'rejected','reason':'Historical reference proof is not current authority'});assert not admin.request('campaigns/'+record['id']+'/gate')['deploymentAllowed'] and evidence(admin,record['id'])['contentSha256']==proof['contentSha256'];report['checks'].append('reference parent and child archives and actual offline Ed25519 signature survive current rejection')
 stage='bound-reservation';stop('ai-worker');one=admin.request('versions/datasets','POST',{**body,'version':3,'cases':[cases[0]]});admission=create(admin,agents[0],one);case=admission['cases'][0]
 sample={'input':cases[0]['input'],'expected':cases[0]['expected'],'contentSha256':sha({'contract':'reference-answer-case-v1','input':cases[0]['input'],'expected':cases[0]['expected']})}
 request={'runId':case['runId'],'organizationId':owner['organizationId'],'projectId':owner['projectId'],'scenario':'quality','provider':'ollama','campaignId':admission['id'],'caseId':case['caseId'],'agentVersionId':agents[0]['id'],'datasetVersionId':one['id'],'executionProfileSha256':agents[0]['definition']['executionProfileSha256'],'qualityCase':sample}
 forged={**sample,'expected':'RED','contentSha256':sha({'contract':'reference-answer-case-v1','input':sample['input'],'expected':'RED'})};reserve({**request,'qualityCase':forged},409);reserve({key:value for key,value in request.items() if key!='qualityCase'},409)
 assert reserve(request)['allowed'] is True and reserve(request)['allowed'] is False;restore('agenttrust-stack-ai-worker-1');burned=wait(admin,admission);assert burned['state']=='failed' and burned['decision']=='inconclusive';report['checks'].append('rehashed forged case is refused before reservation; ambiguous reserved attempt is never repeated')
 stage='verifier-outage';stop('quality-verifier');unavailable=wait(admin,create(admin,agents[0],one));assert unavailable['state']=='failed' and unavailable['decision']=='inconclusive' and not admin.request('campaigns/'+unavailable['id']+'/gate')['deploymentAllowed'];restore('agenttrust-stack-quality-verifier-1');recovered=wait(admin,create(admin,agents[0],one));assert recovered['decision']=='pass' and not admin.request('campaigns/'+recovered['id']+'/gate')['deploymentAllowed'];report['checks'].append('verifier outage fails closed; recovered service requires fresh inference and approval')
 stage='persisted-single-use-reservations'
 attempts(run_ids+[blocked['cases'][0]['runId'],burned['cases'][0]['runId'],unavailable['cases'][0]['runId'],recovered['cases'][0]['runId']])
 report['checks'].append('eight owned admissions have exactly one persisted 256/128 token reservation each, including the burned attempt')
 report.update(completed=True,campaignIds=[record['id'] for record in records],referenceDatasetVersionId=data['id'],actualLocalCases=7,persistedReservations=8)
except Exception as error:report.update(errorType=type(error).__name__,failedStage=stage)
finally:
 for container in list(reversed(stopped)):
  try:restore(container)
  except Exception:report['completed']=False;report['serviceRestorationFailed']=True
 closed=True
 for client in reversed(clients):
  try:client.logout()
  except Exception:closed=False
 report['completed']=report['completed'] and closed;report.update(ownSessionsLoggedOut=closed,finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat());path=directory/'summary.json';path.open('x',encoding='utf-8').write(json.dumps(report,indent=2)+'\n');print(json.dumps({'completed':report['completed'],'checks':len(report['checks']),'failedStage':report.get('failedStage'),'errorType':report.get('errorType'),'reportPath':str(path),'paidApiCalls':False,'rawSecretsPrinted':False}))
if not report['completed']:raise SystemExit(1)
