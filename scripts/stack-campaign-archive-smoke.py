"""Version-bound parent/child evidence, real retention and read-only offline verification."""
import datetime,json,pathlib,subprocess,sys,time,traceback,uuid
from stack_test_client import StackClient
from stack_compose import stack_compose
from stack_campaign_evidence import verify_parent,verify_child
root=pathlib.Path(__file__).resolve().parent.parent;compose=stack_compose(root);directory=root/'.local'/('stack-campaign-archive-'+str(uuid.uuid4()));directory.mkdir();inputs=directory/'inputs';inputs.mkdir();clients=[];stopped=False;stage='login';report={'completed':False,'checks':[],'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'credentialsRecorded':False,'paidApiCalls':False,'legacyServicesChanged':False,'signatureVerified':False,'currentDeploymentAuthority':False}
def command(args,**kwargs):return subprocess.run(args,cwd=root,capture_output=True,text=True,check=True,timeout=90,**kwargs).stdout
def start_storage():
 command(['docker','start','agenttrust-stack-object-store-1']);until=time.monotonic()+35
 while time.monotonic()<until:
  state=json.loads(command(['docker','inspect','agenttrust-stack-object-store-1']))[0]
  if state['State'].get('Health',{}).get('Status')=='healthy':return
  time.sleep(.5)
 raise AssertionError('Storage restoration unverified')
def evidence(client,id):
 until=time.monotonic()+45
 while time.monotonic()<until:
  try:return client.request('campaigns/'+id+'/evidence')
  except AssertionError:
   if report.get('unexpectedHttpStatus') not in [409,503]:raise
   report.setdefault('parentArchiveReadRetryStatuses',[]).append(report['unexpectedHttpStatus'])
   time.sleep(.5)
 raise AssertionError('Parent archive deadline')
try:
 state=json.loads(command(['docker','inspect','agenttrust-stack-object-store-1']))[0];assert state['Config']['Labels']['com.docker.compose.project']=='agenttrust' and state['Config']['Labels']['com.docker.compose.service']=='stack-object-store' and state['State']['Running'];credentials=json.loads((root/'.local/stack/demo-credentials.json').read_text(encoding='utf-8'));admin=StackClient('http://127.0.0.1:4320',credentials,report,clients);owner=admin.login('demo-admin');viewer=StackClient('http://127.0.0.1:4320',credentials,report,clients);viewer.login('demo-viewer');foreign=StackClient('http://127.0.0.1:4320',credentials,report,clients);foreign.login('other-admin');suffix=uuid.uuid4().hex[:12]
 stage='evaluation';agent=admin.request('versions/agents','POST',{'key':'archive-agent-'+suffix,'version':1,'provider':'synthetic','description':'Frozen campaign evidence'});dataset=admin.request('versions/datasets','POST',{'key':'archive-data-'+suffix,'version':1,'cases':[{'id':'required-pass','scenario':'pass','required':True},{'id':'optional-block','scenario':'block','required':False}]});record=admin.request('campaigns','POST',{'agentVersionId':agent['id'],'datasetVersionId':dataset['id'],'requiresApproval':True},{'Idempotency-Key':str(uuid.uuid4())});until=time.monotonic()+25
 while record['state']=='queued' and time.monotonic()<until:time.sleep(.4);record=admin.request('campaigns/'+record['id'])
 assert record['state']=='succeeded' and record['decision']=='pass';stage='archive';proof=evidence(admin,record['id']);references=verify_parent(proof,owner,record);(inputs/'parent.json').open('x',encoding='utf-8').write(json.dumps(proof,ensure_ascii=False)+'\n')
 for case,reference in zip(record['cases'],references):
  child=admin.request('runs/'+case['runId']);assert child['state']==case['state'] and child['decision']==case['decision'] and child['provider']==case['provider'];child_proof=admin.request('runs/'+case['runId']+'/evidence');verify_child(child_proof,owner,child,reference);(inputs/(case['runId']+'.json')).open('x',encoding='utf-8').write(json.dumps(child_proof,ensure_ascii=False)+'\n')
 report['checks'].append('parent bytes bind both actual version definitions and every exact child archive hash/version');assert evidence(viewer,record['id'])['contentSha256']==proof['contentSha256'];foreign.request('campaigns/'+record['id']+'/evidence',expected=404);report['checks'].append('viewer can verify own campaign archive and foreign tenant receives 404')
 stage='offline';verification=json.loads(command([sys.executable,'scripts/stack_campaign_evidence.py','--bundle',str(inputs),'--organization',owner['organizationId'],'--project',owner['projectId'],'--campaign',record['id'],'--expected-parent-sha256',proof['contentSha256']]));assert verification['completed'] and verification['childArchives']==2 and not verification['networkAccessed'] and not verification['signatureVerified'] and not verification['currentDeploymentAuthority'];report['offlineVerification']=verification;report['checks'].append('offline CLI verifies retained parent/child bytes against separately supplied hash; claims no signature or deployment authority')
 stage='current-review';assert not admin.request('campaigns/'+record['id']+'/gate')['deploymentAllowed'];admin.request('campaigns/'+record['id']+'/reviews','POST',{'decision':'approved','reason':'Current approval is outside the frozen evaluation snapshot'});assert admin.request('campaigns/'+record['id']+'/gate')['deploymentAllowed'];assert evidence(admin,record['id'])['contentSha256']==proof['contentSha256'];admin.request('campaigns/'+record['id']+'/reviews','POST',{'decision':'rejected','reason':'Current rejection must not rewrite historical evaluation bytes'});assert not admin.request('campaigns/'+record['id']+'/gate')['deploymentAllowed'];assert evidence(admin,record['id'])['storageVersion']==proof['storageVersion'];report['checks'].append('approval and latest rejection affect current gate without rewriting frozen evidence')
 stage='retention';key='organizations/'+owner['organizationId']+'/projects/'+owner['projectId']+'/campaigns/'+record['id']+'/'+proof['contentSha256']+'.json';probe={'key':key,'hash':proof['contentSha256'],'version':proof['storageVersion'],'bytes':proof['contentBytes']};raw=command(compose+['run','--rm','-T','--no-deps','stack-object-init','--verify'],input=json.dumps(probe));locking=json.loads(next(line for line in raw.splitlines() if line.startswith('{')));assert locking['completed'] and locking['rootCannotDeleteLockedVersion'] and locking['specificVersionStillMatchesAfterNewerShadow'];verify_parent(evidence(admin,record['id']),owner,record);report['retentionVerification']=locking;report['checks'].append('real parent COMPLIANCE retention and restricted account refuse deletion and preserve pinned version after shadow')
 stage='storage-outage';stopped=True;command(['docker','stop','--time','15','agenttrust-stack-object-store-1']);admin.request('campaigns/'+record['id']+'/evidence',expected=503);foreign.request('campaigns/'+record['id']+'/evidence',expected=404);start_storage();stopped=False;restored=evidence(admin,record['id']);verify_parent(restored,owner,record);assert restored['contentSha256']==proof['contentSha256'] and restored['storageVersion']==proof['storageVersion'];report['checks'].append('storage outage refuses proof and restart preserves exact parent version without touching legacy services');report.update(completed=True,campaignId=record['id'],parentContentSha256=proof['contentSha256'],parentStorageVersion=proof['storageVersion'],childArchives=len(references))
except Exception as error:report.update(code='STACK_CAMPAIGN_ARCHIVE_UNVERIFIED',failedStage=stage,errorType=type(error).__name__,failureLocations=[{'file':pathlib.Path(t.filename).name,'line':t.lineno} for t in traceback.extract_tb(error.__traceback__)])
finally:
 restored=True
 if stopped:
  try:start_storage()
  except Exception:restored=False
 closed=True
 for client in reversed(clients):
  try:client.logout()
  except Exception:closed=False
 report.update(storageRestored=restored,ownSessionsLoggedOut=closed,finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat());path=directory/'summary.json';path.open('x',encoding='utf-8').write(json.dumps(report,indent=2)+'\n');print(json.dumps({'completed':report['completed'],'checks':len(report['checks']),'storageRestored':restored,'ownSessionsLoggedOut':closed,'failedStage':report.get('failedStage'),'reportPath':str(path)}))
 if not report['completed'] or not restored or not closed:raise SystemExit(1)
