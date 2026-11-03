"""Bound campaign callbacks and durable recovery; only stack worker is interrupted."""
import argparse,datetime,json,pathlib,subprocess,time,shutil,traceback,urllib.error,urllib.request,uuid
from stack_test_client import StackClient
root=pathlib.Path(__file__).resolve().parent.parent;parser=argparse.ArgumentParser();parser.add_argument('--deadline',action='store_true');args=parser.parse_args()
report={'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'completed':False,'checks':[],'credentialsRecorded':False,'legacyServicesChanged':False,'deadlineTest':args.deadline};client=None;stopped=False
def command(arguments,**kwargs):return subprocess.run(arguments,cwd=root,capture_output=True,text=True,check=True,timeout=30,**kwargs).stdout
def failure_diagnostics():
 # Whitelisted disposable-fixture state only: never include Config/Env, tokens or health log output.
 result={'freeDiskBytes':shutil.disk_usage(root).free,'services':{}}
 try:
  lines=pathlib.Path('/proc/meminfo').read_text().splitlines();result['hostMemAvailableKiB']=int(next(x for x in lines if x.startswith('MemAvailable:')).split()[1])
 except Exception:pass
 for name in ['agenttrust-stack-core-api-1','agenttrust-stack-gateway-1','agenttrust-stack-ai-worker-1']:
  try:
   process=subprocess.run(['docker','inspect',name],cwd=root,capture_output=True,text=True,timeout=5,check=True);assert len(process.stdout)<=524288;state=json.loads(process.stdout)[0]['State'];result['services'][name]={key:state.get(key) for key in ['Status','Running','Paused','OOMKilled','ExitCode']};result['services'][name]['health']=state.get('Health',{}).get('Status')
  except Exception as error:result['services'][name]={'unverified':type(error).__name__}
 return result

def callback(path,body,expected,token):
 request=urllib.request.Request('http://127.0.0.1:4321/internal/'+path,data=json.dumps(body).encode(),headers={'Content-Type':'application/json','X-AgentTrust-Worker-Token':token},method='POST')
 try:response=urllib.request.urlopen(request,timeout=10)
 except urllib.error.HTTPError as error:response=error
 status=response.status;response.read(16385);response.close();assert status==expected
def restored_worker():
 command(['docker','start','agenttrust-stack-ai-worker-1']);until=time.monotonic()+25
 while time.monotonic()<until:
  state=json.loads(command(['docker','inspect','agenttrust-stack-ai-worker-1']))[0]
  if state['State'].get('Health',{}).get('Status')=='healthy':return
  time.sleep(.5)
 raise AssertionError('Worker restoration unverified')
try:
 report['phase']='setup-and-login'
 state=json.loads(command(['docker','inspect','agenttrust-stack-ai-worker-1']))[0];assert state['Config']['Labels']['com.docker.compose.project']=='agenttrust' and state['Config']['Labels']['com.docker.compose.service']=='stack-ai-worker' and state['State']['Running'];credentials=json.loads((root/'.local/stack/demo-credentials.json').read_text(encoding='utf-8'));client=StackClient('http://127.0.0.1:4320',credentials,report);owner=client.login('demo-admin');suffix=uuid.uuid4().hex[:12]
 report['phase']='register-immutable-fixtures'
 agent=client.request('versions/agents','POST',{'key':'recovery-agent-'+suffix,'version':1,'provider':'synthetic','description':'Bound callback recovery fixture'});dataset=client.request('versions/datasets','POST',{'key':'recovery-data-'+suffix,'version':1,'cases':[{'id':'required-pass','scenario':'pass','required':True},{'id':'optional-pass','scenario':'pass','required':False}]})
 report['phase']='stop-worker-and-persist-queued-campaign'
 stopped=True;command(['docker','stop','--time','15','agenttrust-stack-ai-worker-1']);key=str(uuid.uuid4());body={'agentVersionId':agent['id'],'datasetVersionId':dataset['id'],'requiresApproval':False};record=client.request('campaigns','POST',body,{'Idempotency-Key':key});assert record['state']=='queued' and not client.request('campaigns/'+record['id']+'/gate')['deploymentAllowed'];report['campaignId']=record['id'];report['checks'].append('atomic campaign persists both queued children while worker is stopped')
 token=(root/'.local/stack/worker-token').read_text(encoding='utf-8');assert len(token)==64 and all(c in '0123456789abcdef' for c in token);case=record['cases'][0];metadata={'runId':case['runId'],'organizationId':owner['organizationId'],'projectId':owner['projectId'],'scenario':case['scenario'],'provider':'synthetic'};bound={**metadata,'campaignId':record['id'],'caseId':case['caseId'],'agentVersionId':agent['id'],'datasetVersionId':dataset['id'],**({'executionProfileSha256':agent['definition']['executionProfileSha256']} if agent['definition'].get('contract')=='fixed-scenarios-v2' else {})};result={'state':'succeeded','decision':'pass','executionEngine':'python-synthetic','rules':[{'id':'required-output','required':True,'status':'pass','reason':'Must be refused before storage'}]}
 report['phase']='reject-substituted-callbacks'
 for wrong in [metadata,{k:v for k,v in bound.items() if k!='executionProfileSha256'},{**bound,'campaignId':str(uuid.uuid4())},{**bound,'caseId':'wrong-case'},{**bound,'agentVersionId':str(uuid.uuid4())},{**bound,'datasetVersionId':str(uuid.uuid4())},{**bound,'executionProfileSha256':'0'*64}]:callback('completions',{**wrong,'result':result},409,token)
 callback('completions',{**metadata,'campaignId':record['id'],'result':result},400,token);callback('provider-reservations',{**bound,'agentVersionId':str(uuid.uuid4())},409,token)
 assert client.request('campaigns/'+record['id'])['state']=='queued';report['checks'].append('missing, partial and substituted campaign/case/version callbacks and reservations are refused')
 if args.deadline:
  report['phase']='deadline-poll';report['deadlinePollCount']=0
  until=time.monotonic()+145
  while record['state']=='queued' and time.monotonic()<until:time.sleep(.75);report['deadlinePollCount']+=1;record=client.request('campaigns/'+record['id'])
  assert record['state']=='failed' and record['decision']=='inconclusive' and all(c['state']=='failed' for c in record['cases']);report['checks'].append('every child reaches immutable deadline failure and parent cannot permit release')
 report['phase']='restore-worker'
 restored_worker();stopped=False;until=time.monotonic()+25
 if args.deadline:
  time.sleep(4);record=client.request('campaigns/'+record['id']);assert record['state']=='failed' and not client.request('campaigns/'+record['id']+'/gate')['deploymentAllowed'];report['checks'].append('late real worker completions preserve deadline results')
 else:
  while record['state']=='queued' and time.monotonic()<until:time.sleep(.4);record=client.request('campaigns/'+record['id'])
  assert record['state']=='succeeded' and record['decision']=='pass' and client.request('campaigns/'+record['id']+'/gate')['deploymentAllowed'];report['checks'].append('real Python consumer resumes retained JetStream jobs with exact immutable bindings')
 assert client.request('campaigns','POST',body,{'Idempotency-Key':key})['id']==record['id'];report['completed']=True
except Exception as error:
 report.update(code='STACK_CAMPAIGN_RECOVERY_UNVERIFIED',errorType=type(error).__name__,failurePhase=report.get('phase'),failureLocation=[{'file':pathlib.Path(f.filename).name,'line':f.lineno} for f in traceback.extract_tb(error.__traceback__)][-3:])
 report['failureDiagnostics']=failure_diagnostics()
finally:
 restored=True
 if stopped:
  try:restored_worker()
  except Exception:restored=False
 logged=False
 if client:
  try:client.logout();logged=not client.logged
  except Exception:pass
 report.update(workerRestored=restored,ownSessionLoggedOut=logged,finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat());path=root/'.local'/('stack-campaign-recovery-'+str(uuid.uuid4())+'.json');path.open('x',encoding='utf-8').write(json.dumps(report,indent=2)+'\n');print(json.dumps({'completed':report['completed'],'checks':len(report['checks']),'workerRestored':restored,'ownSessionLoggedOut':logged,'reportPath':str(path)}))
 if not report['completed'] or not restored or not logged:raise SystemExit(1)
