"""Protect organization attributes and configure signed back-channel logout."""
import json,pathlib,urllib.error
from stack_identity_admin import IdentityAdmin
root=pathlib.Path(__file__).resolve().parent.parent;stage='admin-auth'
try:
 with IdentityAdmin(root) as admin:
  stage='profile-update';profile=admin.request('/users/profile');profile['unmanagedAttributePolicy']=None
  for name in ['agenttrust_organization','agenttrust_project']:
   definition={'name':name,'displayName':name,'permissions':{'view':['admin','user'],'edit':['admin']},'validations':{'pattern':{'pattern':'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'}}}
   profile['attributes']=[a for a in profile['attributes'] if a['name']!=name]+[definition]
  admin.request('/users/profile','PUT',profile);verified=admin.request('/users/profile');assert verified.get('unmanagedAttributePolicy') is None
  for name in ['agenttrust_organization','agenttrust_project']:assert next(a for a in verified['attributes'] if a['name']==name)['permissions']['edit']==['admin']
  stage='client-update';clients=admin.request('/clients?clientId=agenttrust-console');assert len(clients)==1;client=clients[0];assert not client['directAccessGrantsEnabled'] and not client['publicClient'];client['attributes']['backchannel.logout.url']='http://stack-core-api:8080/logout/connect/back-channel/keycloak';client['attributes']['backchannel.logout.session.required']='true';admin.request('/clients/'+client['id'],'PUT',client)
  verified=admin.request('/clients/'+client['id']);assert verified['attributes']['backchannel.logout.url']==client['attributes']['backchannel.logout.url']
 print(json.dumps({'completed':True,'realm':'agenttrust','scopeAttributesAdminOnly':True,'unmanagedUserAttributesDisabled':True,'signedBackChannelLogoutConfigured':True,'administratorSessionClosed':True,'rawTokensPrinted':False}))
except Exception as error:
 print(json.dumps({'completed':False,'code':'IDENTITY_PROFILE_UNVERIFIED','httpStatus':error.code if isinstance(error,urllib.error.HTTPError) else None,'stage':stage,'errorType':type(error).__name__}));raise SystemExit(1)
