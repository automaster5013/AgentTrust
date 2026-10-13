"""Actual console image metadata and startup mismatch controls."""
import datetime,json,pathlib,subprocess,sys,uuid
ROOT=pathlib.Path(__file__).resolve().parent.parent
IMAGE='agenttrust-stack-console:oidc-endpoint-https-candidate'
report={'completed':False,'checks':[],'networkUsed':False,'deploymentPerformed':False,'privateInputsMounted':False,'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
def verify(origin,issuer,expected,profile="https-review",image=IMAGE,preflight=False):
 args=[sys.executable,'scripts/stack-oidc-image-config.py','--image',image,'--profile',profile,'--application-origin',origin,'--public-issuer',issuer]
 result=subprocess.run(args,cwd=ROOT,capture_output=True,text=True,encoding='utf-8',timeout=40)
 value=json.loads(result.stdout);assert result.returncode==expected and value['completed']==(expected==0) and not value['imageBytesAuthenticatedHere'] and not value['deploymentPerformed']
 if preflight:assert value['errorType']=='ValueError' and value['code']=='OIDC_IMAGE_CONFIGURATION_UNVERIFIED'
try:
 verify('https://console.example.com','https://identity.example.com/realms/agenttrust',0);report['checks'].append('actual-image-labels-match-configured-endpoints')
 verify('https://other.example.com','https://identity.example.com/realms/agenttrust',1);report['checks'].append('different-valid-origin-refused')
 verify('https://console.example.com','https://other.example.com/realms/agenttrust',1);report['checks'].append('different-valid-issuer-refused')
 for name,value in [('NEXT_PUBLIC_STACK_OIDC_PROFILE','local-review'),('NEXT_PUBLIC_STACK_APPLICATION_ORIGIN','https://other.example.com'),('NEXT_PUBLIC_STACK_PUBLIC_ISSUER','https://other.example.com/realms/agenttrust')]:
  result=subprocess.run(['docker','run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','256m','--pids-limit','64','-e',name+'='+value,IMAGE],cwd=ROOT,capture_output=True,text=True,encoding='utf-8',timeout=30)
  assert result.returncode==1 and result.stderr.strip()=='OIDC_IMAGE_CONFIGURATION_MISMATCH';report['checks'].append(name.lower()+'-startup-mismatch-refused')
 for name,origin in [('http-downgrade','http://console.example.com'),('userinfo','https://user@console.example.com'),('explicit-port','https://console.example.com:443'),('origin-path','https://console.example.com/'),('fragment','https://console.example.com#ignored'),('query','https://console.example.com?ignored=1'),('ipv4','https://127.0.0.1'),('local-suffix','https://console.local'),('uppercase','https://Console.example.com'),('wildcard','https://*.example.com')]:
  verify(origin,'https://identity.example.com/realms/agenttrust',1,preflight=True);report['checks'].append(name+'-refused-before-image-inspection')
 for name,issuer in [('different-realm','https://identity.example.com/realms/other'),('encoded-realm','https://identity.example.com/realms/%61genttrust'),('issuer-query','https://identity.example.com/realms/agenttrust?x=1')]:
  verify('https://console.example.com',issuer,1,preflight=True);report['checks'].append(name+'-refused-before-image-inspection')
 verify('https://console.example.com','https://identity.example.com/realms/agenttrust',1,profile='production',preflight=True);report['checks'].append('unknown-profile-refused-before-image-inspection')
 verify('http://localhost:4320','http://127.0.0.1:4322/realms/agenttrust',1,profile='local-review',preflight=True);report['checks'].append('local-override-refused-before-image-inspection')
 for image in ['ghcr.io/automaster5013/agenttrust-console:main','ghcr.io/another/agenttrust-console@sha256:'+'1'*64]:
  verify('https://console.example.com','https://identity.example.com/realms/agenttrust',1,image=image,preflight=True);report['checks'].append('mutable-or-foreign-image-refused-before-image-inspection')
 report['completed']=True
except Exception as error:report.update(errorType=type(error).__name__,code='OIDC_IMAGE_CONTROLS_UNVERIFIED')
finally:
 report['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();path=ROOT/'.local'/('stack-oidc-image-config-'+str(uuid.uuid4())+'.json');path.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print(json.dumps({'completed':report['completed'],'checks':len(report['checks']),'reportPath':str(path)}))
if not report['completed']:raise SystemExit(1)
