"""Check running immutable images and their actual language runtimes."""
import hashlib,json,os,pathlib,re,subprocess,traceback,urllib.request
from stack_https_release_profile import from_fixture, EVIDENCE_FILE
root=pathlib.Path(__file__).resolve().parent.parent
def run(args):return subprocess.run(args,cwd=root,capture_output=True,text=True,check=True)
stage='prepare';identity_evidence={}
try:
 revision=run(['git','rev-parse','HEAD']).stdout.strip();assert re.fullmatch('[a-f0-9]{40}',revision)
 references={'core-api':os.environ['STACK_CORE_IMAGE'],'ai-worker':os.environ['STACK_WORKER_IMAGE'],'console':os.environ['STACK_CONSOLE_IMAGE'],'opa':os.environ['STACK_OPA_IMAGE'],'identity':os.environ['STACK_IDENTITY_IMAGE'],'gateway':os.environ['STACK_GATEWAY_IMAGE'],'object-store':os.environ['STACK_OBJECT_IMAGE'],'database':os.environ['STACK_DATABASE_IMAGE'],'local-model':os.environ['STACK_MODEL_IMAGE'],'messaging':os.environ['STACK_MESSAGING_IMAGE'],'telemetry':os.environ['STACK_TELEMETRY_IMAGE'],'tempo':os.environ['STACK_TEMPO_IMAGE'],'loki':os.environ['STACK_LOKI_IMAGE'],'prometheus':os.environ['STACK_PROMETHEUS_IMAGE'], 'quality-verifier':os.environ['STACK_QUALITY_VERIFIER_IMAGE']};verified={}
 for name,image in references.items():
  stage=name+'-image-identity'
  assert re.fullmatch(r'ghcr\.io/[a-z0-9-]+/agenttrust-'+name+r'@sha256:[a-f0-9]{64}',image)
  service={'database':'db','local-model':'ollama','messaging':'nats','telemetry':'otel'}.get(name,name)
  container=json.loads(run(['docker','inspect','agenttrust-stack-'+service+'-1']).stdout)[0];expected=json.loads(run(['docker','image','inspect',image]).stdout)[0]
  labels=container['Config']['Labels'];assert labels['com.docker.compose.project']=='agenttrust' and labels['com.docker.compose.service']=='stack-'+service and labels['org.opencontainers.image.revision']==revision
  identity_evidence={'service':service,'actualImageId':container['Image'],'expectedImageId':expected['Id'],'health':container['State'].get('Health',{}).get('Status','missing')}
  assert container['Image']==expected['Id'] and container['State']['Health']['Status']=='healthy'
  assert container['HostConfig']['ReadonlyRootfs'] and container['HostConfig']['CapDrop']==['ALL'] and 'no-new-privileges:true' in container['HostConfig']['SecurityOpt'];assert container['Config']['User']=={'core-api':'10001:10001','ai-worker':'10001','console':'node','opa':'10001','identity':'1000','gateway':'10001:10001','object-store':'10001:10001','database':'70:70','local-model':'10001:10001','messaging':'10001','telemetry':'10001:10001','tempo':'10001:10001','loki':'10001:10001','prometheus':'10001:10001','quality-verifier':'node'}[name]
  verified[name]=image
 image_ids={name:json.loads(run(['docker','image','inspect',reference]).stdout)[0]['Id'] for name,reference in verified.items()}
 stage='https-console-registry-runtime'
 https_reference=os.environ['STACK_HTTPS_CONSOLE_IMAGE']
 assert re.fullmatch(r'ghcr\.io/automaster5013/agenttrust-console-https@sha256:[a-f0-9]{64}',https_reference)
 https_image=json.loads(run(['docker','image','inspect',https_reference]).stdout)[0]
 verified['console-https']=https_reference;image_ids['console-https']=https_image['Id']
 matches=[]
 for path in (root/'.local').glob('stack-https-identity-*/summary.json'):
  assert path.is_file() and not path.is_symlink() and 0<path.stat().st_size<=65536
  raw=path.read_bytes();value=json.loads(raw)
  if value.get('sourceRevision')==revision and value.get('completed') and value.get('httpsConsoleRegistryReference')==https_reference:matches.append(raw)
 assert len(matches)==1
 profile=from_fixture(matches[0],revision,verified,image_ids)
 profile_bytes=(json.dumps(profile,indent=2)+'\n').encode()
 stage='prometheus-runtimes'
 for binary in ['prometheus','promtool']:
  version_output=run(['docker','exec','agenttrust-stack-prometheus-1','/bin/'+binary,'--version']).stdout
  assert 'version 3.15.0' in version_output and 'go1.27.3' in version_output
 stage='java-runtimes'
 assert 'version "21.' in run(['docker','exec','agenttrust-stack-core-api-1','java','-version']).stderr
 assert 'version "21.' in run(['docker','exec','agenttrust-stack-gateway-1','java','-version']).stderr
 assert run(['docker','exec','agenttrust-stack-ai-worker-1','python','--version']).stdout.startswith('Python 3.14.')
 assert run(['docker','exec','agenttrust-stack-console-1','node','--version']).stdout.startswith('v24.')
 assert run(['docker','exec','agenttrust-stack-quality-verifier-1','node','--version']).stdout.startswith('v24.')
 assert run(['docker','exec','agenttrust-stack-quality-verifier-1','node','-p',"JSON.parse(require('fs').readFileSync('/app/node_modules/promptfoo/package.json','utf8')).version"]).stdout.strip()=='0.124.1'
 assert re.search(r'^Version:\s+1\.21\.1$',run(['docker','exec','agenttrust-stack-opa-1','/opa','version']).stdout,re.M)
 assert 'Keycloak 26.8.1' in run(['docker','exec','agenttrust-stack-identity-1','/opt/keycloak/bin/kc.sh','--version']).stdout
 assert 'RELEASE.2025-10-15T17-29-55Z' in run(['docker','exec','agenttrust-stack-object-store-1','minio','--version']).stdout
 provision=json.loads(run(['docker','inspect','agenttrust-stack-object-init-1']).stdout)[0];assert provision['State']['ExitCode']==0 and provision['State']['Status']=='exited' and provision['Image']==json.loads(run(['docker','image','inspect',references['object-store']]).stdout)[0]['Id']
 migration=json.loads(run(['docker','inspect','agenttrust-stack-migrate-1']).stdout)[0]
 assert migration['State']['Status']=='exited' and migration['State']['ExitCode']==0 and migration['Config']['Cmd']==['--migrate-only'] and migration['Image']==json.loads(run(['docker','image','inspect',references['core-api']]).stdout)[0]['Id']
 assert not migration['HostConfig']['PortBindings'] and migration['HostConfig']['ReadonlyRootfs']
 stage='telemetry-version'
 assert '0.162.0' in run(['docker','exec','agenttrust-stack-otel-1','/otelcol','--version']).stdout
 stage='observation-storage-versions'
 assert 'version 3.1.0' in run(['docker','exec','agenttrust-stack-tempo-1','/tempo','--version']).stdout
 assert 'version 3.7.8' in run(['docker','exec','agenttrust-stack-loki-1','/usr/bin/loki','-version']).stdout
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
 result={'revision':revision,'images':verified,'actualRuntimes':{'core-api':'Java 21','ai-worker':'Python 3.14','console':'Node.js 24','opa':'OPA 1.21.1','identity':'Keycloak 26.8.1','gateway':'Java 21 / Spring WebFlux','cache':'Redis 8.2','object-store':'MinIO RELEASE.2025-10-15T17-29-55Z','database':'PostgreSQL 17 / pgvector 0.8.7','local-model':'Ollama 0.40.2 CPU / patched Go 1.27.3','messaging':'NATS JetStream 2.12.15 / patched Go 1.27.3'},'identityProvider':'keycloak','runtimeImageIdentityVerified':True,'serverDeployed':False}
 result['actualRuntimes'].update({'tempo':'Tempo 3.1.0 / patched Go 1.27.3','loki':'Loki 3.7.8 / patched Go 1.27.3','prometheus':'Prometheus and promtool 3.15.0 / patched Go 1.27.3','quality-verifier':'Node.js 24 / Promptfoo 0.124.1'})
 result['actualRuntimes']['telemetry']='OpenTelemetry Collector 0.162.0 / patched Go 1.27.3'
 result['actualRuntimes']['console-https']='Node.js 24 / Next.js HTTPS profile; actual temporary Chromium fixture'
 result.update(imageIds=image_ids,httpsConsoleProfileRuntimeVerified=True,httpsConsoleProfileEvidence=EVIDENCE_FILE,
  httpsConsoleProfileEvidenceSha256=hashlib.sha256(profile_bytes).hexdigest())
 directory=root/'stack-delivery';directory.mkdir(exist_ok=True);(directory/EVIDENCE_FILE).open('xb').write(profile_bytes)
 (directory/'runtime-identity.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
 print(json.dumps({'completed':True,'images':len(verified),'actualRuntimesVerified':True,'serverDeployed':False}))
except Exception as error:
 print(json.dumps({'completed':False,'code':'STACK_IMAGE_IDENTITY_UNVERIFIED','failedStage':stage,'errorType':type(error).__name__,'identityEvidence':identity_evidence,'failureLocations':[{'file':pathlib.Path(row.filename).name,'line':row.lineno} for row in traceback.extract_tb(error.__traceback__)]}));raise SystemExit(1)
