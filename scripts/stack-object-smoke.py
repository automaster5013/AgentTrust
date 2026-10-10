"""Real scoped, versioned evidence storage with byte hashes, locking and outage recovery."""
import base64,datetime,hashlib,json,pathlib,subprocess,time,uuid,traceback
from stack_test_client import StackClient
from stack_compose import stack_compose
root=pathlib.Path(__file__).resolve().parent.parent;credentials=json.loads((root/'.local/stack/demo-credentials.json').read_text(encoding='utf-8'));clients=[];stopped=False;stage='prepare';report={'completed':False,'checks':[],'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'synthetic':True,'legacyServicesChanged':False,'rawSecretsPrinted':False}
def command(args,**kwargs):return subprocess.run(args,cwd=root,capture_output=True,text=True,check=True,**kwargs).stdout
def evidence(client,run_id):
 deadline=time.monotonic()+30
 while time.monotonic()<deadline:
  try:return client.request('runs/'+run_id+'/evidence')
  except AssertionError:
   if client.report.get('unexpectedHttpStatus') not in [409,503]:raise
   for name in ['unexpectedHttpStatus','expectedHttpStatus','responseCode']:client.report.pop(name,None)
   time.sleep(.5)
 raise AssertionError('ARCHIVE_NOT_READY')
def verify(value,user,run):
 content=base64.b64decode(value['contentBase64'],validate=True);assert len(content)<=16384 and len(content)==value['contentBytes'];assert hashlib.sha256(content).hexdigest()==value['contentSha256'];assert value['integrityVerified'] is True and value['storageEngine']=='minio';assert value['runId']==run['id'] and value['organizationId']==user['organizationId'] and value['projectId']==user['projectId'];document=json.loads(content);assert document['schemaVersion']==1 and document['runId']==run['id'] and document['organizationId']==user['organizationId'] and document['projectId']==user['projectId'] and document['result']==run['result']
try:
 state=json.loads(command(['docker','inspect','agenttrust-stack-object-store-1']))[0];assert state['Config']['Labels']['com.docker.compose.project']=='agenttrust' and state['Config']['Labels']['com.docker.compose.service']=='stack-object-store'
 stage='create';admin=StackClient('http://127.0.0.1:4320',credentials,report,clients);user=admin.login('demo-admin');viewer=StackClient('http://127.0.0.1:4320',credentials,report,clients);viewer.login('demo-viewer');other=StackClient('http://127.0.0.1:4320',credentials,report,clients);other.login('other-admin');key=str(uuid.uuid4());run=admin.request('runs','POST',{'scenario':'pass','requiresApproval':True},{'Idempotency-Key':key});run_id=run['id'];report['runId']=run_id
 until=time.monotonic()+20
 while run['state']=='queued' and time.monotonic()<until:time.sleep(.5);run=admin.request('runs/'+run_id)
 assert run['state']=='succeeded';stage='archive';proof=evidence(admin,run_id);verify(proof,user,run);read=evidence(viewer,run_id);assert read['storageVersion']==proof['storageVersion'];other.request('runs/'+run_id+'/evidence',expected=404);report['checks'].append('real archived bytes match selected result and SHA-256; viewer can read, foreign organization cannot')
 stage='locking';object_key='organizations/'+user['organizationId']+'/projects/'+user['projectId']+'/runs/'+run_id+'/'+proof['contentSha256']+'.json';probe={'key':object_key,'version':proof['storageVersion'],'hash':proof['contentSha256'],'bytes':proof['contentBytes']};result=command(stack_compose(root)+['run','--rm','-T','--no-deps','stack-object-init','--verify'],input=json.dumps(probe));locked=json.loads(next(line for line in result.splitlines() if line.startswith('{')));assert locked['completed'] and locked['rootCannotDeleteLockedVersion'] and locked['specificVersionStillMatchesAfterNewerShadow'];report['storageChecks']=locked;verify(evidence(admin,run_id),user,run);report['checks'].append('restricted storage account and 7-day compliance lock refuse deletion; stored version survives a newer synthetic shadow')
 stage='restart';command(stack_compose(root)+['restart','stack-object-store']);command(stack_compose(root)+['up','-d','--no-build','--wait','stack-object-store']);again=evidence(admin,run_id);verify(again,user,run);assert again['storageVersion']==proof['storageVersion'];report['checks'].append('separate MinIO volume preserves the exact archive version after restart')
 stage='outage';command(stack_compose(root)+['stop','stack-object-store']);stopped=True;admin.request('runs/'+run_id+'/evidence',expected=503);other.request('runs/'+run_id+'/evidence',expected=404);report['checks'].append('storage outage does not return verified evidence and does not expose a foreign archive')
 command(stack_compose(root)+['up','-d','--no-build','--wait','stack-object-store']);stopped=False;verify(evidence(admin,run_id),user,run);assert admin.request('runs','POST',{'scenario':'pass','requiresApproval':True},{'Idempotency-Key':key})['id']==run_id;report['checks'].append('restored storage verifies original bytes without creating a second run')
 stage='logout'
 for client in clients:client.logout()
 report['completed']=True
except Exception as error:
 report['failedStage']=stage;report['errorType']=type(error).__name__;report['failureLocations']=[{'file':pathlib.Path(t.filename).name,'line':t.lineno} for t in traceback.extract_tb(error.__traceback__)]
 if isinstance(error,subprocess.CalledProcessError) and stage=='locking':
  for line in (error.stdout or '').splitlines():
   if line.startswith('{'):
    diagnostic=json.loads(line)
    if diagnostic.get('code')=='OBJECT_STORE_VERIFICATION_FAILED':report['storageFailureStage']=diagnostic.get('stage');report['storageFailureCode']=diagnostic.get('storageErrorCode')
finally:
 restored=True
 if stopped:
  try:command(stack_compose(root)+['up','-d','--no-build','--wait','stack-object-store'])
  except Exception:restored=False
 closed=True
 for client in clients:
  try:client.logout()
  except Exception:closed=False
 report['dependenciesRestored']=restored;report['ownSessionsLoggedOut']=closed and all(not c.logged for c in clients);report['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();path=root/'.local'/('stack-object-smoke-'+str(uuid.uuid4())+'.json');path.open('x',encoding='utf-8').write(json.dumps(report,indent=2)+'\n');print(json.dumps({'completed':report['completed'],'checks':len(report['checks']),'dependenciesRestored':restored,'ownSessionsLoggedOut':report['ownSessionsLoggedOut'],'failedStage':report.get('failedStage'),'reportPath':str(path)}))
if not report['completed'] or not report['dependenciesRestored'] or not report['ownSessionsLoggedOut']:raise SystemExit(1)
