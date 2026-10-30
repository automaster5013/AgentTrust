"""Fixed fixture-only historical reads, queued replay and session restart probes.
The admit capsule contains a fixture cookie: orchestrator must capture/encrypt it,
never print it, and remove its owner-private temporary mount during cleanup.
"""
import argparse,datetime,hashlib,hmac,http.cookiejar,json,pathlib,re,time,urllib.error,urllib.parse,urllib.request,uuid
from stack_test_client import StackClient,FixedRedirects
from stack_recovery_transport import fixture_opener

def require(value):
 if not value:raise ValueError('Stateful fixture probe refused')

class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):raise ValueError('Object redirect refused')

def signed_object(row,user,password):
 key=row['object_key'];version=row['version_id']
 require(re.fullmatch(r'organizations/[a-f0-9-]{36}/projects/[a-f0-9-]{36}/(?:runs|campaigns)/[a-f0-9-]{36}/[a-f0-9]{64}\.json',key))
 require(re.fullmatch('[A-Za-z0-9._-]{1,128}',version) and version!='null' and user=='stack-evidence' and re.fullmatch('[a-f0-9]{64}',password))
 require(type(row['content_bytes']) is int and 1<=row['content_bytes']<=16384 and re.fullmatch('[a-f0-9]{64}',row['content_sha256']))
 stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ');date=stamp[:8];body=hashlib.sha256(b'').hexdigest()
 path='/stack-evidence/'+key;query='versionId='+urllib.parse.quote(version,safe='-_.~');host='stack-object-store:9000'
 headers='host:'+host+'\nx-amz-content-sha256:'+body+'\nx-amz-date:'+stamp+'\n';signed='host;x-amz-content-sha256;x-amz-date';scope=date+'/us-east-1/s3/aws4_request'
 canonical='GET\n'+path+'\n'+query+'\n'+headers+'\n'+signed+'\n'+body
 value=('AWS4'+password).encode()
 for part in (date,'us-east-1','s3','aws4_request'):value=hmac.new(value,part.encode(),hashlib.sha256).digest()
 message='AWS4-HMAC-SHA256\n'+stamp+'\n'+scope+'\n'+hashlib.sha256(canonical.encode()).hexdigest()
 authorization='AWS4-HMAC-SHA256 Credential='+user+'/'+scope+', SignedHeaders='+signed+', Signature='+hmac.new(value,message.encode(),hashlib.sha256).hexdigest()
 request=urllib.request.Request('http://'+host+path+'?'+query,headers={'X-Amz-Date':stamp,'X-Amz-Content-Sha256':body,'Authorization':authorization})
 with urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect()).open(request,timeout=5) as response:
  content=response.read(16385);require(response.status==200 and response.headers.get('x-amz-version-id')==version)
 require(len(content)==row['content_bytes'] and hashlib.sha256(content).hexdigest()==row['content_sha256'])

def client():
 credentials=json.loads(pathlib.Path('/credentials.json').read_bytes());value=StackClient('http://127.0.0.1:4320',credentials,{})
 value.opener=fixture_opener(value.jar,FixedRedirects());return value

def capsule_client(capsule):
 value=client();cookie=capsule['cookie'];require(re.fullmatch('[A-Za-z0-9._-]{1,256}',cookie))
 value.jar.set_cookie(http.cookiejar.Cookie(0,'AGENTTRUST_STACK_SESSION',cookie,None,False,'127.0.0.1',False,False,'/',True,False,None,True,None,None,{},False))
 return value

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--phase',choices=('historical','admit','completion','reauth'),required=True);args=parser.parse_args()
 report={'completed':False,'phase':args.phase,'paidProviderCallsPerformed':False};value=None
 try:
  if args.phase=='historical':
   rows=json.loads(pathlib.Path('/state-input.json').read_bytes())['objectReferences'];require(0<len(rows)<=4096)
   user=pathlib.Path('/run/secrets/stack-minio-user').read_text();password=pathlib.Path('/run/secrets/stack-minio-password').read_text()
   for row in rows:signed_object(row,user,password)
   report.update(historicalObjectVersionsVerified=len(rows),allPinnedVersionIdsAndBytesVerified=True)
  elif args.phase=='admit':
   value=client();value.login('demo-admin');run=value.request('runs','POST',{'scenario':'pass','requiresApproval':True},{'Idempotency-Key':str(uuid.uuid4())})
   require(run['state']=='queued');cookies=[c.value for c in value.jar if c.name=='AGENTTRUST_STACK_SESSION'];require(len(cookies)==1)
   report['capsule']={'cookie':cookies[0],'runId':run['id']};value=None
  elif args.phase=='completion':
   capsule=json.loads(pathlib.Path('/state-input.json').read_bytes());value=capsule_client(capsule);run_id=str(uuid.UUID(capsule['runId']));until=time.monotonic()+60
   while True:
    run=value.request('runs/'+run_id)
    if run['state']!='queued' or time.monotonic()>=until:break
    time.sleep(.5)
   require(run['state']=='succeeded' and run['decision']=='pass' and run['result']['executionEngine']=='python-synthetic')
   require(value.request('runs/'+run_id+'/gate')['deploymentAllowed'] is False);report['persistedQueuedEvaluationCompleted']=True;value=None
  else:
   capsule=json.loads(pathlib.Path('/state-input.json').read_bytes());old=capsule_client(capsule);old.request('me',expected=401)
   value=client();value.login('demo-admin');require(value.request('me')['organizationId']);value.logout()
   report.update(oldCookieRejectedAfterApiRestart=True,freshOidcLoginVerified=True,sessionReauthenticationRequired=True,existingSessionContinuityVerified=False)
  report['completed']=True
 except Exception as error:report.update(completed=False,errorType=type(error).__name__)
 finally:
  if value is not None:
   try:value.logout()
   except Exception:report['completed']=False
 print(json.dumps(report));return 0 if report['completed'] else 1
if __name__=='__main__':raise SystemExit(main())
