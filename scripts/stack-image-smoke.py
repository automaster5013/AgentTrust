"""Check running immutable images and their actual language runtimes."""
import json,os,pathlib,re,subprocess
root=pathlib.Path(__file__).resolve().parent.parent
def run(args):return subprocess.run(args,cwd=root,capture_output=True,text=True,check=True)
try:
 revision=run(['git','rev-parse','HEAD']).stdout.strip();assert re.fullmatch('[a-f0-9]{40}',revision)
 references={'core-api':os.environ['STACK_CORE_IMAGE'],'ai-worker':os.environ['STACK_WORKER_IMAGE'],'console':os.environ['STACK_CONSOLE_IMAGE'],'opa':os.environ['STACK_OPA_IMAGE']};verified={}
 for name,image in references.items():
  assert re.fullmatch(r'ghcr\.io/[a-z0-9-]+/agenttrust-'+name+r'@sha256:[a-f0-9]{64}',image)
  container=json.loads(run(['docker','inspect','agenttrust-stack-'+name+'-1']).stdout)[0];expected=json.loads(run(['docker','image','inspect',image]).stdout)[0]
  labels=container['Config']['Labels'];assert labels['com.docker.compose.project']=='agenttrust' and labels['com.docker.compose.service']=='stack-'+name and labels['org.opencontainers.image.revision']==revision
  assert container['Image']==expected['Id'] and container['State']['Health']['Status']=='healthy'
  assert container['HostConfig']['ReadonlyRootfs'] and container['HostConfig']['CapDrop']==['ALL'] and 'no-new-privileges:true' in container['HostConfig']['SecurityOpt'];assert container['Config']['User']=={'core-api':'10001:10001','ai-worker':'10001','console':'node','opa':'10001'}[name]
  verified[name]=image
 assert 'version "21.' in run(['docker','exec','agenttrust-stack-core-api-1','java','-version']).stderr
 assert run(['docker','exec','agenttrust-stack-ai-worker-1','python','--version']).stdout.startswith('Python 3.14.')
 assert run(['docker','exec','agenttrust-stack-console-1','node','--version']).stdout.startswith('v24.')
 assert re.search(r'^Version:\s+1\.21\.1$',run(['docker','exec','agenttrust-stack-opa-1','/opa','version']).stdout,re.M)
 result={'revision':revision,'images':verified,'actualRuntimes':{'core-api':'Java 21','ai-worker':'Python 3.14','console':'Node.js 24','opa':'OPA 1.21.1'},'runtimeImageIdentityVerified':True,'serverDeployed':False}
 directory=root/'stack-delivery';directory.mkdir(exist_ok=True);(directory/'runtime-identity.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
 print(json.dumps({'completed':True,'images':len(verified),'actualRuntimesVerified':True,'serverDeployed':False}))
except Exception:
 print(json.dumps({'completed':False,'code':'STACK_IMAGE_IDENTITY_UNVERIFIED'}));raise SystemExit(1)
