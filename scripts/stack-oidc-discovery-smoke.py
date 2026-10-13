"""Read-only local discovery endpoint contract and in-memory downgrade controls."""
import copy,datetime,json,pathlib,urllib.request,uuid
from stack_oidc_json import object_from_bytes
ROOT=pathlib.Path(__file__).resolve().parent.parent
ISSUER='http://127.0.0.1:4322/realms/agenttrust'
report={'completed':False,'identityConfigurationModified':False,'rawTokensPrinted':False,'productionTlsVerified':False,'checks':[]}
def verify(document):
 expected={'issuer':ISSUER,'authorization_endpoint':ISSUER+'/protocol/openid-connect/auth','token_endpoint':ISSUER+'/protocol/openid-connect/token','jwks_uri':ISSUER+'/protocol/openid-connect/certs','userinfo_endpoint':ISSUER+'/protocol/openid-connect/userinfo','end_session_endpoint':ISSUER+'/protocol/openid-connect/logout'}
 if any(document.get(key)!=value for key,value in expected.items()):raise ValueError('OIDC_DISCOVERY_CONTRACT_UNVERIFIED')
 for key,value in [('response_types_supported','code'),('grant_types_supported','authorization_code'),('code_challenge_methods_supported','S256'),('token_endpoint_auth_methods_supported','client_secret_basic'),('id_token_signing_alg_values_supported','RS256')]:
  values=document.get(key)
  if not isinstance(values,list) or value not in values:raise ValueError('OIDC_DISCOVERY_CONTRACT_UNVERIFIED')
 return True
try:
 # Fixed loopback URL only; redirects cannot select an external metadata endpoint.
 class NoRedirect(urllib.request.HTTPRedirectHandler):
  def redirect_request(self,*args):return None
 opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
 with opener.open(ISSUER+'/.well-known/openid-configuration',timeout=10) as response:
  if response.status!=200:raise ValueError('Metadata unavailable')
  raw=response.read(65537)
  if len(raw)>65536:raise ValueError('Metadata exceeds bound')
 document=object_from_bytes(raw,65536);verify(document);report['checks'].append('actual local discovery endpoints and supported authorization contract')
 for key in ['issuer','authorization_endpoint','token_endpoint','jwks_uri','userinfo_endpoint','end_session_endpoint']:
  invalid=copy.deepcopy(document);invalid[key]='https://other.example.com/realms/agenttrust'
  try:verify(invalid)
  except ValueError:report['checks'].append(key+'-mismatch-refused')
  else:raise RuntimeError('Foreign endpoint accepted')
 for key in ['response_types_supported','grant_types_supported','code_challenge_methods_supported','token_endpoint_auth_methods_supported','id_token_signing_alg_values_supported']:
  invalid=copy.deepcopy(document);invalid[key]=[]
  try:verify(invalid)
  except ValueError:report['checks'].append(key+'-missing-support-refused')
  else:raise RuntimeError('Missing support accepted')
 for malformed in [b'[]',b'{"issuer":"first","issuer":"second"}',b'\xff',b'{"unsupported":NaN}',b'{"unsupported":1e999}',b' '*65537]:
  try:object_from_bytes(malformed,65536)
  except (ValueError,UnicodeError):report['checks'].append('malformed-or-oversized-discovery-JSON-refused')
  else:raise RuntimeError('Ambiguous discovery JSON accepted')
 report.update(completed=True,actualLocalDiscoveryRead=True,authenticationPerformed=False)
except Exception as error:report.update(errorType=type(error).__name__,code='OIDC_DISCOVERY_UNVERIFIED')
finally:
 report['checkedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();path=ROOT/'.local'/('stack-oidc-discovery-'+str(uuid.uuid4())+'.json');path.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print(json.dumps({'completed':report['completed'],'checks':len(report['checks']),'reportPath':str(path)}))
if not report['completed']:raise SystemExit(1)
