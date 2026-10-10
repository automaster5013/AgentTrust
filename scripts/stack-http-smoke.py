"""Real HTTP contract checks against isolated Spring/PostgreSQL stack. Never prints credentials."""
import argparse,concurrent.futures,http.cookiejar,json,pathlib,urllib.request,urllib.error,urllib.parse,uuid,datetime,time
p=argparse.ArgumentParser();p.add_argument('--base',default='http://127.0.0.1:4321');p.add_argument('--credentials',default='.local/stack/demo-credentials.json');args=p.parse_args();assert args.base in ['http://127.0.0.1:4321','http://127.0.0.1:4320'];base=args.base;prefix='/backend/' if base.endswith('4320') else '/api/'
credentials=json.loads(pathlib.Path(args.credentials).read_text(encoding='utf-8'));report={'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'base':base,'synthetic':True,'legacyDatabaseWrites':False,'serverDeployed':False,'completed':False,'checks':[],'ownSessionsLoggedOut':False};clients=[];stage='initialize'
class Client:
 def __init__(self):self.jar=http.cookiejar.CookieJar();self.opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar));self.token=None;self.logged=False;clients.append(self)
 def request(self,path,method='GET',data=None,headers=None,expected=200):
  hs={'Accept':'application/json',**(headers or {})};body=None
  if method=='POST':
   hs.setdefault('Origin',base)
   if self.token:hs['X-CSRF-TOKEN']=self.token
   if isinstance(data,dict):body=json.dumps(data).encode();hs['Content-Type']='application/json'
   elif data is not None:body=data.encode();hs['Content-Type']='application/x-www-form-urlencoded'
  req=urllib.request.Request(base+prefix+path,data=body,headers=hs,method=method)
  try:response=self.opener.open(req,timeout=15)
  except urllib.error.HTTPError as error:response=error
  status=response.status;raw=response.read(1048577);response.close()
  if status!=expected:
   report['unexpectedHttpStatus']=status;report['expectedHttpStatus']=expected
   try:
    code=json.loads(raw).get('code');report['responseCode']=code if isinstance(code,str) and code.isascii() and code.replace('_','').isalpha() else None
   except Exception:pass
  assert status==expected,f'Unexpected HTTP status at {path}: {status}';assert len(raw)<=1048576
  return json.loads(raw) if raw else None
 def csrf(self):self.token=self.request('csrf')['token'];assert len(self.token)<=2048
 def login(self,name):
  self.csrf();u=next(x for x in credentials if x['username']==name);self.request('login','POST',urllib.parse.urlencode({'username':name,'password':u['password']}));self.logged=True;self.csrf();me=self.request('me');assert me['organizationId']==u['organizationId'] and me['projectId']==u['projectId'] and me['role']==u['role'];return me
 def logout(self):
  if self.logged:self.csrf();self.request('logout','POST',{});self.logged=False;self.request('me',expected=401)
def check(name):report['checks'].append(name)
try:
 stage='anonymous';anonymous=Client();anonymous.request('me',expected=401);anonymous.request('runs','POST',{'scenario':'pass','requiresApproval':True},headers={'Idempotency-Key':'unauthorized-test'},expected=403);check('anonymous and missing CSRF refused')
 stage='login';admin=Client();admin.login('demo-admin');editor=Client();editor.login('demo-editor');viewer=Client();viewer.login('demo-viewer');other=Client();other.login('other-admin');check('four authenticated identities retain tenant and role')
 stage='evaluation';records={}
 for scenario,decision,state in [('pass','pass','succeeded'),('block','block','succeeded'),('missing_evidence','inconclusive','succeeded'),('error','inconclusive','failed')]:
  r=admin.request('runs','POST',{'scenario':scenario,'requiresApproval':True},{'Idempotency-Key':str(uuid.uuid4())});assert r['decision']==decision and r['state']==state and r['result']['executionEngine']=='python-synthetic';g=admin.request('runs/'+r['id']+'/gate');assert not g['deploymentAllowed'] and not g['signed'];records[scenario]=r
 check('pass block missing evidence error persisted without unsafe permission')
 stage='review';run=records['pass'];editor.request('runs/'+run['id']+'/reviews','POST',{'decision':'approved','reason':'Synthetic review'},expected=403);viewer.request('runs','POST',{'scenario':'pass','requiresApproval':True},{'Idempotency-Key':str(uuid.uuid4())},expected=403)
 admin.request('runs/'+run['id']+'/reviews','POST',{'decision':'approved','reason':'Synthetic approval'});assert admin.request('runs/'+run['id']+'/gate')['deploymentAllowed'];admin.request('runs/'+run['id']+'/reviews','POST',{'decision':'rejected','reason':'Synthetic revocation'});assert not admin.request('runs/'+run['id']+'/gate')['deploymentAllowed'];assert len(admin.request('runs/'+run['id']+'/reviews'))==2
 admin.request('runs/'+records['block']['id']+'/reviews','POST',{'decision':'approved','reason':'Cannot override failed evaluation'},expected=409);check('administrator approval then rejection and nonpass refusal')
 stage='tenant';other.request('runs/'+run['id'],expected=404);other.request('runs/'+run['id']+'/gate',expected=404);other.request('runs/'+run['id']+'/reviews','POST',{'decision':'approved','reason':'Foreign'},expected=404);assert not any(r['id']==run['id'] for r in other.request('runs'));assert any(r['id']==run['id'] for r in viewer.request('runs'));check('foreign tenant reads and reviews refused; viewer own reads allowed')
 stage='idempotency';key=str(uuid.uuid4());body={'scenario':'pass','requiresApproval':False};first=editor.request('runs','POST',body,{'Idempotency-Key':key});second=editor.request('runs','POST',body,{'Idempotency-Key':key});assert first['id']==second['id'];assert editor.request('runs/'+first['id']+'/gate')['deploymentAllowed'];editor.request('runs','POST',{'scenario':'block','requiresApproval':False},{'Idempotency-Key':key},expected=409);check('same request converges and changed request conflicts')
 stage='concurrency';parallel=[]
 for _ in range(4):
  c=Client();c.login('demo-admin');parallel.append(c)
 shared_key=str(uuid.uuid4());shared_body={'scenario':'pass','requiresApproval':True}
 with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
  results=list(pool.map(lambda c:c.request('runs','POST',shared_body,{'Idempotency-Key':shared_key}),parallel))
 assert len({r['id'] for r in results})==1
 simultaneous_id=results[0]['id']
 with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
  decisions=['approved','rejected','approved','rejected'];list(pool.map(lambda pair:pair[0].request('runs/'+simultaneous_id+'/reviews','POST',{'decision':pair[1],'reason':'Synthetic concurrent review'}),zip(parallel,decisions)))
 ordered=admin.request('runs/'+simultaneous_id+'/reviews');assert len(ordered)==4 and all(ordered[i]['review_sequence']>ordered[i+1]['review_sequence'] for i in range(3));assert admin.request('runs/'+simultaneous_id+'/gate')['deploymentAllowed']==(ordered[0]['decision']=='approved');check('concurrent idempotency converges and latest serialized review controls gate')
 stage='validation';admin.request('runs','POST',{'scenario':'external','requiresApproval':True},{'Idempotency-Key':str(uuid.uuid4())},expected=400);admin.request('runs','POST',{'scenario':'pass','requiresApproval':True,'organizationId':credentials[-1]['organizationId']},{'Idempotency-Key':str(uuid.uuid4())},expected=400);admin.request('runs','POST',body,expected=400)
 for invalid in [{'scenario':'pass'},{'scenario':'pass','requiresApproval':None}]:admin.request('runs','POST',invalid,{'Idempotency-Key':str(uuid.uuid4())},expected=400)
 check('invalid scenarios tenant fields missing idempotency and omitted approval refused')
 if base.endswith('4320'):
  stage='proxy';admin.request('runs','POST',body,{'Idempotency-Key':str(uuid.uuid4()),'Origin':'http://foreign.invalid'},expected=403);check('same-origin frontend proxy refuses foreign writes')
 stage='logout';
 for client in clients:client.logout()
 again=Client();again.login('demo-admin');again.logout();check('credential erasure preserves later login and tenant scope')
 report['ownSessionsLoggedOut']=True;report['completed']=True;report['representativeRunIds']={k:v['id'] for k,v in records.items()}
except Exception:
 report['failedStage']=stage
finally:
 cleanup=True
 for client in clients:
  try:client.logout()
  except Exception:cleanup=False
 report['ownSessionsLoggedOut']=cleanup and all(not c.logged for c in clients);report['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();path=pathlib.Path('.local')/('stack-http-smoke-'+str(uuid.uuid4())+'.json');path.open('x',encoding='utf-8').write(json.dumps(report,indent=2)+'\n');print(json.dumps({'completed':report['completed'],'checks':len(report['checks']),'ownSessionsLoggedOut':report['ownSessionsLoggedOut'],'failedStage':report.get('failedStage'),'reportPath':str(path)}))
if not report['completed'] or not report['ownSessionsLoggedOut']:raise SystemExit(1)
