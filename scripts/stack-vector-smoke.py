"""Real pgvector nearest-neighbor reads, immutable scoped indexing and recovery."""
import datetime,json,pathlib,subprocess,time,uuid,traceback
from stack_test_client import StackClient
from stack_compose import stack_compose
root=pathlib.Path(__file__).resolve().parent.parent
credentials=json.loads((root/'.local/stack/demo-credentials.json').read_text(encoding='utf-8'))
clients=[];stopped=False;database_stopped=False;stage='prepare'
report={'completed':False,'checks':[],'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'synthetic':True,'legacyServicesChanged':False,'rawSecretsPrinted':False,'learnedSemanticEmbeddings':False}
def command(args,**kwargs):return subprocess.run(args,cwd=root,capture_output=True,text=True,check=True,**kwargs).stdout
def completed(client,run):
 deadline=time.monotonic()+30
 while run['state']=='queued' and time.monotonic()<deadline:time.sleep(.5);run=client.request('runs/'+run['id'])
 assert run['state']=='succeeded';return run
def similar(client,id):
 deadline=time.monotonic()+90
 while time.monotonic()<deadline:
  try:return client.request('runs/'+id+'/similar')
  except AssertionError:
   if client.report.get('unexpectedHttpStatus') not in [409,503]:raise
   for name in ['unexpectedHttpStatus','expectedHttpStatus','responseCode']:client.report.pop(name,None)
   time.sleep(2)
 raise AssertionError('FEATURE_INDEX_NOT_READY')
def verify(value,user,id):
 assert value['runId']==id and value['organizationId']==user['organizationId'] and value['projectId']==user['projectId']
 assert value['featureVersion']=='rule-features-v1' and value['dimensions']==64 and value['searchEngine']=='pgvector-cosine' and value['deploymentAuthority'] is False
 assert 1<=len(value['matches'])<=5;seen=set();previous=1
 for match in value['matches']:
  assert match['runId']!=id and match['runId'] not in seen and 0<=match['score']<=previous+1e-6;seen.add(match['runId']);previous=match['score']
def logout_after_database_recovery(client):
 deadline=time.monotonic()+30
 while True:
  try:client.logout();return
  except Exception:
   if time.monotonic()>=deadline:raise
   report['identityLogoutRecoveryRetries']=report.get('identityLogoutRecoveryRetries',0)+1
   time.sleep(1)
try:
 state=json.loads(command(['docker','inspect','agenttrust-stack-db-1']))[0];assert state['Config']['Labels']['com.docker.compose.project']=='agenttrust' and state['Config']['Labels']['com.docker.compose.service']=='stack-db'
 assert command(['docker','exec','agenttrust-stack-db-1','psql','-U','agenttrust_stack','-d','agenttrust_stack','-At','-c',"SELECT extversion FROM pg_extension WHERE extname='vector'"]).strip()=='0.8.7'
 admin=StackClient('http://127.0.0.1:4320',credentials,report,clients);user=admin.login('demo-admin');viewer=StackClient('http://127.0.0.1:4320',credentials,report,clients);viewer.login('demo-viewer');other=StackClient('http://127.0.0.1:4320',credentials,report,clients);other.login('other-admin')
 stage='create';key=str(uuid.uuid4());passed=completed(admin,admin.request('runs','POST',{'scenario':'pass','requiresApproval':True},{'Idempotency-Key':key}));blocked=completed(admin,admin.request('runs','POST',{'scenario':'block','requiresApproval':True},{'Idempotency-Key':str(uuid.uuid4())}));foreign=completed(other,other.request('runs','POST',{'scenario':'pass','requiresApproval':True},{'Idempotency-Key':str(uuid.uuid4())}));report['runId']=passed['id']
 stage='search';proof=similar(admin,passed['id']);verify(proof,user,passed['id']);assert proof['matches'][0]['score']>0.999;assert all(m['runId']!=foreign['id'] for m in proof['matches']);assert similar(viewer,passed['id'])==proof;other.request('runs/'+passed['id']+'/similar',expected=404);admin.request('runs/'+str(uuid.uuid4())+'/similar',expected=404)
 for match in proof['matches']:
  detail=admin.request('runs/'+match['runId']);assert detail['organization_id']==user['organizationId'] and detail['project_id']==user['projectId'] and detail['decision']==match['decision']
 report['checks'].append('actual pgvector cosine matches agree with scoped persisted results; viewer reads, foreign scope and unknown run are refused')
 stage='feature-distance';similar(admin,blocked['id'])
 sql="SELECT (p.embedding <=> p.embedding)<(p.embedding <=> b.embedding) FROM stack_rule_vectors p JOIN stack_rule_vectors b ON b.run_id='"+blocked['id']+"' WHERE p.run_id='"+passed['id']+"'"
 assert command(['docker','exec','agenttrust-stack-db-1','psql','-U','agenttrust_stack','-d','agenttrust_stack','-At','-c',sql]).strip()=='t';report['checks'].append('normalized stored rule vectors distinguish pass and required failure')
 stage='worker-outage';command(stack_compose(root)+['stop','stack-ai-worker']);stopped=True;queued=admin.request('runs','POST',{'scenario':'pass','requiresApproval':True},{'Idempotency-Key':str(uuid.uuid4())});assert queued['state']=='queued';admin.request('runs/'+queued['id']+'/similar',expected=409);assert similar(admin,passed['id'])==proof;report['checks'].append('queued unindexed run returns pending; persisted neighbors remain readable during worker outage')
 command(stack_compose(root)+['up','-d','--no-build','--wait','stack-ai-worker']);stopped=False;completed(admin,queued);verify(similar(admin,queued['id']),user,queued['id'])
 stage='database-restart';before=similar(admin,passed['id']);command(stack_compose(root)+['restart','stack-db']);command(stack_compose(root)+['up','-d','--no-build','--wait','stack-db']);assert similar(admin,passed['id'])==before;assert admin.request('runs','POST',{'scenario':'pass','requiresApproval':True},{'Idempotency-Key':key})['id']==passed['id'];report['checks'].append('dedicated database volume preserves vectors and exact neighbors without duplicate evaluation after restart')
 stage='database-outage';command(stack_compose(root)+['stop','stack-db']);database_stopped=True;started=time.monotonic();admin.request('runs/'+passed['id']+'/similar',expected=503);report['outageResponseSeconds']=round(time.monotonic()-started,3);assert report['outageResponseSeconds']<8;admin.request('runs/'+passed['id']+'/gate',expected=503);report['checks'].append('database outage returns bounded unavailability and cannot return release permission')
 command(stack_compose(root)+['up','-d','--no-build','--wait','stack-db']);database_stopped=False;assert similar(admin,passed['id'])==before
 stage='logout'
 for client in clients:logout_after_database_recovery(client)
 report['completed']=True
except Exception as error:report['failedStage']=stage;report['errorType']=type(error).__name__;report['failureLocations']=[{'file':pathlib.Path(t.filename).name,'line':t.lineno} for t in traceback.extract_tb(error.__traceback__)]
finally:
 restored=True
 if database_stopped:
  try:command(stack_compose(root)+['up','-d','--no-build','--wait','stack-db'])
  except Exception:restored=False
 if stopped:
  try:command(stack_compose(root)+['up','-d','--no-build','--wait','stack-ai-worker'])
  except Exception:restored=False
 closed=True
 for client in clients:
  try:client.logout()
  except Exception:closed=False
 report['dependenciesRestored']=restored;report['ownSessionsLoggedOut']=closed and all(not c.logged for c in clients);report['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();path=root/'.local'/('stack-vector-smoke-'+str(uuid.uuid4())+'.json');path.open('x',encoding='utf-8').write(json.dumps(report,indent=2)+'\n');print(json.dumps({'completed':report['completed'],'checks':len(report['checks']),'dependenciesRestored':restored,'ownSessionsLoggedOut':report['ownSessionsLoggedOut'],'failedStage':report.get('failedStage'),'errorType':report.get('errorType'),'unexpectedHttpStatus':report.get('unexpectedHttpStatus'),'expectedHttpStatus':report.get('expectedHttpStatus'),'outageResponseSeconds':report.get('outageResponseSeconds'),'reportPath':str(path)}))
if not report['completed'] or not report['dependenciesRestored'] or not report['ownSessionsLoggedOut']:raise SystemExit(1)
