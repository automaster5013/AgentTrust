"""Publish an independently pinned successful signed main release, without deploying."""
import argparse,importlib.util,json,os,pathlib,re,sys
from stack_release_online import JOBS,main_run,public_manifests
ROOT=pathlib.Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('publisher',ROOT/'scripts/stack-dockerhub.py')
hub=importlib.util.module_from_spec(spec);spec.loader.exec_module(hub)
REPOSITORY='automaster5013/AgentTrust'
SOURCE='d40cdd063f7f711fdd513d231ec2da2473796619'
SOURCE_RUN=40266953272
CHECKSUM='36205e03707d098850b99d8fe64d20211b6c7eb134e81082fc4e46ecafc13519'
BRANCH='refs/heads/codex/commercial-workspace-ux-20261026'
WORKFLOW='.github/workflows/dockerhub-main-mirror.yml'


def require(value):
 if not value:raise ValueError('Pinned main publication refused')


def context(env):
 require(env.get('GITHUB_ACTIONS')=='true' and env.get('GITHUB_REPOSITORY')==REPOSITORY)
 ref=env.get('GITHUB_REF');require(ref in (BRANCH,'refs/heads/main'))
 require(env.get('GITHUB_WORKFLOW_REF')==REPOSITORY+'/'+WORKFLOW+'@'+ref)
 require(env.get('GITHUB_EVENT_NAME') in ('push','workflow_dispatch'))
 for name in ('GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT'):require(re.fullmatch('[1-9][0-9]{0,19}',env.get(name,'')) is not None)
 return {'repository':REPOSITORY,'workflow':WORKFLOW,'ref':ref,'runId':int(env['GITHUB_RUN_ID']),'runAttempt':int(env['GITHUB_RUN_ATTEMPT'])}


def main():
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--bundle',type=pathlib.Path,required=True)
 parser.add_argument('--output',type=pathlib.Path,required=True)
 parser.add_argument('--publish',action='store_true')
 args=parser.parse_args();stage='context'
 try:
  origin=context(os.environ) if args.publish else None
  require(not args.output.exists())
  stage='successful-main-source'
  # This pinned historical workflow predates Docker Hub delivery; all FOUR source jobs are mandatory.
  source=main_run(SOURCE,SOURCE_RUN,1,expected_jobs=JOBS-{'Publish verified stack to Docker Hub'})
  stage='signed-bundle'
  directory,identity,records=hub.verification.validate(args.bundle,SOURCE,CHECKSUM,REPOSITORY)
  require({row['name'] for row in records}==hub.NAMES)
  hub.verification.Verifier(directory,True,None).verify(records,identity,REPOSITORY,SOURCE)
  require(hub.verification.validate(directory,SOURCE,CHECKSUM,REPOSITORY)==(directory,identity,records))
  rows=hub.plan(records,'automaster5013',SOURCE)
  if args.publish:
   stage='publish-digests'
   hub.publish(rows)
   stage='public-destination-readback'
   runtime=hub.verification.json_bytes((directory/'runtime-identity.json').read_bytes())
   destination=public_manifests(rows,image_ids=runtime['imageIds'])
   require(hub.verification.validate(directory,SOURCE,CHECKSUM,REPOSITORY)==(directory,identity,records))
  else:destination={'destinationManifestDigestsVerified':False,'destinationImageConfigDigestsVerified':False}
  receipt={'schemaVersion':3,'revision':SOURCE,'sourceChecksumsSha256':CHECKSUM,'sourceRun':source,
           'publicationRun':origin,'images':rows,'published':args.publish,'sourceSignaturesVerifiedHere':True,
           'destinationDigestsVerified':args.publish,'serverDeployed':False,'actualDeploymentPerformed':False,
           'candidateBranchDeployed':False,**destination}
  args.output.parent.mkdir(parents=True,exist_ok=True)
  with args.output.open('x',encoding='utf-8') as handle:handle.write(json.dumps(receipt,indent=2)+'\n')
  print(json.dumps({'completed':True,'published':args.publish,'images':len(rows),'revision':SOURCE,'serverDeployed':False}))
  return 0
 except Exception:
  print(json.dumps({'completed':False,'failedStage':stage,'partialPublicationPossible':args.publish,'serverDeployed':False}))
  return 1


if __name__=='__main__':sys.exit(main())
