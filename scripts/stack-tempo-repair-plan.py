"""Authenticate retained isolated evidence and write an encrypted review only.
There is no apply/execute mode and no operating Docker workload is created.
"""
import argparse,datetime,hashlib,importlib.util,json,pathlib,sys
import stack_chunked_cache as chunks
from stack_tempo_repair_policy import build_review
ROOT=pathlib.Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('repair_review_online',ROOT/'scripts/stack-online-recovery.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def prepare(summary,expected,output):
 summary=summary.resolve();output=output.resolve();m.e.require(summary.parent.parent==(ROOT/'.local').resolve() and output.parent==(ROOT/'.local').resolve() and not output.exists())
 proof_bytes=m.e.anchored_file(summary,expected);proof=m.e.delivery.json_bytes(proof_bytes);custody=m.c.retained_key(ROOT,pathlib.Path(proof['retainedKeyDirectory'])/'key.bin');key=custody[0].read_bytes();crypto=m.load('repair_review_crypto','stack-backup-crypt.py')
 comparison=m.e.delivery.json_bytes(crypto.transform('decrypt',key,m.e.anchored_file(summary.parent/'comparison-evidence.aesgcm',proof['encryptedComparisonSha256'])))
 manifest=m.e.delivery.json_bytes(crypto.transform('decrypt',key,m.e.anchored_file(summary.parent/'affected/manifest.aesgcm',proof['encryptedAffectedManifestSha256'],limit=8*1024*1024)));chunks.validate(manifest)
 m.e.require(all(not row['chunks'] for row in manifest['files'].values()))
 files={name:{k:v for k,v in row.items() if k!='chunks'} for name,row in manifest['files'].items()};plan=build_review(proof,comparison,files,datetime.datetime.now(datetime.timezone.utc))
 m.e.require(m.c.key_unchanged(*custody) and m.e.anchored_file(summary,expected)==proof_bytes);m.protect(output)
 cipher=crypto.transform('encrypt',key,json.dumps(plan).encode());m.c.private_file(output/'review.aesgcm',cipher)
 result={k:plan[k] for k in ('schemaVersion','kind','createdAt','matchedTraces','matchedSpans','operatingSourceWritesAllowed','operatingStopOrRestartAllowed','automaticRollbackAllowed','automaticDeploymentAllowed','restartFreeApplyVerified','restartFreeRollbackVerified','liveChecksPerformed','blockers','polling')}
 result.update(evidenceSummarySha256=expected,encryptedReviewSha256=hashlib.sha256(cipher).hexdigest(),keyCustodyUnchanged=m.c.key_unchanged(*custody));m.e.require(result['keyCustodyUnchanged']);m.c.private_file(output/'summary.json',json.dumps(result,indent=2).encode());return result

def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--evidence-summary',type=pathlib.Path,required=True);parser.add_argument('--expected-summary-sha256',required=True);parser.add_argument('--output',type=pathlib.Path,required=True);args=parser.parse_args()
 try:
  m.e.require(pathlib.Path.cwd().resolve()==ROOT);result=prepare(args.evidence_summary,args.expected_summary_sha256,args.output);print(json.dumps({'reviewPrepared':True,'liveChecksPerformed':False,'operatingSourceWritesAllowed':False,'automaticDeploymentAllowed':False,'blockingConditions':len(result['blockers'])}));return 0
 except Exception as error:print(json.dumps({'reviewPrepared':False,'code':'TEMPO_REVIEW_REFUSED','errorType':type(error).__name__}));return 1
if __name__=='__main__':sys.exit(main())
