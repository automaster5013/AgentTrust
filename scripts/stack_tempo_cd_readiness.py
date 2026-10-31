"""Offline synthetic evidence attachment for CD review; never deployment authority."""
import argparse,hashlib,json,pathlib,re,sys
from stack_tempo_ci_verdict import verify_output

def need(value):
 if not value:raise ValueError('Tempo CD review binding refused')

def review(directory,summary_sha,evidence_sha,candidate_image,candidate_revision):
 directory=pathlib.Path(directory);need(not directory.is_symlink());pinned={}
 for name,expected in (('summary.json',summary_sha),('synthetic-evidence.json',evidence_sha)):
  need(re.fullmatch('[a-f0-9]{64}',expected))
  path=directory/name;need(path.is_file() and not path.is_symlink() and 0<path.stat().st_size<=4*1024*1024)
  raw=path.read_bytes();need(hashlib.sha256(raw).hexdigest()==expected);pinned[name]=raw
 verdict=verify_output(directory)
 for name,raw in pinned.items():need((directory/name).read_bytes()==raw)
 summary=json.loads(pinned['summary.json'])
 need(re.fullmatch('docker.io/automaster5013/agenttrust-tempo@sha256:[a-f0-9]{64}',candidate_image) and re.fullmatch('[a-f0-9]{40}',candidate_revision))
 need(summary['imageReference']==candidate_image and summary['sourceRevision']==candidate_revision)
 release=summary['release'];need(release['sourceSignaturesVerified'] is True and release['publicationRunsVerified'] is True and release['verifiedImageNames']==['tempo'])
 need(release['tempoReference']==candidate_image and release['sourceRevision']==candidate_revision and release['allSixteenSignaturesReverified'] is False)
 return {'kind':'non-executable-tempo-cd-readiness-review','syntheticWarmEvidenceVerified':True,
  'candidateTempoImage':candidate_image,'candidateRevision':candidate_revision,'summarySha256':summary_sha,'evidenceSha256':evidence_sha,
  'matchingTraces':verdict['matchingTraces'],'matchingSpans':verdict['matchingSpans'],'newMetadataErrors':verdict['newPollErrors'],
  'signatureVerificationScope':['tempo'],'liveChecksPerformed':False,'operatingTempoRecoveryVerified':False,
  'operatingSourceWritesAllowed':False,'operatingStopOrRestartAllowed':False,'healthyRollbackGuaranteed':False,
  'automaticRollbackAllowed':False,'actualCDPerformed':False,'automaticDeploymentAllowed':False,
  'remainingGates':['fresh operating recovery evidence and protected-service baseline',
   'isolated fresh-reader verification of the proposed operating recovery state',
   'coherent backup, migration compatibility and full-stack recovery evidence',
   'all candidate image signatures, runtime policy and Compose-group reconciliation',
   'separate operating change review and explicit deployment authorization'],
  'rollbackRule':'warm trace availability with new metadata errors is not a healthy rollback; do not restart or reverse operating files automatically'}

def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--hosted-output',type=pathlib.Path,required=True)
 parser.add_argument('--expected-summary-sha256',required=True);parser.add_argument('--expected-evidence-sha256',required=True)
 parser.add_argument('--candidate-tempo-image',required=True);parser.add_argument('--candidate-revision',required=True);args=parser.parse_args()
 try:
  print(json.dumps(review(args.hosted_output,args.expected_summary_sha256,args.expected_evidence_sha256,args.candidate_tempo_image,args.candidate_revision),indent=2));return 0
 except Exception as error:print(json.dumps({'reviewPrepared':False,'automaticDeploymentAllowed':False,'errorType':type(error).__name__}));return 1
if __name__=='__main__':sys.exit(main())
