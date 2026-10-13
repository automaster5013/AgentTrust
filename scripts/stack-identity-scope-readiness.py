"""Read-only scope claim and attribute-editing checks against local Keycloak."""
import copy,datetime,json,pathlib,uuid
from stack_identity_scope_contract import verify
from stack_identity_admin import IdentityAdmin
ROOT=pathlib.Path(__file__).resolve().parent.parent
report={'completed':False,'identityConfigurationModified':False,'rawTokensPrinted':False,'clientSecretPrinted':False,'productionIdentityChecked':False,'checks':[]}
try:
 with IdentityAdmin(ROOT) as admin:
  clients=admin.request('/clients?clientId=agenttrust-console');assert len(clients)==1
  profile=admin.request('/users/profile');verify(clients[0],profile)
  report['checks'].append('actual local scope mappers, multivalued roles and administrator-only UUID attributes verified')
  for name in ['claim-collision','duplicate-mapper','missing-mapper','missing-id-token-claim','foreign-claim','single-role','foreign-role-mapper','unmanaged-attributes','user-editable-scope','missing-uuid-validation']:
   client=copy.deepcopy(clients[0]);bad_profile=copy.deepcopy(profile)
   organization=next(row for row in client['protocolMappers'] if row['name']=='agenttrust_organization');role=next(row for row in client['protocolMappers'] if row['name']=='agenttrust_roles');attribute=next(row for row in bad_profile['attributes'] if row['name']=='agenttrust_organization')
   if name=='claim-collision':
    collision=copy.deepcopy(organization);collision['name']='different-mapper';client['protocolMappers'].append(collision)
   elif name=='duplicate-mapper':client['protocolMappers'].append(copy.deepcopy(organization))
   elif name=='missing-mapper':client['protocolMappers'].remove(organization)
   elif name=='missing-id-token-claim':organization['config']['id.token.claim']='false'
   elif name=='foreign-claim':organization['config']['claim.name']='other_organization'
   elif name=='single-role':role['config']['multivalued']='false'
   elif name=='foreign-role-mapper':role['protocolMapper']='oidc-hardcoded-claim-mapper'
   elif name=='unmanaged-attributes':bad_profile['unmanagedAttributePolicy']='ENABLED'
   elif name=='user-editable-scope':attribute['permissions']['edit']=['admin','user']
   else:attribute['validations'].pop('pattern')
   try:verify(client,bad_profile)
   except ValueError:report['checks'].append(name+'-refused')
   else:raise RuntimeError('Unsafe scope contract accepted')
 report.update(completed=True,actualLocalIdentityInspected=True,administratorSessionClosed=True)
except Exception as error:report.update(errorType=type(error).__name__,code='IDENTITY_SCOPE_READINESS_UNVERIFIED')
finally:
 report['checkedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();path=ROOT/'.local'/('stack-identity-scope-readiness-'+str(uuid.uuid4())+'.json');path.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print(json.dumps({'completed':report['completed'],'checks':len(report['checks']),'reportPath':str(path)}))
if not report['completed']:raise SystemExit(1)
