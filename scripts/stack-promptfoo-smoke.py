"""Run the real Promptfoo verifier on the private synthetic worker network."""
import datetime,json,pathlib,subprocess,uuid,traceback
from stack_compose import stack_compose
root=pathlib.Path(__file__).resolve().parent.parent
name='agenttrust-stack-promptfoo-proof-'+str(uuid.uuid4());created=False
report={'completed':False,'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'rawSecretsPrinted':False,'deploymentAuthority':False}
def run(args,**kwargs):return subprocess.run(args,cwd=root,capture_output=True,text=True,check=True,**kwargs)
try:
 worker=json.loads(run(['docker','inspect','agenttrust-stack-ai-worker-1']).stdout)[0];assert worker['Config']['Labels']['com.docker.compose.project']=='agenttrust' and worker['Config']['Labels']['com.docker.compose.service']=='stack-ai-worker'
 image=json.loads(run(['docker','image','inspect','agenttrust-promptfoo:local']).stdout)[0]
 command=stack_compose(root)+['-f','compose.stack.evaluation.yaml','run','--name',name,'-T','--no-deps','stack-promptfoo'];created=True;result=subprocess.run(command,cwd=root,capture_output=True,text=True,timeout=60)
 state=json.loads(run(['docker','inspect',name]).stdout)[0];assert state['Config']['Labels']['com.docker.compose.project']=='agenttrust' and state['Config']['Labels']['com.docker.compose.service']=='stack-promptfoo';assert state['Image']==image['Id'] and state['State']['ExitCode']==0 and result.returncode==0
 assert state['Config']['User']=='node' and state['HostConfig']['ReadonlyRootfs'] and state['HostConfig']['CapDrop']==['ALL'] and 'no-new-privileges:true' in state['HostConfig']['SecurityOpt']
 networks=list(state['NetworkSettings']['Networks']);assert len(networks)==1;network=json.loads(run(['docker','network','inspect',networks[0]]).stdout)[0];assert network['Internal'] and network['Labels']['com.docker.compose.project']=='agenttrust'
 values=[json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')];assert len(values)==1;value=values[0];assert value=={'completed':True,'engine':'promptfoo','version':'0.124.1','provider':'python-fastapi','cases':4,'assertions':8,'synthetic':True,'externalProviderCalled':False,'deploymentAuthority':False,'rawSecretsPrinted':False}
 report.update(value);report['runtimeImageId']=image['Id'];report['nonrootReadOnlyInternalNetworkVerified']=True
except Exception as error:report['errorType']=type(error).__name__;report['failureLocations']=[{'file':pathlib.Path(t.filename).name,'line':t.lineno} for t in traceback.extract_tb(error.__traceback__)]
finally:
 cleaned=True
 if created:
  try:
   state=json.loads(run(['docker','inspect',name]).stdout)[0];assert state['Config']['Labels']['com.docker.compose.project']=='agenttrust' and state['Config']['Labels']['com.docker.compose.service']=='stack-promptfoo';run(['docker','rm','-f',name])
  except Exception:cleaned=False
 report['ownVerifierContainerRemoved']=cleaned;report['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();path=root/'.local'/('stack-promptfoo-smoke-'+str(uuid.uuid4())+'.json');path.open('x',encoding='utf-8').write(json.dumps(report,indent=2)+'\n');print(json.dumps({'completed':report['completed'],'ownVerifierContainerRemoved':cleaned,'reportPath':str(path),'rawSecretsPrinted':False}))
if not report['completed'] or not report['ownVerifierContainerRemoved']:raise SystemExit(1)
