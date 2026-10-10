"""Real WebFlux/Redis quotas, scoped limits, AOF recovery and closed outage behavior."""
import datetime,json,pathlib,subprocess,time,urllib.request,urllib.error,uuid,traceback
from stack_test_client import StackClient
from stack_compose import stack_compose
root=pathlib.Path(__file__).resolve().parent.parent;credentials=json.loads((root/'.local/stack/demo-credentials.json').read_text(encoding='utf-8'));clients=[];stopped=False;stage='prepare';report={'completed':False,'checks':[],'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'synthetic':True,'legacyServicesChanged':False,'rawSecretsPrinted':False}
def command(args):return subprocess.run(args,cwd=root,capture_output=True,text=True,check=True).stdout
def request(client,path,method='GET',body=None,headers=None):
 hs={'Accept':'application/json',**(headers or {})};data=None
 if body is not None:
  data=json.dumps(body).encode();hs['Content-Type']='application/json';hs['Origin']='http://127.0.0.1:4323'
  if client.token:hs['X-CSRF-TOKEN']=client.token
 try:response=client.opener.open(urllib.request.Request('http://127.0.0.1:4323'+path,data=data,headers=hs,method=method),timeout=12)
 except urllib.error.HTTPError as error:response=error
 with response:raw=response.read(1048577);assert len(raw)<=1048576;return response.status,dict(response.headers),json.loads(raw) if raw else None
try:
 for service in ['stack-gateway','stack-redis']:
  state=json.loads(command(['docker','inspect','agenttrust-'+service+'-1']))[0];assert state['Config']['Labels']['com.docker.compose.project']=='agenttrust' and state['Config']['Labels']['com.docker.compose.service']==service
 stage='redis-acl'
 code="""
import socket,sys,json
token=sys.stdin.read();connection=socket.create_connection(('stack-redis',6379),timeout=3);stream=connection.makefile('rb')
def send(*args):
 data=('*'+str(len(args))+'\\r\\n').encode()+b''.join(('$'+str(len(arg.encode()))+'\\r\\n').encode()+arg.encode()+b'\\r\\n' for arg in args);connection.sendall(data);line=stream.readline(8193);assert len(line)<=8192;return line
assert send('PING').startswith(b'-NOAUTH')
assert send('AUTH','default',token).startswith(b'-WRONGPASS')
assert send('AUTH','stack-gateway',token)==b'+OK\\r\\n'
for args in [('GET','foreign:scope'),('SET','stack:quota:probe','1'),('FLUSHALL',),('INFO',)]:assert send(*args).startswith(b'-NOPERM')
connection.close();print(json.dumps({'completed':True,'anonymousAndDefaultUserRefused':True,'gatewayCannotReadForeignKeysOrSetDeleteConfigure':True}))
"""
 token=(root/'.local/stack/redis-token').read_text(encoding='utf-8');proof=subprocess.run(['docker','exec','-i','agenttrust-stack-ai-worker-1','python','-c',code],cwd=root,input=token,capture_output=True,text=True,check=True);assert json.loads(proof.stdout)['completed'];report['checks'].append('real Redis refuses anonymous/default authentication, foreign keys, SET, FLUSHALL and INFO')
 stage='routing';anonymous=StackClient('http://127.0.0.1:4323',credentials,report,clients);assert request(anonymous,'/api/me')[0]==401;assert request(anonymous,'/internal/completions','POST',{})[0]==404;assert request(anonymous,'/api/runs','DELETE')[0]==404;report['checks'].append('anonymous protected requests and internal or unsupported routes refused')
 own=StackClient('http://127.0.0.1:4323',credentials,report,clients);own.login('demo-admin');viewer=StackClient('http://127.0.0.1:4323',credentials,report,clients);viewer.login('demo-viewer');other=StackClient('http://127.0.0.1:4323',credentials,report,clients);other.login('other-admin')
 # Earlier tests share these project quotas. Let their existing windows expire;
 # never delete Redis counters or weaken the application limit for a smoke test.
 stage='prior-window-expiry';until=time.monotonic()+62
 while time.monotonic()<until:time.sleep(min(1,until-time.monotonic()))
 report['priorQuotaWindowsExpiredNaturally']=True
 assert request(own,'/api/me',headers={'X-Organization-Id':credentials[-1]['organizationId'],'Authorization':'Bearer caller-controlled'})[2]['organizationId']==credentials[0]['organizationId'];report['checks'].append('authenticated identity wins over caller-controlled scope headers')
 stage='write-quota';own.csrf();key=str(uuid.uuid4());run_id=None;writes=0
 for attempt in range(61):
  status,headers,value=request(own,'/api/runs','POST',{'scenario':'pass','requiresApproval':True},{'Idempotency-Key':key})
  if status==429:assert value['code']=='RATE_LIMITED' and 1<=int(headers['Retry-After'])<=60;write_expiry=time.monotonic()+int(headers['Retry-After'])+2;break
  assert status==200;writes+=1
  if run_id is None:run_id=value['id']
  else:assert value['id']==run_id
 else:raise AssertionError('WRITE_LIMIT_NOT_ENFORCED')
 assert 0<writes<=60;report['admittedIdempotentWrites']=writes;report['checks'].append('shared organization write window returns 429 and retains one idempotent run')
 stage='read-quota';reads=0
 for attempt in range(241):
  status,headers,value=request(own,'/api/me')
  if status==429:assert value['code']=='RATE_LIMITED' and 1<=int(headers['Retry-After'])<=60;expiry=max(write_expiry,time.monotonic()+int(headers['Retry-After'])+2);break
  assert status==200 and headers['X-AgentTrust-Gateway']=='spring-webflux';reads+=1
 else:raise AssertionError('READ_LIMIT_NOT_ENFORCED')
 report['admittedReads']=reads;assert 0<reads<=240,'NO_FRESH_READ_WINDOW';assert request(viewer,'/api/me')[0]==429,'VIEWER_QUOTA_NOT_SHARED';assert request(other,'/api/me')[0]==200,'FOREIGN_ORGANIZATION_UNAVAILABLE';report['checks'].append('same organization shares a read quota; foreign organization remains available')
 stage='redis-restart';command(stack_compose(root)+['restart','stack-redis']);command(stack_compose(root)+['up','-d','--no-build','--wait','stack-redis','stack-gateway']);assert request(own,'/api/me')[0]==429;report['checks'].append('Redis AOF preserves active quota across graceful restart')
 stage='redis-outage';command(stack_compose(root)+['stop','stack-redis']);stopped=True;status,headers,value=request(other,'/api/me');assert status==503 and value['code']=='GATEWAY_UNAVAILABLE';report['checks'].append('unavailable Redis refuses authenticated requests instead of bypassing quota')
 command(stack_compose(root)+['up','-d','--no-build','--wait','stack-redis','stack-gateway']);stopped=False;assert request(other,'/api/me')[0]==200;report['checks'].append('restored Redis resumes scoped authenticated traffic')
 stage='logout'
 for client in clients:client.logout()
 stage='window-expiry'
 while time.monotonic()<expiry:time.sleep(min(1,expiry-time.monotonic()))
 fresh=StackClient('http://127.0.0.1:4323',credentials,report,clients);fresh.login('demo-admin');assert request(fresh,'/api/me')[0]==200;fresh.csrf();status,headers,value=request(fresh,'/api/runs','POST',{'scenario':'pass','requiresApproval':True},{'Idempotency-Key':key});assert status==200 and value['id']==run_id;fresh.logout();report['checks'].append('expired quota windows allow traffic again without deleting counters or creating another run')
 report['completed']=True
except Exception as error:report['failedStage']=stage;report['errorType']=type(error).__name__;report['httpStatus']=error.code if isinstance(error,urllib.error.HTTPError) else None;report['failureLocations']=[{'file':pathlib.Path(t.filename).name,'line':t.lineno} for t in traceback.extract_tb(error.__traceback__)]
finally:
 restored=True
 if stopped:
  try:command(stack_compose(root)+['up','-d','--no-build','--wait','stack-redis','stack-gateway'])
  except Exception:restored=False
 closed=True
 for client in clients:
  try:client.logout()
  except Exception:closed=False
 report['dependenciesRestored']=restored;report['ownSessionsLoggedOut']=closed and all(not c.logged for c in clients);report['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();path=root/'.local'/('stack-gateway-smoke-'+str(uuid.uuid4())+'.json');path.open('x',encoding='utf-8').write(json.dumps(report,indent=2)+'\n');print(json.dumps({'completed':report['completed'],'checks':len(report['checks']),'dependenciesRestored':restored,'ownSessionsLoggedOut':report['ownSessionsLoggedOut'],'failedStage':report.get('failedStage'),'errorType':report.get('errorType'),'admittedReads':report.get('admittedReads'),'priorQuotaWindowsExpiredNaturally':report.get('priorQuotaWindowsExpiredNaturally',False),'failureLocations':report.get('failureLocations',[]),'reportPath':str(path)}))
if not report['completed'] or not report['dependenciesRestored'] or not report['ownSessionsLoggedOut']:raise SystemExit(1)
