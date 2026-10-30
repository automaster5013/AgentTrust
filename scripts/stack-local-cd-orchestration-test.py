"""Whole CD evidence orchestration with simulated external boundaries, never live release proof."""
import contextlib,copy,datetime,hashlib,importlib.util,json,pathlib,types,unittest
from unittest.mock import Mock,patch
spec=importlib.util.spec_from_file_location('joined_evidence',pathlib.Path(__file__).with_name('stack-local-cd-evidence.py'))
e=importlib.util.module_from_spec(spec);spec.loader.exec_module(e)
REV='a'*40;DIG='b'*64

class OrchestrationTests(unittest.TestCase):
 def exercise(self,fault=None):
  inventory={s:{'rollbackImageId':'sha256:'+DIG,'restartPolicy':'unless-stopped'} for s in set(e.planner.COMPONENTS)|e.planner.PRESERVED}
  records=[{'name':n,'reference':'ghcr.io/automaster5013/agenttrust-'+n+'@sha256:'+DIG,'digest':DIG} for n in sorted(e.planner.ALL_IMAGES)]
  receipt={'schemaVersion':2,'publicationRun':{'repository':'automaster5013/AgentTrust','workflow':'.github/workflows/original-stack.yml','runId':1,'runAttempt':1},'revision':REV,'published':True,'destinationDigestsVerified':True,'sourceSignaturesVerifiedHere':True,
           'serverDeployed':False,'sourceChecksumsSha256':'c'*64,
           'images':[{'name':r['name'],'source':r['reference'],'tag':'docker.io/automaster5013/agenttrust-'+r['name']+':'+REV,
                      'reference':'docker.io/automaster5013/agenttrust-'+r['name']+'@sha256:'+DIG} for r in records]}
  encrypted=b'simulated-encrypted-manifest'
  config={'revision':REV,'repository':'automaster5013/AgentTrust','bundle':'fixture-bundle','checksumsSha256':'c'*64,
          'receipt':'receipt','receiptSha256':'d'*64,'consoleProfile':'development','runId':1,'runAttempt':1,
          'snapshot':'fixture-snapshot','snapshotId':'fixture-id','snapshotRevision':REV,
          'snapshotManifestSha256':hashlib.sha256(encrypted).hexdigest(),'retainedKey':'fixture-key',
          'recoveryReport':'recovery','recoveryReportSha256':'e'*64,'maximumRecoveryAgeHours':24}
  proof={'completed':True,'businessCriticalDevelopmentRecoveryVerified':True,'sourceServicesRestored':True,
         'ownFixtureAndTemporarySecretsCleaned':True,'fixtureId':'fixture-id','sourceRevision':REV,
         'encryptedManifestSha256':config['snapshotManifestSha256'],
         'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
         'sourceImageIds':{'stack-db':'sha256:'+DIG}}
  if fault=='receipt':receipt['images'][0]['source']='ghcr.io/other/changed@sha256:'+DIG
  if fault=='attempt':receipt['publicationRun']['runAttempt']=2
  if fault=='stale':proof['startedAt']=(datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(days=2)).isoformat()
  snapshot={'snapshotId':'fixture-id','revision':REV,'encryptedManifestSha256':config['snapshotManifestSha256'],'authenticatedEncryptedComponents':6}
  snap=types.SimpleNamespace(verify=Mock(side_effect=lambda *a,**k:copy.deepcopy(snapshot)),bounded_file=Mock(return_value=encrypted),document=Mock(return_value={}))
  crypt=types.SimpleNamespace(transform=Mock(return_value=b'{}'))
  key=Mock();key.read_bytes.return_value=b'0'*32
  catalog=[{'version':'1','script':'V1__one.sql','checksum':123,'sha256':'f'*64}]
  ledger=[{'version':'1','script':'V1__one.sql','checksum':123,'success':True,'installed_rank':1}]
  verifier=Mock()
  if fault=='signature':verifier.verify.side_effect=ValueError('fixture signature refused')
  def anchored(path,*args):
   if str(path).endswith('checksums.json'):return json.dumps({'runtime-identity.json':'f'*64}).encode()
   if str(path).endswith('runtime-identity.json'):return json.dumps({'imageIds':{r['name']:'sha256:'+DIG for r in records}}).encode()
   return json.dumps(config if str(path)=='config' else receipt if str(path)=='receipt' else proof).encode()
  report={'completed':False,'automaticDeploymentAllowed':False,'actualDeploymentPerformed':False}
  with contextlib.ExitStack() as stack:
   def replace(target,**kw):return stack.enter_context(patch(target,**kw))
   def obj(target,name,**kw):return stack.enter_context(patch.object(target,name,**kw))
   obj(e.planner,'docker',side_effect=lambda args:'\n'.join(format(i,'064x') for i in range(20)) if args[0]=='ps' else '[]')
   obj(e.planner,'compose_hashes',side_effect=[{'fixture':'same'},{'fixture':'changed'}] if fault=='overlay-race' else lambda *args:{'fixture':'same'})
   obj(e.planner,'summarize',side_effect=[inventory,{**inventory,'extra':{}}] if fault=='inventory-race' else lambda _:copy.deepcopy(inventory))
   obj(e,'migration_catalog',return_value=catalog)
   obj(e,'live_ledger',side_effect=[ledger,[]] if fault=='schema-race' else lambda:copy.deepcopy(ledger))
   obj(e,'anchored_file',side_effect=anchored)
   obj(e.delivery,'validate',return_value=(pathlib.Path('fixture-bundle'),'identity',records))
   obj(e.delivery,'Verifier',return_value=verifier)
   obj(e,'load',side_effect=lambda name,file:snap if name=='retained_snapshot' else crypt)
   replace('stack_backup_custody.retained_key',return_value=(key,b'hash'))
   replace('stack_backup_custody.key_unchanged',return_value=True)
   replace('stack_coherent_archive.validate_manifest',return_value={'services':{'stack-db':{'imageId':'sha256:'+DIG}}})
   online=replace('stack_release_online.main_run',return_value={'trustedMainRunVerified':True})
   manifests=replace('stack_release_online.public_manifests',return_value={'destinationManifestDigestsVerified':True})
   if fault=='online':online.side_effect=ValueError('fixture main run refused')
   if fault=='registry':manifests.side_effect=ValueError('fixture manifest refused')
   args=types.SimpleNamespace(expected_revision=REV,evidence_config=pathlib.Path('config'),expected_config_sha256='0'*64)
   if fault:
    with self.assertRaises((ValueError,KeyError)):e.run(args,report)
    self.assertFalse(report['completed']);self.assertFalse(report['automaticDeploymentAllowed'])
   else:
    e.run(args,report)
    self.assertTrue(report['completed']);self.assertFalse(report['automaticDeploymentAllowed'])
    self.assertFalse(report['operationalBackupVerified']);self.assertFalse(report['newRecoveryPerformed'])
    self.assertEqual(snap.verify.call_count,2);self.assertEqual(online.call_count,2)
    self.assertEqual(verifier.verify.call_count,1)
    self.assertIn('first-operational-transition-review',report['blockers'])
 def test_simulated_join_keeps_deployment_disabled(self):self.exercise()
 def test_signature_and_receipt_failures(self):
  for fault in ['signature','receipt','attempt']:
   with self.subTest(fault=fault):self.exercise(fault)
 def test_online_and_registry_failures(self):
  for fault in ['online','registry']:
   with self.subTest(fault=fault):self.exercise(fault)
 def test_stale_recovery_and_state_races(self):
  for fault in ['stale','inventory-race','schema-race','overlay-race']:
   with self.subTest(fault=fault):self.exercise(fault)

if __name__=='__main__':unittest.main()
