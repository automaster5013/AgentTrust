"""Actual CLI process controls: public draft, exact settings, malformed and unsafe input."""
import datetime,json,pathlib,subprocess,sys,uuid
from stack_oidc_client_contract import expected
ROOT=pathlib.Path(__file__).resolve().parent.parent
ARGS=[sys.executable,'scripts/stack-oidc-client-config.py','--profile','https-review','--application-origin','https://console.example.com','--public-issuer','https://identity.example.com/realms/agenttrust']
report={'completed':False,'identityContacted':False,'configurationApplied':False}
def invoke(mode,raw=b'',success=True):
 result=subprocess.run(ARGS+['--mode',mode],cwd=ROOT,input=raw,capture_output=True,timeout=10);value=json.loads(result.stdout)
 assert result.returncode==(0 if success else 1) and value['completed']==success and not value['identityContacted'] and not value['configurationApplied']
 if not success:assert value['code']=='OIDC_CLIENT_CONFIGURATION_UNVERIFIED' and 'publicClientSettings' not in value
 return value
try:
 wanted=expected('https-review','https://console.example.com','https://identity.example.com/realms/agenttrust');assert invoke('draft')['publicClientSettings']==wanted
 invoke('check',json.dumps(wanted).encode());checks=2
 for raw in [b'{}',b'[]',b'{',b'\xff',b'{"clientId":"a","clientId":"b"}',b'{"x":NaN}',b'{"x":1e999}',b' '*1048577]:invoke('check',raw,False);checks+=1
 unsafe=dict(wanted);unsafe['redirectUris']=['https://console.example.com/*'];invoke('check',json.dumps(unsafe).encode(),False);checks+=1
 marker='SYNTHETIC_PRIVATE_MARKER_NOT_A_CREDENTIAL';unsafe['secret']=marker
 result=subprocess.run(ARGS+['--mode','check'],cwd=ROOT,input=json.dumps(unsafe).encode(),capture_output=True,timeout=10);assert result.returncode==1 and marker.encode() not in result.stdout+result.stderr;checks+=1
 for key,value in [('implicitFlowEnabled',True),('implicitFlowEnabled',0),('publicClient','false'),('standardFlowEnabled',1),('redirectUris','https://console.example.com/backend/login/oauth2/code/keycloak'),('attributes',None)]:
  invalid=dict(wanted);invalid[key]=value;invoke('check',json.dumps(invalid).encode(),False);checks+=1
 missing=dict(wanted);del missing['implicitFlowEnabled'];invoke('check',json.dumps(missing).encode(),False);checks+=1
 report.update(completed=True,checks=checks,inputEchoRefused=True)
except Exception as error:report.update(errorType=type(error).__name__,code='OIDC_CLIENT_CLI_CONTROLS_UNVERIFIED')
finally:
 report['checkedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();path=ROOT/'.local'/('stack-oidc-client-config-'+str(uuid.uuid4())+'.json');path.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print(json.dumps({'completed':report['completed'],'checks':report.get('checks'),'reportPath':str(path)}))
if not report['completed']:raise SystemExit(1)
