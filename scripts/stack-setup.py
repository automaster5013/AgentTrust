"""Prepare original-stack synthetic local configuration without changing legacy settings."""
import json,os,pathlib,re,secrets,subprocess,sys,uuid
root=pathlib.Path(__file__).resolve().parent.parent;os.chdir(root);directory=root/'.local'/'stack';directory.mkdir(parents=True,exist_ok=True)
def protect(path):
 if os.name=='nt':
  who=subprocess.check_output(['whoami'],text=True).strip();subprocess.run(['icacls',str(path),'/inheritance:r','/grant:r',who+':F','SYSTEM:F'],check=True,capture_output=True)
 else:path.chmod(0o700 if path.is_dir() else 0o600)
def command(args,**kwargs):
 result=subprocess.run(args,capture_output=True,text=True,**kwargs)
 if result.returncode!=0:raise RuntimeError('Local stack command did not complete')
 return result.stdout
try:
 protect(directory);env=directory/'stack.env';created=False
 if not env.exists():env.open('x',encoding='utf-8').write('STACK_DATABASE_PASSWORD='+secrets.token_hex(24)+'\nSTACK_API_PASSWORD='+secrets.token_hex(24)+'\n');created=True
 values={}
 for line in env.read_text(encoding='utf-8').splitlines():
  name,value=line.split('=',1);assert name in ['STACK_DATABASE_PASSWORD','STACK_API_PASSWORD'] and name not in values and re.fullmatch('[a-f0-9]{48}',value);values[name]=value
 assert set(values)=={'STACK_DATABASE_PASSWORD','STACK_API_PASSWORD'};protect(env)
 credentials=directory/'demo-credentials.json'
 if not credentials.exists():
  orgs=[str(uuid.uuid4()),str(uuid.uuid4())];projects=[str(uuid.uuid4()),str(uuid.uuid4())];rows=[{'username':name,'password':secrets.token_hex(24),'role':role,'organizationId':orgs[index],'projectId':projects[index],'actorId':str(uuid.uuid4())} for name,role,index in [('demo-admin','admin',0),('demo-editor','editor',0),('demo-viewer','viewer',0),('other-admin','admin',1)]];credentials.open('x',encoding='utf-8').write(json.dumps(rows,indent=2)+'\n')
 rows=json.loads(credentials.read_text(encoding='utf-8'));assert len(rows)==4 and {r['username'] for r in rows}=={'demo-admin','demo-editor','demo-viewer','other-admin'}
 for row in rows:
  assert re.fullmatch('[a-f0-9]{48}',row['password']) and row['role'] in ['admin','editor','viewer']
  for field in ['organizationId','projectId','actorId']:uuid.UUID(row[field])
 protect(credentials)
 # Compose file secrets are bind mounts. A private parent protects host access,
 # while read-only secret files must be readable by the non-root containers.
 if os.name!='nt':credentials.chmod(0o444)
 token=directory/'worker-token'
 if not token.exists():token.open('x',encoding='utf-8').write(secrets.token_hex(32))
 assert re.fullmatch('[a-f0-9]{64}',token.read_text(encoding='utf-8'));protect(token)
 if os.name!='nt':token.chmod(0o444)
 nats_token=directory/'nats-token'
 if not nats_token.exists():nats_token.open('x',encoding='utf-8').write(secrets.token_hex(32))
 nats_value=nats_token.read_text(encoding='utf-8');assert re.fullmatch('[a-f0-9]{64}',nats_value);protect(nats_token)
 nats_config=directory/'nats.conf'
 configuration='port: 4222\nhttp: 8222\nmax_payload: 4096\nauthorization { token: "'+nats_value+'" }\njetstream { store_dir: "/tmp/jetstream", max_memory_store: 16MB, max_file_store: 32MB }\n'
 if not nats_config.exists():nats_config.open('x',encoding='utf-8').write(configuration)
 assert nats_config.read_text(encoding='utf-8')==configuration;protect(nats_config)
 if os.name!='nt':nats_token.chmod(0o444);nats_config.chmod(0o444)
 opa_token=directory/'opa-token'
 if not opa_token.exists():opa_token.open('x',encoding='utf-8').write(secrets.token_hex(32))
 opa_value=opa_token.read_text(encoding='utf-8');assert re.fullmatch('[a-f0-9]{64}',opa_value);protect(opa_token)
 opa_auth=directory/'opa-auth.json';auth={'stack_auth':{'token':opa_value}}
 if not opa_auth.exists():opa_auth.open('x',encoding='utf-8').write(json.dumps(auth)+'\n')
 assert json.loads(opa_auth.read_text(encoding='utf-8'))==auth;protect(opa_auth)
 if os.name!='nt':opa_token.chmod(0o444);opa_auth.chmod(0o444)
 compose=['docker','compose','--env-file',str(env),'-f','compose.stack.yaml']
 database_image=os.environ.get('STACK_DATABASE_IMAGE')
 if database_image:
  assert re.fullmatch(r'ghcr\.io/[a-z0-9-]+/agenttrust-database@sha256:[a-f0-9]{64}',database_image);compose+=['-f','compose.stack.database-image.yaml']
 command(compose+['up','-d','--no-build' if database_image else '--build','--wait','stack-db'])
 state=json.loads(command(['docker','inspect','agenttrust-stack-db-1']))[0];assert state['Config']['Labels']['com.docker.compose.project']=='agenttrust' and state['Config']['Labels']['com.docker.compose.service']=='stack-db'
 sql="SELECT 1 FROM pg_roles WHERE rolname='agenttrust_stack_api';"
 exists=command(['docker','exec','-i','agenttrust-stack-db-1','psql','-U','agenttrust_stack','-d','agenttrust_stack','-At','-v','ON_ERROR_STOP=1'],input=sql).strip()
 if not exists:
  command(['docker','exec','-i','agenttrust-stack-db-1','psql','-U','agenttrust_stack','-d','agenttrust_stack','-v','ON_ERROR_STOP=1'],input="CREATE ROLE agenttrust_stack_api LOGIN PASSWORD '"+values['STACK_API_PASSWORD']+"'; GRANT CONNECT ON DATABASE agenttrust_stack TO agenttrust_stack_api;")
 assert command(['docker','exec','-i','agenttrust-stack-db-1','psql','-U','agenttrust_stack','-d','agenttrust_stack','-At','-v','ON_ERROR_STOP=1'],input="SELECT rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole FROM pg_roles WHERE rolname='agenttrust_stack_api';").strip()=='f'
 print(json.dumps({'prepared':True,'configurationCreated':created,'syntheticIdentities':4,'separateDatabase':'agenttrust_stack','restrictedApiRoleVerified':True,'legacyConfigurationChanged':False,'rawSecretsPrinted':False}))
except Exception:
 print(json.dumps({'prepared':False,'code':'STACK_SETUP_UNVERIFIED','legacyConfigurationChanged':False,'rawSecretsPrinted':False}));sys.exit(1)
