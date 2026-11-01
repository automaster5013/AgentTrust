"""Manual hosted Console-only build/scan/sign; no operating PC or business data access."""
import argparse,hashlib,json,os,pathlib,shutil,subprocess,sys,time,uuid
from stack_console_release_contract import context,require,REPOSITORY,REF,WORKFLOW,IDENTITY,FILES,validate
ROOT=pathlib.Path(__file__).resolve().parent.parent
PHASE="admission"
def phase(value):
 global PHASE
 PHASE=value;print(json.dumps({"phase":value,"rawSecretsPrinted":False}),flush=True)

def run(args,timeout=600):
 r=subprocess.run(args,cwd=ROOT,capture_output=True,timeout=timeout)
 require(r.returncode==0);return r.stdout

def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--publish',action='store_true');args=parser.parse_args()
 if not args.publish:print(json.dumps({'planOnly':True,'scope':['stack-console'],'actualDeploymentPerformed':False}));return 0
 # Guard precedes output files, credentials, Docker and registry mutations.
 sha=context(os.environ,ROOT,os.getuid() if os.name!='nt' else 0)
 require(run(['git','rev-parse','HEAD']).decode().strip()==sha)
 require(shutil.disk_usage(ROOT).free>=10*1073741824)
 memory=dict(line.split(':',1) for line in pathlib.Path('/proc/meminfo').read_text().splitlines());require(int(memory['MemAvailable'].strip().split()[0])>=4*1048576)
 directory=ROOT/'.local'/('console-release-'+str(uuid.uuid4()));directory.mkdir()
 bundle=directory/'bundle';bundle.mkdir();cache=directory/'cache';cache.mkdir();inputs=directory/'inputs';inputs.mkdir()
 for p in [bundle,cache,inputs]:p.chmod(0o777)
 tag='ghcr.io/automaster5013/agenttrust-console:'+sha
 fixture=None;archive=inputs/'console.tar'
 def tool(command,network='none',credentials=False,oidc=False):
  c=['docker','run','--rm','--user',str(os.getuid())+':'+str(os.getgid()),'--network',network,'--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--tmpfs','/tmp:size=256m,mode=1777','--memory','2g','--cpus','2','--pids-limit','128','-e','HOME=/tmp','-e','DOCKER_CONFIG=/credentials','--mount','type=bind,source='+str(inputs)+',target=/in,readonly','--mount','type=bind,source='+str(bundle)+',target=/proof','--mount','type=bind,source='+str(cache)+',target=/cache']
  if credentials:c+=['--mount','type=bind,source='+str(ROOT/'.local/stack-signing-credentials')+',target=/credentials,readonly']
  if oidc:
   for key in ['ACTIONS_ID_TOKEN_REQUEST_URL','ACTIONS_ID_TOKEN_REQUEST_TOKEN','GITHUB_ACTIONS']:c+=['-e',key]
  return run(c+['agenttrust-security:local']+command)
 try:
  phase('build-console')
  run(['docker','build','--label','org.opencontainers.image.revision='+sha,'--label','org.opencontainers.image.source=https://github.com/'+REPOSITORY,'-t',tag,'apps/console'],1200)
  image=json.loads(run(['docker','image','inspect',tag]))[0];require(image['Config']['Labels']['org.opencontainers.image.revision']==sha)
  require(all(image['Config']['Labels'].get(key)==value for key,value in {'dev.agenttrust.oidc.profile':'local-review','dev.agenttrust.oidc.application-origin':'http://127.0.0.1:4320','dev.agenttrust.oidc.public-issuer':'http://127.0.0.1:4322/realms/agenttrust'}.items()))
  phase('isolated-http')
  fixture=run(['docker','create','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','384m','--cpus','1','--pids-limit','128','--tmpfs','/tmp:size=32m','-e','HOSTNAME=0.0.0.0','-e','PORT=3000',tag]).decode().strip()
  run(['docker','start',fixture]);ready=False
  for _ in range(30):
   state=json.loads(run(['docker','inspect',fixture]))[0];require(not state['State']['OOMKilled'] and state['State']['Running'])
   if state['State'].get('Health',{}).get('Status')=='healthy':ready=True;break
   time.sleep(2)
  require(ready)
  run(['docker','stop',fixture]);run(['docker','rm',fixture]);fixture=None
  phase('export-console')
  run(['docker','image','save','-o',str(archive),tag]);require(0<archive.stat().st_size<=1073741824);archive.chmod(0o644)
  phase('sbom')
  tool(['syft','docker-archive:/in/console.tar','-o','cyclonedx-json=/proof/console.cdx.json','--quiet'])
  phase('vulnerability-scan')
  tool(['trivy','image','--input','/in/console.tar','--cache-dir','/cache','--scanners','vuln','--severity','HIGH,CRITICAL','--format','json','--output','/proof/console.trivy.json','--exit-code','1','--timeout','8m','--no-progress','--quiet'],'bridge')
  scan=json.loads((bundle/'console.trivy.json').read_bytes());require(scan.get('SchemaVersion')==2 and all(not r.get('Vulnerabilities') for r in scan.get('Results',[])))
  phase('publish-digest')
  run(['docker','push',tag]);published=json.loads(run(['docker','image','inspect',tag]))[0];require(published['Id']==image['Id'])
  refs=[r for r in published.get('RepoDigests',[]) if r.startswith('ghcr.io/automaster5013/agenttrust-console@sha256:')];require(len(refs)==1);reference=refs[0]
  verify=['--certificate-identity',IDENTITY,'--certificate-oidc-issuer','https://token.actions.githubusercontent.com','--certificate-github-workflow-repository',REPOSITORY,'--certificate-github-workflow-ref',REF,'--certificate-github-workflow-sha',sha]
  phase('sign-image')
  tool(['cosign','sign','--yes','--bundle','/proof/console.signature.bundle.json','--annotations','org.opencontainers.image.revision='+sha,reference],'bridge',True,True)
  signatures=json.loads(tool(['cosign','verify',*verify,reference],'bridge',True));require(signatures and any(s['critical']['image']['docker-manifest-digest']==reference.split('@')[1] and s['optional'].get('org.opencontainers.image.revision')==sha for s in signatures))
  phase('attest-sbom')
  tool(['cosign','attest','--yes','--type','cyclonedx','--predicate','/proof/console.cdx.json','--bundle','/proof/console.sbom.bundle.json',reference],'bridge',True,True)
  tool(['cosign','verify-attestation',*verify,'--type','cyclonedx',reference],'bridge',True)
  manifest={'schemaVersion':1,'kind':'single-console-delivery','revision':sha,'repository':REPOSITORY,'ref':REF,'workflow':WORKFLOW,'runId':int(os.environ['GITHUB_RUN_ID']),'runAttempt':int(os.environ['GITHUB_RUN_ATTEMPT']),'image':reference,'imageId':image['Id'],'keylessIdentity':IDENTITY,'oidcIssuer':'https://token.actions.githubusercontent.com','highCriticalFindings':0,'runtimeHttpVerified':True,'sourceIntegrationPassed':True,'oidcProfile':{'profile':'local-review','applicationOrigin':'http://127.0.0.1:4320','publicIssuer':'http://127.0.0.1:4322/realms/agenttrust'},'scope':['stack-console'],'databaseChanged':False,'actualDeploymentPerformed':False}
  (bundle/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
  checks={n:hashlib.sha256((bundle/n).read_bytes()).hexdigest() for n in FILES};raw=(json.dumps(checks,indent=2)+'\n').encode();(bundle/'checksums.json').write_bytes(raw);pin=hashlib.sha256(raw).hexdigest();validate(bundle,sha,pin)
  print(json.dumps({'completed':True,'revision':sha,'image':reference,'checksumsSha256':pin,'scope':['stack-console'],'actualDeploymentPerformed':False}));return 0
 finally:
  if fixture:
   subprocess.run(['docker','stop',fixture],cwd=ROOT,capture_output=True,timeout=30);subprocess.run(['docker','rm',fixture],cwd=ROOT,capture_output=True,timeout=30)
  if archive.exists():archive.unlink()
if __name__=='__main__':
 try:sys.exit(main())
 except Exception as error:print(json.dumps({'completed':False,'code':'CONSOLE_RELEASE_REFUSED','failureType':type(error).__name__,'phase':PHASE,'actualDeploymentPerformed':False}));sys.exit(1)
