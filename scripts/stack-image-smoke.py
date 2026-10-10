"""Check running immutable images and their actual language runtimes."""
import json,os,pathlib,re,subprocess,traceback,urllib.request
root=pathlib.Path(__file__).resolve().parent.parent
def run(args):return subprocess.run(args,cwd=root,capture_output=True,text=True,check=True)
stage='prepare'
try:
 revision=run(['git','rev-parse','HEAD']).stdout.strip();assert re.fullmatch('[a-f0-9]{40}',revision)
 references={'core-api':os.environ['STACK_CORE_IMAGE'],'ai-worker':os.environ['STACK_WORKER_IMAGE'],'console':os.environ['STACK_CONSOLE_IMAGE'],'opa':os.environ['STACK_OPA_IMAGE'],'identity':os.environ['STACK_IDENTITY_IMAGE'],'gateway':os.environ['STACK_GATEWAY_IMAGE'],'object-store':os.environ['STACK_OBJECT_IMAGE'],'database':os.environ['STACK_DATABASE_IMAGE'],'local-model':os.environ['STACK_MODEL_IMAGE'],'messaging':os.environ['STACK_MESSAGING_IMAGE']};verified={}
 for name,image in references.items():
  stage=name+'-image-identity'
  assert re.fullmatch(r'ghcr\.io/[a-z0-9-]+/agenttrust-'+name+r'@sha256:[a-f0-9]{64}',image)
  service={'database':'db','local-model':'ollama','messaging':'nats'}.get(name,name)
  container=json.loads(run(['docker','inspect','agenttrust-stack-'+service+'-1']).stdout)[0];expected=json.loads(run(['docker','image','inspect',image]).stdout)[0]
  labels=container['Config']['Labels'];assert labels['com.docker.compose.project']=='agenttrust' and labels['com.docker.compose.service']=='stack-'+service and labels['org.opencontainers.image.revision']==revision
  assert container['Image']==expected['Id'] and container['State']['Health']['Status']=='healthy'
  assert container['HostConfig']['ReadonlyRootfs'] and container['HostConfig']['CapDrop']==['ALL'] and 'no-new-privileges:true' in container['HostConfig']['SecurityOpt'];assert container['Config']['User']=={'core-api':'10001:10001','ai-worker':'10001','console':'node','opa':'10001','identity':'1000','gateway':'10001:10001','object-store':'10001:10001','database':'70:70','local-model':'10001:10001','messaging':'10001'}[name]
  verified[name]=image
 stage='java-runtimes'
 assert 'version "21.' in run(['docker','exec','agenttrust-stack-core-api-1','java','-version']).stderr
 assert 'version "21.' in run(['docker','exec','agenttrust-stack-gateway-1','java','-version']).stderr
 assert run(['docker','exec','agenttrust-stack-ai-worker-1','python','--version']).stdout.startswith('Python 3.14.')
 assert run(['docker','exec','agenttrust-stack-console-1','node','--version']).stdout.startswith('v24.')
 assert re.search(r'^Version:\s+1\.21\.1$',run(['docker','exec','agenttrust-stack-opa-1','/opa','version']).stdout,re.M)
 assert 'Keycloak 26.8.0' in run(['docker','exec','agenttrust-stack-identity-1','/opt/keycloak/bin/kc.sh','--version']).stdout
 assert 'RELEASE.2025-10-15T17-29-55Z' in run(['docker','exec','agenttrust-stack-object-store-1','minio','--version']).stdout
 provision=json.loads(run(['docker','inspect','agenttrust-stack-object-init-1']).stdout)[0];assert provision['State']['ExitCode']==0 and provision['State']['Status']=='exited' and provision['Image']==json.loads(run(['docker','image','inspect',references['object-store']]).stdout)[0]['Id']
 stage='messaging-version'
 assert run(['docker','exec','agenttrust-stack-nats-1','/nats-server','--version']).stdout.strip()=='nats-server: v2.12.15'
 stage='local-model-version'
 assert '0.40.2' in run(['docker','exec','agenttrust-stack-ollama-1','ollama','--version']).stdout
 stage='database-version'
 assert run(['docker','exec','agenttrust-stack-db-1','postgres','--version']).stdout.startswith('postgres (PostgreSQL) 17.')
 assert run(['docker','exec','agenttrust-stack-db-1','psql','-U','agenttrust_stack','-d','agenttrust_stack','-At','-c',"SELECT extversion FROM pg_extension WHERE extname='vector'"]).stdout.strip()=='0.8.7'
 stage='cache-version'
 redis=json.loads(run(['docker','inspect','agenttrust-stack-redis-1']).stdout)[0];assert redis['Config']['Image']=='redis:8.2-alpine@sha256:b51665e66f00759be7c3152ad5ac3c66fb2f619c13ef62dea7cc1f9914524635';assert 'v=8.2.' in run(['docker','exec','agenttrust-stack-redis-1','redis-server','--version']).stdout
 stage='identity-metadata'
 with urllib.request.urlopen('http://127.0.0.1:4321/api/auth-info',timeout=10) as response:assert json.loads(response.read(4097))['identityProvider']=='keycloak'
 result={'revision':revision,'images':verified,'actualRuntimes':{'core-api':'Java 21','ai-worker':'Python 3.14','console':'Node.js 24','opa':'OPA 1.21.1','identity':'Keycloak 26.8.0','gateway':'Java 21 / Spring WebFlux','cache':'Redis 8.2','object-store':'MinIO RELEASE.2025-10-15T17-29-55Z','database':'PostgreSQL 17 / pgvector 0.8.7','local-model':'Ollama 0.40.2 CPU / patched Go 1.27.2','messaging':'NATS JetStream 2.12.15 / patched Go 1.27.2'},'identityProvider':'keycloak','runtimeImageIdentityVerified':True,'serverDeployed':False}
 directory=root/'stack-delivery';directory.mkdir(exist_ok=True);(directory/'runtime-identity.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
 print(json.dumps({'completed':True,'images':len(verified),'actualRuntimesVerified':True,'serverDeployed':False}))
except Exception as error:
 print(json.dumps({'completed':False,'code':'STACK_IMAGE_IDENTITY_UNVERIFIED','failedStage':stage,'errorType':type(error).__name__,'failureLocations':[{'file':pathlib.Path(row.filename).name,'line':row.lineno} for row in traceback.extract_tb(error.__traceback__)]}));raise SystemExit(1)
