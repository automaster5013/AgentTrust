"""Cross-phase revision, identity, freshness and scope refusal without Docker."""
import datetime,importlib.util,pathlib,unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('phase_contract',pathlib.Path(__file__).with_name('stack-recovery-evidence-join.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
NOW=datetime.datetime(2026,10,31,tzinfo=datetime.timezone.utc)

class EvidenceJoin(unittest.TestCase):
 def fixture(self):
  proof={'completed':True,'ownFixtureAndTemporarySecretsCleaned':True,'operationalContainersUnchanged':True,'actualDeploymentPerformed':False,'fullStackRecoveryVerified':False,
         'fixtureId':'fixture','encryptedManifestSha256':'a'*64,'startedAt':(NOW-datetime.timedelta(minutes=5)).isoformat(),'finishedAt':(NOW-datetime.timedelta(minutes=1)).isoformat(),
         'operatingDatabaseLogicalRestoreVerified':True,'apiRestartReauthenticationVerified':True,'fixtureApiIdAndImagePreserved':True,
         'preRestartSessionProof':{'completed':True,'oldCookieAuthenticatedBeforeRestart':True},'sessionRestartProof':{'completed':True,'oldCookieRejectedAfterApiRestart':True,'freshOidcLoginVerified':True,'sessionReauthenticationRequired':True,'existingSessionContinuityVerified':False}}
  images={'stack-db':'sha256:'+'b'*64};manifest={'snapshotId':'fixture','_pinnedCiphertextSha256':'a'*64,'candidateRevision':'c'*40,'sourceImageIds':images,'createdAt':(NOW-datetime.timedelta(minutes=4)).isoformat()}
  return proof,manifest,images
 def test_session_phase_keeps_reauthentication_distinct_from_continuity(self):
  proof,manifest,images=self.fixture();m.validate_phase('session',proof,manifest,'c'*40,images,NOW)
  proof['sessionRestartProof']['existingSessionContinuityVerified']=True
  with self.assertRaises(ValueError):m.validate_phase('session',proof,manifest,'c'*40,images,NOW)
 def test_mixed_revision_or_source_image_is_refused(self):
  proof,manifest,images=self.fixture()
  for key,value in [('candidateRevision','d'*40),('sourceImageIds',{'stack-db':'sha256:'+'e'*64}),('snapshotId','other')]:
   with self.subTest(key=key),self.assertRaises(ValueError):m.validate_phase('session',proof,{**manifest,key:value},'c'*40,images,NOW)
 def test_stale_future_or_incomplete_phase_is_refused(self):
  proof,manifest,images=self.fixture()
  for key,value in [('startedAt',(NOW-datetime.timedelta(days=2)).isoformat()),('finishedAt',(NOW+datetime.timedelta(seconds=1)).isoformat()),('completed',False),('operationalContainersUnchanged',False),('actualDeploymentPerformed',True),('fullStackRecoveryVerified',True)]:
   with self.subTest(key=key),self.assertRaises(ValueError):m.validate_phase('session',{**proof,key:value},manifest,'c'*40,images,NOW)
 def test_missing_actual_restart_cannot_be_filled_by_login_only(self):
  proof,manifest,images=self.fixture();proof['preRestartSessionProof']['oldCookieAuthenticatedBeforeRestart']=False
  with self.assertRaises(ValueError):m.validate_phase('session',proof,manifest,'c'*40,images,NOW)
  for phase in ('preRestartSessionProof','sessionRestartProof'):
   proof,manifest,images=self.fixture();proof[phase]['completed']=False
   with self.assertRaises(ValueError):m.validate_phase('session',proof,manifest,'c'*40,images,NOW)
 def test_snapshot_must_have_been_captured_inside_the_proof_window(self):
  proof,manifest,images=self.fixture();manifest['createdAt']=(NOW-datetime.timedelta(hours=1)).isoformat()
  with self.assertRaises(ValueError):m.validate_phase('session',proof,manifest,'c'*40,images,NOW)
 def test_partial_store_success_cannot_replace_durable_ack_proof(self):
  proof,manifest,images=self.fixture();manifest['liveStateIncluded']=True
  proof.update(historicalObjectVersionsRestored=True,historicalObjectProof={'completed':True,'allPinnedVersionIdsAndBytesVerified':True},allCapturedStreamsAndDurableConsumerPositionsRestored=True,
               sourceQueuePositionsUnchanged=True,queuePersistenceAndReplayVerified=True,storeQueuecompletion={'completed':True,'exactPayloadAndDurableAckVerified':False},fixtureQuotaAofReplayVerified=True,fixtureQuotaExpiredWithoutResurrection=True)
  with self.assertRaises(ValueError):m.validate_phase('stores',proof,manifest,'c'*40,images,NOW)
 def joined_fixture(self,drift=False):
  config={'candidateConfig':'fixture','candidateConfigSha256':'a'*64,'phases':[{'phase':phase} for phase in ('application','stores','session')]}
  before={'fixture':{'rows':1,'sha256':'b'*64}};after={'fixture':{'rows':2,'sha256':'c'*64}} if drift else before
  with patch.object(m.m.d,'live_baseline',return_value=([],[],{},{})),patch.object(m.m.e.planner,'compose_hashes',return_value={}),patch.object(m.m.d,'resolved_groups',return_value=([],{})),patch.object(m.m.e,'anchored_file',return_value=b'{"revision":"cccccccccccccccccccccccccccccccccccccccc"}'),patch.object(m.m.e,'verify_candidate_release'),patch.object(m.m.c,'source_preflight',return_value={}),patch.object(m.m.c.Rehearsal,'configuration',return_value=b'{}'),patch.object(m.m.c,'fingerprint',side_effect=[before,after]),patch.object(m,'read_phase',side_effect=lambda row,*args:{'phase':row['phase']}) as phases,patch.object(m.m.e.planner,'recheck'),patch.object(m.m.d,'hash_files',return_value={}):
   if drift:
    with self.assertRaises(ValueError):m.join(config)
   else:
    report=m.join(config);self.assertTrue(report['phasedBusinessRecoveryEvidenceVerified']);self.assertFalse(report['fullStackRecoveryVerified']);self.assertFalse(report['automaticDeploymentAllowed'])
   self.assertEqual(phases.call_count,3)
 def test_complete_mocked_join_cannot_promote_phases_to_deployment(self):self.joined_fixture()
 def test_source_business_drift_after_all_phases_refuses_join(self):self.joined_fixture(True)

if __name__=='__main__':unittest.main()
