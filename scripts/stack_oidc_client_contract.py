"""Public client settings contract; no credentials or identity mutation."""
import importlib.util,pathlib
spec=importlib.util.spec_from_file_location('endpoint_policy',pathlib.Path(__file__).with_name('stack-oidc-image-config.py'));policy=importlib.util.module_from_spec(spec);spec.loader.exec_module(policy)
def expected(profile,origin,issuer):
 policy.validate(profile,origin,issuer)
 return {'clientId':'agenttrust-console','enabled':True,'protocol':'openid-connect','publicClient':False,'standardFlowEnabled':True,'implicitFlowEnabled':False,'directAccessGrantsEnabled':False,'serviceAccountsEnabled':False,'redirectUris':[origin+'/backend/login/oauth2/code/keycloak'],'webOrigins':[origin],'attributes':{'pkce.code.challenge.method':'S256','post.logout.redirect.uris':origin+'/'}}
def verify(client,profile,origin,issuer):
 wanted=expected(profile,origin,issuer)
 for key,value in wanted.items():
  if key=='attributes':
   actual=client.get(key,{})
   if not isinstance(actual,dict) or any(actual.get(k)!=v for k,v in value.items()):raise ValueError('OIDC_CLIENT_CONTRACT_UNVERIFIED')
  elif type(client.get(key)) is not type(value) or client[key]!=value:raise ValueError('OIDC_CLIENT_CONTRACT_UNVERIFIED')
 return True
