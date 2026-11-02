"""Evidence and rollback-state contracts; no operating actions or daemon needed."""
import contextlib,copy,datetime,hashlib,hmac,importlib.util,json,pathlib,subprocess,sys,tempfile,unittest
from types import SimpleNamespace as NS
from unittest.mock import patch
from stack_tempo_repair_policy import EMPTY,affected_groups,assess_namespace,build_review
ROOT=pathlib.Path(__file__).resolve().parent.parent

def fixture():
 now=datetime.datetime.now(datetime.timezone.utc);prefixes=['blocks/tenant/00000000-0000-0000-0000-'+str(i).zfill(12) for i in (1,2)]
 files={p+'/'+name:{'bytes':0,'sha256':EMPTY,'mode':384} for p in prefixes for name in ('meta.json','data.parquet','index','bloom-0')}
 before={'/api/traces/'+'a'*32+'?start=100&end=200':['b'*64,3]};negative={'ready':True,'statusCode':404,'truncatedJsonErrors':2}
 proof={'kind':'isolated-empty-tempo-metadata-control','startedAt':now.isoformat(),'completed':True,'metadataFailureReproduced':True,'ownedCopyQuarantineRecoveryVerified':True,'operationalContainersUnchanged':True,'sourceEmptyMetadataUnchanged':True,'protectedLogitrackIdsAndImagesUnchanged':True,'ownFixtureAndTemporarySecretsCleaned':True,'sourceServicesStopped':False,'operatingMetadataRepaired':False,'affectedBlockContentsRecovered':False,'automaticDeploymentAllowed':False,'actualDeploymentPerformed':False,'fullStackRecoveryVerified':False,'protectedLogitrackServices':12,'quarantinedOwnedBlocks':2,'affectedFiles':8,'affectedBytes':0,'sourceApiTraceStatus':404,'sourceImageId':'sha256:'+'c'*64,'candidateRevision':'d'*40,'candidateReference':'docker.io/automaster5013/agenttrust-tempo@sha256:'+'e'*64,'matchingTraces':1,'positiveTraces':1,'matchingSpans':3,'positiveSpans':3,'negativeControl':negative}
 comparison={'baselineManifestSha256':'f'*64,'before':before,'after':copy.deepcopy(before),'negative':negative,'quarantinedSourcePrefixes':prefixes};return proof,comparison,files,now

def locations(files,states):
 result={}
 for (prefix,rows),state in zip(sorted(affected_groups(files).items()),states):
  result[prefix]={'source':{'state':'directory','files':rows} if state=='original' else {'state':'absent'},'quarantine':{'state':'directory','files':{'quarantine/'+k:v for k,v in rows.items()}} if state=='quarantined' else {'state':'absent'}}
 return result

class RepairPlan(unittest.TestCase):
 def test_review_never_promotes_restart_based_evidence_to_hot_or_operating_permission(self):
  result=build_review(*fixture());self.assertEqual(result['matchedSpans'],3);self.assertTrue(result['currentProofUsesOwnedContainerRestart'])
  for key in ('restartFreeApplyVerified','restartFreeRollbackVerified','operatingSourceWritesAllowed','automaticRollbackAllowed','automaticDeploymentAllowed','actualDeploymentPerformed','liveChecksPerformed'):self.assertFalse(result[key])
  self.assertEqual(result['polling']['proposedObservationWindowSeconds'],900);self.assertFalse(result['polling']['effectiveRuntimeIntervalVerified']);self.assertFalse(result['rollback']['healthyRecoveryGuaranteed'])
 def test_new_review_does_not_renew_historical_evidence_expiry(self):
  proof,comparison,files,now=fixture();started=now-datetime.timedelta(hours=23);proof['startedAt']=started.isoformat();result=build_review(proof,comparison,files,now)
  self.assertEqual(datetime.datetime.fromisoformat(result['sourceEvidenceStartedAt']),started);self.assertEqual(datetime.datetime.fromisoformat(result['evidenceExpiresAt']),now+datetime.timedelta(hours=1));self.assertEqual(result['createdAt'],now.isoformat());self.assertEqual(result['preflightMaxAgeSeconds'],300);self.assertFalse(result['liveChecksPerformed'])
 def test_incomplete_or_unsafe_rehearsal_cannot_generate_review(self):
  for field,value in [('completed',False),('ownFixtureAndTemporarySecretsCleaned',False),('sourceServicesStopped',True),('operatingMetadataRepaired',True),('automaticDeploymentAllowed',True),('protectedLogitrackServices',11),('restartFreeApplyVerified',True),('sourceApiTraceStatus',200),('affectedBytes',False)]:
   proof,comparison,files,now=fixture();proof[field]=value
   with self.subTest(field=field),self.assertRaises(ValueError):build_review(proof,comparison,files,now)
 def test_stale_future_naive_or_changed_trace_proof_is_refused(self):
  for hours in (-25,1):
   proof,comparison,files,now=fixture();proof['startedAt']=(now+datetime.timedelta(hours=hours)).isoformat()
   with self.assertRaises(ValueError):build_review(proof,comparison,files,now)
  proof,comparison,files,now=fixture();proof['startedAt']=now.replace(tzinfo=None).isoformat()
  with self.assertRaises(ValueError):build_review(proof,comparison,files,now)
  proof,comparison,files,now=fixture();comparison['after'][next(iter(comparison['after']))]=['f'*64,3]
  with self.assertRaises(ValueError):build_review(proof,comparison,files,now)
 def test_nonempty_extra_or_escaped_source_files_are_refused(self):
  for mutation in ('nonempty','extra','escape'):
   proof,comparison,files,now=fixture();name=next(iter(files))
   if mutation=='nonempty':files[name]['bytes']=1
   elif mutation=='extra':files[name+'/extra']=files[name]
   else:files['../escape']=files.pop(name)
   with self.assertRaises(ValueError):build_review(proof,comparison,files,now)
 def test_pristine_state_is_noop(self):
  _,_,files,_=fixture();result=assess_namespace(files,locations(files,['original','original']),True);self.assertEqual(result['state'],'original');self.assertEqual(result['proposedReverseMoves'],[])
 def test_partial_and_full_quarantine_are_reviewable_not_automatic_healthy_rollback(self):
  _,_,files,_=fixture()
  for states,count,state in [(['quarantined','original'],1,'partial-quarantine'),(['quarantined','quarantined'],2,'quarantined')]:
   result=assess_namespace(files,locations(files,states),True);self.assertEqual(result['state'],state);self.assertEqual(len(result['proposedReverseMoves']),count);self.assertIsNone(result['expectedStatusAfterNamespaceReversal']);self.assertEqual(result['expectedColdReaderStatusAfterNamespaceReversal'],404);self.assertFalse(result['warmAvailabilityProvesHealthyRollback']);self.assertFalse(result['operatingSourceWritesAllowed']);self.assertFalse(result['healthyRecoveryGuaranteed'])
 def test_collision_missing_symlink_unknown_and_drift_never_propose_overwrite(self):
  _,_,files,_=fixture()
  for case in ('collision','missing','symlink','unknown','drift'):
   state=locations(files,['quarantined','original']);first=next(iter(state))
   if case=='collision':state[first]['source']={'state':'directory','files':affected_groups(files)[first]}
   elif case in ('missing','symlink','unknown'):state[first]['quarantine']={'state':{'missing':'absent','symlink':'symlink','unknown':'unknown'}[case]}
   else:state[first]['quarantine']['files']={}
   with self.subTest(case=case):
    result=assess_namespace(files,state,True);self.assertEqual(result['state'],'manual-review');self.assertEqual(result['proposedReverseMoves'],[])
 def test_unverified_protected_health_is_inconclusive(self):
  _,_,files,_=fixture();result=assess_namespace(files,locations(files,['quarantined','original']),False);self.assertEqual(result['state'],'inconclusive');self.assertEqual(result['proposedReverseMoves'],[])
 def test_cli_has_no_execute_mode(self):
  result=subprocess.run([sys.executable,str(ROOT/'scripts/stack-tempo-repair-plan.py'),'--evidence-summary','unused','--expected-summary-sha256','a'*64,'--output','unused','--execute'],capture_output=True)
  self.assertEqual(result.returncode,2);self.assertIn(b'unrecognized arguments: --execute',result.stderr)


class PrepareEvidence(unittest.TestCase):
 def exercise(self,fault=None):
  spec=importlib.util.spec_from_file_location('authenticated_review',ROOT/'scripts/stack-tempo-repair-plan.py');tool=importlib.util.module_from_spec(spec);spec.loader.exec_module(tool)
  def transform(action,key,raw):
   if action=='encrypt':return hmac.digest(key,raw,'sha256')+raw
   if not hmac.compare_digest(raw[:32],hmac.digest(key,raw[32:],'sha256')):raise ValueError('fixture authentication refused')
   return raw[32:]
  with tempfile.TemporaryDirectory(dir=ROOT) as tmp,contextlib.ExitStack() as stack:
   root=pathlib.Path(tmp);directory=root/'.local/evidence';directory.mkdir(parents=True);(directory/'affected').mkdir();keydir=root/'.local/key';keydir.mkdir();key=b'fixture-key'.ljust(32,b'x');keypath=keydir/'key.bin';keypath.write_bytes(key);output=root/'.local/review'
   proof,comparison,files,now=fixture();manifest={'schemaVersion':1,'kind':'bounded-file-cache','crossStoreSnapshotAtomic':False,'files':{k:{**v,'chunks':[]} for k,v in files.items()}}
   proof['retainedKeyDirectory']=str(keydir)
   for filename,hashkey,value in [('comparison-evidence.aesgcm','encryptedComparisonSha256',comparison),('affected/manifest.aesgcm','encryptedAffectedManifestSha256',manifest)]:
    raw=transform('encrypt',key,json.dumps(value).encode());(directory/filename).write_bytes(raw);proof[hashkey]=hashlib.sha256(raw).hexdigest()
   positive={'before':copy.deepcopy(comparison['before']),'baselineManifestSha256':comparison['baselineManifestSha256']}
   if fault=='positive-reference':positive['before']={}
   payload=json.dumps(positive).encode();raw=transform('encrypt',key,payload);(directory/'positive-reference.aesgcm').write_bytes(raw);proof['encryptedPositiveReferenceSha256']=hashlib.sha256(raw).hexdigest()
   payload=b'unexpected end of JSON input\n'*(1 if fault=='negative-log-count' else 2);raw=transform('encrypt',key,payload);(directory/'negative-fixture-logs.aesgcm').write_bytes(raw);proof['encryptedNegativeLogsSha256']=hashlib.sha256(raw).hexdigest()
   if fault=='cipher':
    path=directory/'comparison-evidence.aesgcm';raw=path.read_bytes();raw=bytes([raw[0]^1])+raw[1:];path.write_bytes(raw);proof['encryptedComparisonSha256']=hashlib.sha256(raw).hexdigest()
   raw=json.dumps(proof).encode()
   if fault=='duplicate':raw=raw.replace(b'"completed": true',b'"completed": false, "completed": true')
   summary=directory/'summary.json';summary.write_bytes(raw);expected=hashlib.sha256(raw).hexdigest()
   if fault=='anchor':expected='0'*64
   if fault=='key':keypath.write_bytes(b'wrong-key'.ljust(32,b'x'))
   custody=(keypath,hashlib.sha256(keypath.read_bytes()).hexdigest())
   for obj,name,value in [(tool,'ROOT',root),(tool.m.c,'retained_key',lambda *a:custody),(tool.m.c,'key_unchanged',lambda path,sha:hashlib.sha256(path.read_bytes()).hexdigest()==sha),(tool.m.c,'private_file',lambda p,r:p.write_bytes(r)),(tool.m,'protect',lambda p:p.mkdir()),(tool.m,'load',lambda *a:NS(transform=transform))]:stack.enter_context(patch.object(obj,name,value))
   command=stack.enter_context(patch.object(tool.m.c,'run',side_effect=AssertionError('unexpected external command')))
   if fault:
    with self.assertRaises(ValueError):tool.prepare(summary,expected,output)
    self.assertFalse(output.exists())
   else:
    result=tool.prepare(summary,expected,output);self.assertFalse(result['liveChecksPerformed']);self.assertEqual(result['sourceEvidenceStartedAt'],proof['startedAt']);self.assertEqual(datetime.datetime.fromisoformat(result['evidenceExpiresAt']),datetime.datetime.fromisoformat(proof['startedAt'])+datetime.timedelta(hours=24));self.assertEqual(result['preflightMaxAgeSeconds'],300);self.assertFalse(result['operatingSourceWritesAllowed']);self.assertTrue(result['keyCustodyUnchanged']);self.assertTrue((output/'review.aesgcm').exists());self.assertEqual(keypath.read_bytes(),key);prep=result['freshReaderPreparation'];self.assertEqual(prep['state'],'prepared-not-executed');self.assertEqual(prep['operatingEvidenceFreshness'],'historical-only-source-files-not-rechecked');self.assertEqual([r['expectedStatus'] for r in prep['roles']],[404,200,404]);self.assertTrue(all(r['freshProcessRequired'] for r in prep['roles']));self.assertFalse(prep['sourceReadWriteMountAllowed']);self.assertFalse(prep['operatingContainerReuseAllowed']);self.assertFalse(prep['hostReserveAlreadyVerified']);self.assertEqual(prep['sourceRecheckMaxAgeSeconds'],300)
   command.assert_not_called()
 def test_complete_authenticated_offline_preparation(self):self.exercise()
 def test_wrong_key_and_rehashed_corrupt_cipher_precede_output_creation(self):
  for fault in ('key','cipher'):
   with self.subTest(fault=fault):self.exercise(fault)
 def test_positive_reference_or_negative_log_substitution_is_refused(self):
  for fault in ('positive-reference','negative-log-count'):
   with self.subTest(fault=fault):self.exercise(fault)
 def test_wrong_anchor_and_duplicate_proof_fields_precede_output_creation(self):
  for fault in ('anchor','duplicate'):
   with self.subTest(fault=fault):self.exercise(fault)
if __name__=='__main__':unittest.main()
