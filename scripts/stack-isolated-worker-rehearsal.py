"""Bounded stateless worker candidate/baseline/candidate rehearsal; no operational mutations."""
import argparse,hashlib,importlib.util,json,pathlib,subprocess,sys,uuid
from stack_image_identity import cached_identity as cached_image_identity
ROOT=pathlib.Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('evidence',ROOT/'scripts/stack-local-cd-evidence.py');e=importlib.util.module_from_spec(spec);spec.loader.exec_module(e)
PROBE=r'''
import asyncio,json,os,pathlib,secrets,uuid
os.environ['STACK_WORKER_TOKEN_FILE']='/tmp/fixture-worker-token'
token=secrets.token_hex(32);pathlib.Path('/tmp/fixture-worker-token').write_text(token)
import httpx
from app import app
async def main():
 async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://fixture') as client:
  scope={k:str(uuid.uuid4()) for k in ['runId','organizationId','projectId']}
  assert (await client.post('/evaluate',json={**scope,'scenario':'pass'})).status_code==401
  results={}
  for scenario,decision in [('pass','pass'),('block','block'),('missing_evidence','inconclusive'),('error','inconclusive')]:
   response=await client.post('/evaluate',json={**scope,'scenario':scenario},headers={'X-AgentTrust-Worker-Token':token})
   assert response.status_code==200;body=response.json();assert body['result']['decision']==decision
   assert body['organizationId']==scope['organizationId'] and body['result']['executionEngine']=='python-synthetic'
   results[scenario]=decision
  assert (await client.post('/evaluate',json={**scope,'scenario':'pass','providerUrl':'https://outside.invalid'},headers={'X-AgentTrust-Worker-Token':token})).status_code==422
  print(json.dumps({'completed':True,'decisions':results,'unauthenticatedBlocked':True,'callerSelectedProviderUrlRefused':True,'externalNetworkUsed':False}))
asyncio.run(main())
'''


def command(args,timeout=90):
 result=subprocess.run(args,cwd=ROOT,capture_output=True,text=True,encoding="utf-8",errors="replace",timeout=timeout)
 e.require(result.returncode==0);return result.stdout


def cached_identity(image,reference,expected_config):
 e.require(e.re.fullmatch('docker.io/automaster5013/agenttrust-ai-worker@sha256:[a-f0-9]{64}',reference))
 return cached_image_identity(image,reference,expected_config)


def fixture_command(image,identifier):
 e.require(e.re.fullmatch('docker.io/automaster5013/agenttrust-ai-worker@sha256:[a-f0-9]{64}',image) or e.re.fullmatch('sha256:[a-f0-9]{64}',image))
 e.require(str(uuid.UUID(identifier))==identifier)
 return ['docker','run','--rm','--name','agenttrust-cd-worker-fixture-'+identifier,'--label','agenttrust.fixture='+identifier,
         '--network','none','--log-driver','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true',
         '--user','10001:10001','--memory','256m','--cpus','1','--pids-limit','64','--tmpfs','/tmp:size=8m,mode=1777',
         '-e','OTEL_SDK_DISABLED=true','-e','PYTHONDONTWRITEBYTECODE=1','--entrypoint','python',image,'-c',PROBE]


def main():
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--config',type=pathlib.Path,required=True);parser.add_argument('--expected-config-sha256',required=True)
 parser.add_argument('--output',type=pathlib.Path,required=True);parser.add_argument('--execute',action='store_true')
 args=parser.parse_args();report={'completed':False,'operationalServicesChanged':False,'fullStackRecoveryVerified':False,'actualDeploymentPerformed':False}
 try:
  e.require(pathlib.Path.cwd().resolve()==ROOT)
  output=args.output.resolve();e.require(output.is_relative_to((ROOT/'.local').resolve()) and not output.exists())
  config=e.delivery.json_bytes(e.anchored_file(args.config,args.expected_config_sha256))
  ids=e.planner.running_ids();inventory=e.planner.summarize(json.loads(e.planner.docker(['inspect',*ids])))
  hashes=e.planner.compose_hashes(inventory,ROOT)
  report['stage']='verify-published-release'
  release=e.verify_candidate_release(config,config['revision'],inventory,{})
  candidate=next(row['candidate'] for row in release['plan'] if row['service']=='stack-ai-worker')
  baseline=inventory['stack-ai-worker']['rollbackImageId'];outcomes=[]
  if args.execute:
   report['stage']='pull-candidate'
   command(['docker','pull',candidate],300)
   report['stage']='candidate-image-id'
   identity=json.loads((release['directory']/'runtime-identity.json').read_bytes())['imageIds']['ai-worker']
   local=json.loads(command(['docker','image','inspect',candidate]))[0]
   report['imageIdentityMode']=cached_identity(local,candidate,identity)
   report['stage']='stateless-candidate-baseline-candidate'
   for reference in (candidate,baseline,candidate):
    result=json.loads(command(fixture_command(reference,str(uuid.uuid4()))))
    e.require(result['completed'] is True);outcomes.append(result)
   e.require(outcomes[0]==outcomes[1]==outcomes[2])
  e.anchored_file(args.config,args.expected_config_sha256)
  e.require(e.delivery.validate(release['directory'],config['revision'],config['checksumsSha256'],config['repository']) == (release['directory'],release['identity'],release['records']))
  e.anchored_file(config['receipt'],config['receiptSha256'],65536)
  e.planner.recheck(ids,inventory,ROOT,hashes)
  report.update(completed=True,executed=args.execute,fixtureRuns=len(outcomes),candidateBaselineCandidateResultsEqual=args.execute,
                scope='stateless-worker-ASGI-evaluation-only',hostPortsPublished=False,operationalVolumesMounted=False,
                operationalCredentialsUsed=False,workerQueueOrDatabaseRecoveryVerified=False)
  output.parent.mkdir(parents=True,exist_ok=True)
  with output.open('x',encoding='utf-8') as handle:handle.write(json.dumps(report,indent=2)+'\n')
 except Exception as error:
  report.update(completed=False,code='ISOLATED_WORKER_REHEARSAL_UNVERIFIED',errorType=type(error).__name__)
 print(json.dumps(report));return 0 if report['completed'] else 1


if __name__=='__main__':sys.exit(main())
