"""Reject unstoreable JSON text through actual OIDC/BFF without business writes."""
import argparse,datetime,http.client,json,pathlib,time,urllib.error,urllib.request,uuid
from stack_test_client import StackClient
from stack_business_fingerprint import fingerprint
ROOT=pathlib.Path(__file__).resolve().parent.parent
parser=argparse.ArgumentParser();parser.add_argument('--stalled-body',action='store_true');args=parser.parse_args()
report={'completed':False,'checks':0,'businessDataWrites':False,'paidApiCalls':False,'credentialsRecorded':False};clients=[]
try:
 before=fingerprint()
 credentials=json.loads((ROOT/'.local/stack/demo-credentials.json').read_text(encoding='utf-8'))
 client=StackClient('http://127.0.0.1:4320',credentials,report,clients);client.login('demo-admin')
 samples=[b'{"description":"\\u0000"}',b'{"description":"\\ud800"}',b'{"description":"\\udc00"}',b'{"\\ud800":1}',b'{"description":"'+bytes([0xc0,0xaf])+b'"}', '{"x":1}'.encode('utf-16-le')]
 for body in samples:
  request=urllib.request.Request(client.base+'/backend/versions/agents',data=body,method='POST',headers={'Accept':'application/json','Content-Type':'application/json','Origin':client.base,'X-CSRF-TOKEN':client.token})
  try:response=client.opener.open(request,timeout=15)
  except urllib.error.HTTPError as error:response=error
  status=response.status;raw=response.read(1025);response.close()
  assert status==400 and len(raw)<=1024 and json.loads(raw)=={'code':'INVALID_JSON_TEXT'}
  report['checks']+=1
 request=urllib.request.Request('http://127.0.0.1:4321/api/versions/agents',data=b'{"description":"same bytes"}',method='POST',headers={'Accept':'application/json','Content-Type':'application/json; charset=ISO-8859-1','Origin':client.base,'X-CSRF-TOKEN':client.token})
 try:response=client.opener.open(request,timeout=15)
 except urllib.error.HTTPError as error:response=error
 status=response.status;raw=response.read(1025);response.close();assert status==400 and len(raw)<=1024 and json.loads(raw)=={'code':'INVALID_JSON_TEXT'};report['checks']+=1
 if args.stalled_body:
  request=urllib.request.Request(client.base+'/backend/runs',method='POST');client.jar.add_cookie_header(request);cookie=request.get_header('Cookie')
  assert cookie and len(cookie)<=4096 and '\r' not in cookie and '\n' not in cookie
  connection=http.client.HTTPConnection('127.0.0.1',4320,timeout=15);started=time.monotonic();status=None
  try:
   connection.putrequest('POST','/backend/runs');connection.putheader('Content-Type','application/json');connection.putheader('Transfer-Encoding','chunked');connection.putheader('Origin',client.base);connection.putheader('X-CSRF-TOKEN',client.token);connection.putheader('Cookie',cookie);connection.endheaders()
   chunk=b'{"scenario":"pass"';connection.send(format(len(chunk),'x').encode('ascii')+b'\r\n'+chunk+b'\r\n')
   try:
    response=connection.getresponse();status=response.status;raw=response.read(1025);assert len(raw)<=1024 and status in [502,408];response.close()
   except http.client.RemoteDisconnected:status=0
   elapsed=time.monotonic()-started;assert 9<=elapsed<15
   report.update(stalledBodyReleased=True,stalledBodyElapsedSeconds=round(elapsed,3),stalledBodyHttpStatus=status);report['checks']+=1
  finally:connection.close()
 assert fingerprint()==before
 report.update(completed=True,businessTablesUnchanged=len(before))
except Exception as error:report.update(errorType=type(error).__name__,code='JSON_TEXT_BOUNDARY_UNVERIFIED')
finally:
 closed=True
 for client in reversed(clients):
  try:client.logout()
  except Exception:closed=False
 report.update(ownSessionsLoggedOut=closed,finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
 path=ROOT/'.local'/('stack-json-text-'+str(uuid.uuid4())+'.json');path.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
 print(json.dumps({'completed':report['completed'],'checks':report['checks'],'ownSessionsLoggedOut':closed,'reportPath':str(path)}))
if not report['completed'] or not closed:raise SystemExit(1)
