"""Actual OIDC login, refused credential grants and signed session revocation."""
import datetime,json,pathlib,time,urllib.request,urllib.error,urllib.parse,uuid,traceback,re
from stack_test_client import StackClient
from stack_identity_admin import IdentityAdmin
root=pathlib.Path(__file__).resolve().parent.parent;credentials=json.loads((root/'.local/stack/demo-credentials.json').read_text(encoding='utf-8'));clients=[];stage='prepare';report={'completed':False,'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'synthetic':True,'checks':[],'rawTokensPrinted':False}
def refused(url,body,expected):
 request=urllib.request.Request(url,data=urllib.parse.urlencode(body).encode(),method='POST')
 try:
  with urllib.request.urlopen(request,timeout=10) as response:status=response.status;raw=response.read(65537)
 except urllib.error.HTTPError as error:status=error.code;raw=error.read(65537)
 assert status==expected and len(raw)<=65536;return json.loads(raw)
try:
 stage='refused-grants';secret=(root/'.local/stack/oidc-client-secret').read_text(encoding='utf-8');user=next(row for row in credentials if row['username']=='demo-admin')
 denied=refused('http://127.0.0.1:4322/realms/agenttrust/protocol/openid-connect/token',{'client_id':'agenttrust-console','client_secret':secret,'grant_type':'password','username':user['username'],'password':user['password']},400);assert denied['error']=='unauthorized_client';report['checks'].append('application direct password grant refused by real Keycloak')
 stranger=StackClient('http://127.0.0.1:4320',credentials,report,clients);stranger.request('login/oauth2/code/keycloak?code=invalid-code&state=invalid-state',expected=401);stranger.request('me',expected=401);report['checks'].append('unsolicited callback cannot create an authenticated session')
 invalid=refused('http://127.0.0.1:4321/logout/connect/back-channel/keycloak',{'logout_token':'invalid.unsigned.token'},400);report['checks'].append('unsigned back-channel logout token refused')
 stage='login-and-revoke'
 with IdentityAdmin(root) as admin:
  before={row['id'] for row in admin.request('/users/'+user['actorId']+'/sessions')}
  own=StackClient('http://127.0.0.1:4320',credentials,report,clients);own.login('demo-admin');other=StackClient('http://127.0.0.1:4320',credentials,report,clients);other.login('other-admin')
  after={row['id'] for row in admin.request('/users/'+user['actorId']+'/sessions')};created=after-before;report['newProviderSessions']=len(created);assert len(created)==1;sid=created.pop();assert re.fullmatch('[A-Za-z0-9_-]{16,128}',sid)
  admin.request('/sessions/'+sid,'DELETE');deadline=time.monotonic()+10
  while time.monotonic()<deadline:
   try:own.request('me',expected=401);break
   except AssertionError:time.sleep(.25)
  else:raise AssertionError('SESSION_NOT_REVOKED')
  other.request('me');report['checks'].append('signed provider back-channel revokes only the created session; foreign organization remains authenticated')
 stage='logout'
 for client in clients:client.logout()
 report['completed']=True
except Exception as error:report['failedStage']=stage;report['errorType']=type(error).__name__;report['failureLocations']=[{'file':pathlib.Path(t.filename).name,'line':t.lineno} for t in traceback.extract_tb(error.__traceback__)];report['httpStatus']=error.code if isinstance(error,urllib.error.HTTPError) else None
finally:
 closed=True
 for client in clients:
  try:client.logout()
  except Exception:closed=False
 report['ownSessionsLoggedOut']=closed and all(not client.logged for client in clients);report['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();directory=root/'.local';directory.mkdir(exist_ok=True);path=directory/('stack-identity-smoke-'+str(uuid.uuid4())+'.json');path.open('x',encoding='utf-8').write(json.dumps(report,indent=2)+'\n');print(json.dumps({'completed':report['completed'],'checks':len(report['checks']),'ownSessionsLoggedOut':report['ownSessionsLoggedOut'],'failedStage':report.get('failedStage'),'reportPath':str(path)}))
if not report['completed'] or not report['ownSessionsLoggedOut']:raise SystemExit(1)
