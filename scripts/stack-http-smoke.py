"""Real HTTP contract checks against isolated Spring/PostgreSQL stack. Never prints credentials."""
import argparse,concurrent.futures,http.cookiejar,json,pathlib,urllib.request,urllib.error,urllib.parse,uuid,datetime,time
p=argparse.ArgumentParser();p.add_argument('--base',default='http://127.0.0.1:4321');p.add_argument('--credentials',default='.local/stack/demo-credentials.json');args=p.parse_args();assert args.base in ['http://127.0.0.1:4321','http://127.0.0.1:4320'];base=args.base;prefix='/backend/' if base.endswith('4320') else '/api/'
credentials=json.loads(pathlib.Path(args.credentials).read_text(encoding='utf-8'));policy=json.loads(pathlib.Path('services/core-api/src/main/resources/policy-metadata.json').read_text(encoding='utf-8'))['agenttrust']['policy'];report={'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'base':base,'synthetic':True,'legacyDatabaseWrites':False,'serverDeployed':False,'completed':False,'checks':[],'ownSessionsLoggedOut':False};clients=[];stage='initialize'
from stack_test_client import StackClient
class Client(StackClient):
 def __init__(self):super().__init__(base,credentials,report,clients)

def check(name):report['checks'].append(name)
def completed(client,record):
 deadline=time.monotonic()+20
 while record['state']=='queued' and time.monotonic()<deadline:
  time.sleep(.25);record=client.request('runs/'+record['id'])
 assert record['state']!='queued';return record
try:
 stage='anonymous';anonymous=Client();anonymous.request('me',expected=401);anonymous.request('runs','POST',{'scenario':'pass','requiresApproval':True},headers={'Idempotency-Key':'unauthorized-test'},expected=403);check('anonymous and missing CSRF refused')
 stage='login';admin=Client();admin.login('demo-admin');editor=Client();editor.login('demo-editor');viewer=Client();viewer.login('demo-viewer');other=Client();other.login('other-admin');check('four authenticated identities retain tenant and role')
 stage='workspace-management'
 project=admin.request('workspace/project');assert project['organizationId']==admin.request('me')['organizationId'] and project['deploymentAuthority'] is False
 editor.request('workspace/project','POST',{'expectedRevision':project['revision'],'name':'Forbidden','description':''},expected=403)
 viewer.request('workspace/access-keys',expected=403)
 updated=admin.request('workspace/project','POST',{'expectedRevision':project['revision'],'name':'Synthetic project','description':'Isolated CI management contract'})
 assert updated['revision']==project['revision']+1 and updated['name']=='Synthetic project'
 admin.request('workspace/project','POST',{'expectedRevision':project['revision'],'name':'Stale','description':''},expected=409)
 assert other.request('workspace/project')['name']!='Synthetic project'
 key_id=str(uuid.uuid4());issued=admin.request('workspace/access-keys','POST',{'id':key_id,'name':'Synthetic metadata read','days':1});secret=issued['token']
 assert issued['key']['id']==key_id and issued['key']['scope']=='project-metadata-read' and issued['deploymentAuthority'] is False
 page=admin.request('workspace/access-keys');assert any(row['id']==key_id for row in page['entries']) and 'token' not in page and all('token' not in row and 'secret_hash' not in row for row in page['entries'])
 def key_read(token,expected):
  request=urllib.request.Request('http://127.0.0.1:4321/api/access-key/project',headers={'Authorization':'Bearer '+token,'Accept':'application/json'})
  class NoKeyRedirect(urllib.request.HTTPRedirectHandler):
   def redirect_request(self,*args,**kwargs):raise ValueError('Key redirect refused')
  opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoKeyRedirect())
  try:response=opener.open(request,timeout=10)
  except urllib.error.HTTPError as error:response=error
  try:
   assert response.status==expected;raw=response.read(16385);assert len(raw)<=16384
   return json.loads(raw) if expected==200 else None
  finally:response.close()
 try:
  assert key_read(secret,200)['projectId']==project['projectId'];key_read(secret[:-1]+('a' if secret[-1]!='a' else 'b'),401)
  other.request('workspace/access-keys/'+key_id+'/revoke','POST',{},expected=404)
 finally:admin.request('workspace/access-keys/'+key_id+'/revoke','POST',{})
 key_read(secret,401)
 own_sessions=admin.request('workspace/sessions');current=next(row for row in own_sessions['entries'] if row['current']);assert own_sessions['actorId']==admin.request('me')['actorId'] and own_sessions['coverage']=='current-core-instance-observed-app-sessions'
 admin.request('workspace/sessions/'+current['handle']+'/revoke','POST',{},expected=409)
 other.request('workspace/sessions/'+current['handle']+'/revoke','POST',{},expected=404)
 before_handles={row['handle'] for row in own_sessions['entries']};second=Client();second.login('demo-admin')
 try:
  tracked=admin.request('workspace/sessions');added=[row for row in tracked['entries'] if row['handle'] not in before_handles and not row['current']];assert len(added)==1
  admin.request('workspace/sessions/'+added[0]['handle']+'/revoke','POST',{});second.request('me',expected=401);assert admin.request('me')['role']=='admin'
 finally:second.logout()
 check('workspace settings CAS role and tenant boundaries, hashed one-time keys actual stateless read and revocation, current and foreign session refusal')
 stage='evaluation';records={}
 for scenario,decision,state in [('pass','pass','succeeded'),('block','block','succeeded'),('missing_evidence','inconclusive','succeeded'),('error','inconclusive','failed')]:
  r=admin.request('runs','POST',{'scenario':scenario,'requiresApproval':True},{'Idempotency-Key':str(uuid.uuid4())});r=completed(admin,r);assert r['decision']==decision and r['state']==state and r['result']['executionEngine']=='python-synthetic';g=admin.request('runs/'+r['id']+'/gate');assert not g['deploymentAllowed'] and not g['signed'] and g['policyEngine']=='opa-rego' and g['policyStatus']=='evaluated' and g['policyVersion']==policy['version'] and g['policyDigest']==policy['digest'];records[scenario]=r
 check('pass block missing evidence error persisted without unsafe permission')
 stage='review';run=records['pass'];editor.request('runs/'+run['id']+'/reviews','POST',{'decision':'approved','reason':'Synthetic review'},expected=403);viewer.request('runs','POST',{'scenario':'pass','requiresApproval':True},{'Idempotency-Key':str(uuid.uuid4())},expected=403)
 admin.request('runs/'+run['id']+'/reviews','POST',{'decision':'approved','reason':'Synthetic approval','policyVersion':'0.0.0'},expected=400);admin.request('runs/'+run['id']+'/reviews','POST',{'decision':'approved','reason':'Synthetic approval'});assert admin.request('runs/'+run['id']+'/gate')['deploymentAllowed'];admin.request('runs/'+run['id']+'/reviews','POST',{'decision':'rejected','reason':'Synthetic revocation'});assert not admin.request('runs/'+run['id']+'/gate')['deploymentAllowed'];history=admin.request('runs/'+run['id']+'/reviews');assert len(history)==2 and all(row['policy_version']==policy['version'] and row['policy_digest']==policy['digest'] for row in history)
 admin.request('runs/'+records['block']['id']+'/reviews','POST',{'decision':'approved','reason':'Cannot override failed evaluation'},expected=409);check('administrator approval then rejection and nonpass refusal')
 stage='tenant';other.request('runs/'+run['id'],expected=404);other.request('runs/'+run['id']+'/gate',expected=404);other.request('runs/'+run['id']+'/reviews','POST',{'decision':'approved','reason':'Foreign'},expected=404);assert not any(r['id']==run['id'] for r in other.request('runs'));assert any(r['id']==run['id'] for r in viewer.request('runs'));check('foreign tenant reads and reviews refused; viewer own reads allowed')
 stage='idempotency';key=str(uuid.uuid4());body={'scenario':'pass','requiresApproval':False};first=editor.request('runs','POST',body,{'Idempotency-Key':key});second=editor.request('runs','POST',body,{'Idempotency-Key':key});assert first['id']==second['id'];assert editor.request('runs/'+completed(editor,first)['id']+'/gate')['deploymentAllowed'];editor.request('runs','POST',{'scenario':'block','requiresApproval':False},{'Idempotency-Key':key},expected=409);check('same request converges and changed request conflicts')
 stage='concurrency';parallel=[]
 for _ in range(4):
  c=Client();c.login('demo-admin');parallel.append(c)
 shared_key=str(uuid.uuid4());shared_body={'scenario':'pass','requiresApproval':True}
 with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
  results=list(pool.map(lambda c:c.request('runs','POST',shared_body,{'Idempotency-Key':shared_key}),parallel))
 assert len({r['id'] for r in results})==1
 simultaneous_id=completed(admin,results[0])['id']
 with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
  decisions=['approved','rejected','approved','rejected'];list(pool.map(lambda pair:pair[0].request('runs/'+simultaneous_id+'/reviews','POST',{'decision':pair[1],'reason':'Synthetic concurrent review'}),zip(parallel,decisions)))
 ordered=admin.request('runs/'+simultaneous_id+'/reviews');assert len(ordered)==4 and all(ordered[i]['review_sequence']>ordered[i+1]['review_sequence'] for i in range(3));assert admin.request('runs/'+simultaneous_id+'/gate')['deploymentAllowed']==(ordered[0]['decision']=='approved');check('concurrent idempotency converges and latest serialized review controls gate')
 stage='validation';admin.request('runs','POST',{'scenario':'external','requiresApproval':True},{'Idempotency-Key':str(uuid.uuid4())},expected=400);admin.request('runs','POST',{'scenario':'pass','requiresApproval':True,'organizationId':credentials[-1]['organizationId']},{'Idempotency-Key':str(uuid.uuid4())},expected=400);admin.request('runs','POST',body,expected=400)
 for invalid in [{'scenario':'pass'},{'scenario':'pass','requiresApproval':None},{'scenario':'pass','requiresApproval':'false'}]:admin.request('runs','POST',invalid,{'Idempotency-Key':str(uuid.uuid4())},expected=400)
 admin.request('runs','POST',{'scenario':'pass','requiresApproval':True,'padding':'x'*17000},{'Idempotency-Key':str(uuid.uuid4())},expected=413)
 check('invalid scenarios tenant fields missing idempotency omitted approval and oversized JSON refused')
 if base.endswith('4320'):
  stage='proxy';admin.request('runs','POST',body,{'Idempotency-Key':str(uuid.uuid4()),'Origin':'http://foreign.invalid'},expected=403);check('same-origin frontend proxy refuses foreign writes')
 stage='logout';
 for client in clients:client.logout()
 again=Client();again.login('demo-admin');again.logout();check('credential erasure preserves later login and tenant scope')
 report['ownSessionsLoggedOut']=True;report['completed']=True;report['representativeRunIds']={k:v['id'] for k,v in records.items()}
except Exception as error:
 report['failedStage']=stage;report['errorType']=type(error).__name__
 if isinstance(error,urllib.error.HTTPError):report['unexpectedHttpStatus']=error.code
finally:
 cleanup=True
 for client in clients:
  try:client.logout()
  except Exception:cleanup=False
 report['ownSessionsLoggedOut']=cleanup and all(not c.logged for c in clients);report['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();path=pathlib.Path('.local')/('stack-http-smoke-'+str(uuid.uuid4())+'.json');path.open('x',encoding='utf-8').write(json.dumps(report,indent=2)+'\n');print(json.dumps({'completed':report['completed'],'checks':len(report['checks']),'ownSessionsLoggedOut':report['ownSessionsLoggedOut'],'failedStage':report.get('failedStage'),'errorType':report.get('errorType'),'unexpectedHttpStatus':report.get('unexpectedHttpStatus'),'responseCode':report.get('responseCode'),'reportPath':str(path)}))
if not report['completed'] or not report['ownSessionsLoggedOut']:raise SystemExit(1)
