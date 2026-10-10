"""Prepare an isolated Keycloak database and four synthetic OIDC identities."""
import json,os,pathlib,re,secrets,subprocess,uuid
root=pathlib.Path(__file__).resolve().parent.parent;directory=root/'.local/stack'
def command(args,**kwargs):return subprocess.run(args,cwd=root,capture_output=True,text=True,check=True,**kwargs).stdout
def protect(path):
 if os.name=='nt':
  who=command(['whoami']).strip();command(['icacls',str(path),'/inheritance:r','/grant:r',who+':F','SYSTEM:F'])
 else:path.chmod(0o444)
try:
 values={line.split('=',1)[0]:line.split('=',1)[1] for line in (directory/'stack.env').read_text(encoding='utf-8').splitlines()};assert re.fullmatch('[a-f0-9]{48}',values['STACK_DATABASE_PASSWORD'])
 private=directory/'identity.env'
 if not private.exists():private.open('x',encoding='utf-8').write('\n'.join(name+'='+secrets.token_hex(24) for name in ['STACK_IDENTITY_DATABASE_PASSWORD','STACK_IDENTITY_ADMIN_PASSWORD'])+'\n')
 env={}
 for line in private.read_text(encoding='utf-8').splitlines():
  name,value=line.split('=',1);assert name in ['STACK_IDENTITY_DATABASE_PASSWORD','STACK_IDENTITY_ADMIN_PASSWORD'] and name not in env and re.fullmatch('[a-f0-9]{48}',value);env[name]=value
 assert set(env)=={'STACK_IDENTITY_DATABASE_PASSWORD','STACK_IDENTITY_ADMIN_PASSWORD'};protect(private)
 if os.name!='nt':private.chmod(0o600)
 secret=directory/'oidc-client-secret'
 if not secret.exists():secret.open('x',encoding='utf-8').write(secrets.token_hex(32))
 client_secret=secret.read_text(encoding='utf-8');assert re.fullmatch('[a-f0-9]{64}',client_secret);protect(secret)
 credentials=json.loads((directory/'demo-credentials.json').read_text(encoding='utf-8'));assert len(credentials)==4
 for row in credentials:
  assert row['username'] in ['demo-admin','demo-editor','demo-viewer','other-admin'] and row['role'] in ['admin','editor','viewer'] and re.fullmatch('[a-f0-9]{48}',row['password'])
  for field in ['organizationId','projectId','actorId']:assert str(uuid.UUID(row[field]))==row[field]
 users=[{'id':row['actorId'],'username':row['username'],'enabled':True,'email':row['username']+'@agenttrust.invalid','emailVerified':True,'firstName':'Synthetic','lastName':'Reviewer','requiredActions':[],'realmRoles':[row['role']],'attributes':{'agenttrust_organization':[row['organizationId']],'agenttrust_project':[row['projectId']]},'credentials':[{'type':'password','value':row['password'],'temporary':False}]} for row in credentials]
 mappers=[{'name':attribute,'protocol':'openid-connect','protocolMapper':'oidc-usermodel-attribute-mapper','consentRequired':False,'config':{'user.attribute':attribute,'claim.name':attribute,'jsonType.label':'String','id.token.claim':'true','access.token.claim':'true','userinfo.token.claim':'true'}} for attribute in ['agenttrust_organization','agenttrust_project']]
 mappers.append({'name':'agenttrust_roles','protocol':'openid-connect','protocolMapper':'oidc-usermodel-realm-role-mapper','consentRequired':False,'config':{'claim.name':'agenttrust_roles','multivalued':'true','jsonType.label':'String','id.token.claim':'true','access.token.claim':'true','userinfo.token.claim':'true'}})
 realm={'realm':'agenttrust','enabled':True,'registrationAllowed':False,'resetPasswordAllowed':False,'rememberMe':False,'loginWithEmailAllowed':False,'duplicateEmailsAllowed':False,'sslRequired':'none','accessTokenLifespan':300,'ssoSessionIdleTimeout':1800,'ssoSessionMaxLifespan':3600,'roles':{'realm':[{'name':role} for role in ['admin','editor','viewer']]},'clients':[{'clientId':'agenttrust-console','name':'AgentTrust Console','enabled':True,'protocol':'openid-connect','publicClient':False,'secret':client_secret,'standardFlowEnabled':True,'directAccessGrantsEnabled':False,'serviceAccountsEnabled':False,'redirectUris':['http://127.0.0.1:4320/backend/login/oauth2/code/keycloak'],'webOrigins':['http://127.0.0.1:4320'],'attributes':{'pkce.code.challenge.method':'S256','post.logout.redirect.uris':'http://127.0.0.1:4320/'},'protocolMappers':mappers}],'users':users}
 path=directory/'agenttrust-realm.json'
 if not path.exists():path.open('x',encoding='utf-8').write(json.dumps(realm,indent=2)+'\n')
 assert json.loads(path.read_text(encoding='utf-8'))==realm;protect(path)
 state=json.loads(command(['docker','inspect','agenttrust-stack-db-1']))[0];assert state['Config']['Labels']['com.docker.compose.project']=='agenttrust' and state['Config']['Labels']['com.docker.compose.service']=='stack-db'
 db=['docker','exec','-i','agenttrust-stack-db-1','psql','-U','agenttrust_stack','-d','agenttrust_stack','-At','-v','ON_ERROR_STOP=1']
 if command(db,input="SELECT 1 FROM pg_roles WHERE rolname='agenttrust_stack_identity';").strip()!='1':command(db,input="CREATE ROLE agenttrust_stack_identity LOGIN PASSWORD '"+env['STACK_IDENTITY_DATABASE_PASSWORD']+"';")
 assert command(db,input="SELECT rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole FROM pg_roles WHERE rolname='agenttrust_stack_identity';").strip()=='f'
 if command(db,input="SELECT 1 FROM pg_database WHERE datname='agenttrust_stack_identity';").strip()!='1':command(db,input='CREATE DATABASE agenttrust_stack_identity OWNER agenttrust_stack_identity;')
 assert command(db,input="SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname='agenttrust_stack_identity';").strip()=='agenttrust_stack_identity'
 print(json.dumps({'prepared':True,'realm':'agenttrust','syntheticIdentities':4,'separateIdentityDatabase':True,'directPasswordGrantEnabled':False,'rawSecretsPrinted':False}))
except Exception:
 print(json.dumps({'prepared':False,'code':'STACK_IDENTITY_SETUP_UNVERIFIED'}));raise SystemExit(1)
