"""Read-only actual local Keycloak client inspection with adverse configuration controls."""
import copy,datetime,json,pathlib,subprocess,sys,uuid
from stack_oidc_client_contract import expected,verify
from stack_identity_admin import IdentityAdmin
ROOT=pathlib.Path(__file__).resolve().parent.parent
report={'completed':False,'identityConfigurationModified':False,'rawTokensPrinted':False,'clientSecretPrinted':False,'productionIdentityChecked':False}
try:
 profile='https-review';origin='https://console.example.com';issuer='https://identity.example.com/realms/agenttrust';fixture=expected(profile,origin,issuer);assert verify(fixture,profile,origin,issuer);checks=1
 for key,value in [('clientId','another-client'),('enabled',False),('protocol','saml'),('publicClient',True),('standardFlowEnabled',False),('implicitFlowEnabled',True),('implicitFlowEnabled',0),('directAccessGrantsEnabled',True),('serviceAccountsEnabled',True),('redirectUris',[origin+'/*']),('redirectUris',[origin+'/backend/login/oauth2/code/keycloak','https://other.example.com/*']),('webOrigins',['*']),('webOrigins',[origin,'https://other.example.com'])]:
  invalid=copy.deepcopy(fixture);invalid[key]=value
  try:verify(invalid,profile,origin,issuer)
  except ValueError:checks+=1
  else:raise AssertionError('Unsafe client settings accepted')
 for key,value in [('pkce.code.challenge.method','plain'),('post.logout.redirect.uris',origin+'/*')]:
  invalid=copy.deepcopy(fixture);invalid['attributes'][key]=value
  try:verify(invalid,profile,origin,issuer)
  except ValueError:checks+=1
  else:raise AssertionError('Unsafe client attributes accepted')
 with IdentityAdmin(ROOT) as admin:
  clients=admin.request('/clients?clientId=agenttrust-console');assert len(clients)==1
  assert verify(clients[0],'local-review','http://127.0.0.1:4320','http://127.0.0.1:4322/realms/agenttrust')
  local=expected('local-review','http://127.0.0.1:4320','http://127.0.0.1:4322/realms/agenttrust')
  public={key:clients[0][key] for key in local if key!='attributes'}
  public['attributes']={key:clients[0]['attributes'][key] for key in local['attributes']}
 # Only public configuration fields reach the child process; tokens/secret stay in the administrator helper.
 result=subprocess.run([sys.executable,'scripts/stack-oidc-client-config.py','--mode','check','--profile','local-review','--application-origin','http://127.0.0.1:4320','--public-issuer','http://127.0.0.1:4322/realms/agenttrust'],cwd=ROOT,input=json.dumps(public).encode(),capture_output=True,timeout=10)
 value=json.loads(result.stdout);assert result.returncode==0 and value['completed'] and value['clientContractMatches'] and not value['identityContacted'] and not value['inputEchoed']

 report.update(completed=True,checks=checks+2,actualLocalClientVerified=True,actualPublicProjectionCliVerified=True,administratorSessionClosed=True,httpsControlsSynthetic=True)
except Exception as error:report.update(errorType=type(error).__name__,code='OIDC_CLIENT_CONTRACT_UNVERIFIED')
finally:
 report['checkedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();path=ROOT/'.local'/('stack-oidc-client-contract-'+str(uuid.uuid4())+'.json');path.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print(json.dumps({'completed':report['completed'],'checks':report.get('checks'),'reportPath':str(path)}))
if not report['completed']:raise SystemExit(1)
