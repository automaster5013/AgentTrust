"""Reject ambiguous or user-editable workspace claims without echoing configuration."""
PATTERN='^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
def require(condition):
 if not condition:raise ValueError('IDENTITY_SCOPE_CONTRACT_UNVERIFIED')
def verify(client,profile):
 mappers=client.get('protocolMappers',[])
 for name in ['agenttrust_organization','agenttrust_project','agenttrust_roles']:
  selected=[row for row in mappers if row.get('name')==name];require(len(selected)==1);mapper=selected[0];config=mapper.get('config',{})
  require(len([row for row in mappers if row.get('config',{}).get('claim.name')==name])==1)
  require(mapper.get('protocol')=='openid-connect' and config.get('claim.name')==name and config.get('jsonType.label')=='String' and all(config.get(key)=='true' for key in ['id.token.claim','access.token.claim','userinfo.token.claim']))
  if name=='agenttrust_roles':require(mapper.get('protocolMapper')=='oidc-usermodel-realm-role-mapper' and config.get('multivalued')=='true')
  else:require(mapper.get('protocolMapper')=='oidc-usermodel-attribute-mapper' and config.get('user.attribute')==name)
 require(profile.get('unmanagedAttributePolicy') is None)
 for name in ['agenttrust_organization','agenttrust_project']:
  selected=[row for row in profile.get('attributes',[]) if row.get('name')==name];require(len(selected)==1);attribute=selected[0]
  require(attribute.get('permissions',{}).get('edit')==['admin'] and attribute.get('validations',{}).get('pattern',{}).get('pattern')==PATTERN)
 return True
