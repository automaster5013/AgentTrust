"""Real pinned local inference, admission binding, one-use reservation and fail-closed proof."""
import datetime,json,pathlib,re,subprocess,time,urllib.request,urllib.error,uuid
from stack_test_client import StackClient
from stack_compose import stack_compose
root=pathlib.Path(__file__).resolve().parent.parent
assert (root/'.local/stack/providers-enabled').exists()
credentials=json.loads((root/'.local/stack/demo-credentials.json').read_text(encoding='utf-8'));clients=[]
report={'completed':False,'checks':[],'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'syntheticInputs':True,'realLocalInference':True,'paidApiCalls':False,'rawGeneratedTextPrinted':False,'legacyDatabaseWrites':False}
command=stack_compose(root);worker_stopped=False;stage='login'
def compose(*args):subprocess.run(command+list(args),cwd=root,capture_output=True,check=True,timeout=180)
def wait(client,record):
 deadline=time.monotonic()+90
 while record['state']=='queued' and time.monotonic()<deadline:time.sleep(.25);record=client.request('runs/'+record['id'])
 assert record['state']!='queued';return record
def create(client,provider,scenario='pass',key=None):return client.request('runs','POST',{'scenario':scenario,'provider':provider,'requiresApproval':True},{'Idempotency-Key':key or str(uuid.uuid4())})
def reserve(body,expected=200,authorized=True):
 headers={'Content-Type':'application/json'}
 if authorized:headers['X-AgentTrust-Worker-Token']=(root/'.local/stack/worker-token').read_text(encoding='utf-8')
 req=urllib.request.Request('http://127.0.0.1:4321/internal/provider-reservations',data=json.dumps(body).encode(),headers=headers,method='POST')
 try:
  with urllib.request.urlopen(req,timeout=5) as response:assert response.status==expected;return json.loads(response.read(8193))
 except urllib.error.HTTPError as error:assert error.code==expected;return None
try:
 admin=StackClient('http://127.0.0.1:4320',credentials,report,clients);admin.login('demo-admin')
 other=StackClient('http://127.0.0.1:4320',credentials,report,clients);other.login('other-admin')
 for provider,scenario,decision in [('ollama','pass','pass'),('ollama','block','block'),('ollama','missing_evidence','inconclusive'),('openai-compatible','pass','pass')]:
  stage=provider+'/'+scenario;key=str(uuid.uuid4());record=wait(admin,create(admin,provider,scenario,key));assert record['provider']==provider and record['state']=='succeeded' and record['decision']==decision and record['result']['executionEngine']=='python-'+provider
  rules=record['result']['rules'];assert any(r['id']=='provider-model' and 'sha256:7df6b6e09427' in r['reason'] for r in rules) and any(r['id']=='output-sha256' and re.fullmatch('[a-f0-9]{64}',r['reason']) for r in rules)
  assert create(admin,provider,scenario,key)['id']==record['id'];admin.request('runs','POST',{'scenario':scenario,'provider':'synthetic','requiresApproval':True},{'Idempotency-Key':key},expected=409)
  assert not admin.request('runs/'+record['id']+'/gate')['deploymentAllowed'];other.request('runs/'+record['id'],expected=404)
  if decision=='pass':
   admin.request('runs/'+record['id']+'/reviews','POST',{'decision':'approved','reason':'Actual fixed local model evidence reviewed.'});assert admin.request('runs/'+record['id']+'/gate')['deploymentAllowed']
  else:admin.request('runs/'+record['id']+'/reviews','POST',{'decision':'approved','reason':'Cannot override failed or missing model evidence.'},expected=409)
  report['checks'].append(provider+'/'+scenario+' actual inference and scoped immutable admission')
 stage='disabled-paid';record=wait(admin,create(admin,'openai'));assert record['state']=='failed' and record['decision']=='inconclusive' and record['result']['executionEngine']=='python-openai' and not admin.request('runs/'+record['id']+'/gate')['deploymentAllowed'];report['checks'].append('disabled paid provider never falls back to synthetic pass')
 stage='reservation';compose('stop','stack-ai-worker');worker_stopped=True
 record=create(admin,'ollama');body={'runId':record['id'],'organizationId':record['organization_id'],'projectId':record['project_id'],'scenario':'pass','provider':'ollama'}
 reserve(body,401,False);reserve({**body,'provider':'openai'},409);reserve({**body,'scenario':'block'},409)
 foreign=next(r for r in credentials if r['username']=='other-admin');reserve({**body,'organizationId':foreign['organizationId'],'projectId':foreign['projectId']},404)
 first=reserve(body);assert first['allowed'] is True and first['reservedInputTokens']==256 and first['reservedOutputTokens']==128;assert reserve(body)['allowed'] is False
 compose('start','--wait','--wait-timeout','60','stack-ai-worker');worker_stopped=False;record=wait(admin,record);assert record['state']=='failed' and record['decision']=='inconclusive' and record['result']['executionEngine']=='python-ollama';assert not admin.request('runs/'+record['id']+'/gate')['deploymentAllowed'];report['checks'].append('lost reservation burns budget and refuses replay; foreign and changed reservations rejected')
 stage='recovered-worker';record=wait(admin,create(admin,'synthetic'));assert record['state']=='succeeded' and record['decision']=='pass' and record['result']['executionEngine']=='python-synthetic';assert not admin.request('runs/'+record['id']+'/gate')['deploymentAllowed'];report['checks'].append('healthy recovered worker executes fresh evidence and exports a new evaluation event')
 stage='logout';report['completed']=True
except Exception as error:report.update({'errorType':type(error).__name__,'failedStage':stage})
finally:
 if worker_stopped:
  try:compose('start','--wait','--wait-timeout','60','stack-ai-worker')
  except Exception:report['completed']=False
 cleanup=True
 for client in clients:
  try:client.logout()
  except Exception:cleanup=False
 report['ownSessionsLoggedOut']=cleanup;report['completed']=report['completed'] and cleanup;report['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();path=root/'.local'/('stack-provider-smoke-'+str(uuid.uuid4())+'.json');path.open('x',encoding='utf-8').write(json.dumps(report,indent=2)+'\n');print(json.dumps({'completed':report['completed'],'checks':len(report['checks']),'failedStage':report.get('failedStage'),'errorType':report.get('errorType'),'reportPath':str(path),'paidApiCalls':False,'rawSecretsPrinted':False}))
if not report['completed']:raise SystemExit(1)
