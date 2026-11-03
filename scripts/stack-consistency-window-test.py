"""Observed conservation is narrower than an atomic snapshot or deployment approval."""
import copy,importlib.util,pathlib,unittest
spec=importlib.util.spec_from_file_location('window_test',pathlib.Path(__file__).with_name('stack-consistency-window.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class WindowEvidence(unittest.TestCase):
 def fixture(self):
  before={'pending':0,'business':{'fixture':{'rows':1,'sha256':'a'*64}},'ledger':[{'version':'1','checksum':1}],'queue':[{'name':'fixture','last_seq':7}],'references':[{'version_id':'one'},{'version_id':'two'}]}
  return before,copy.deepcopy(before),{'completed':True,'allPinnedVersionIdsAndBytesVerified':True,'historicalObjectVersionsVerified':2}
 def test_unchanged_window_never_becomes_atomic_or_deployable(self):
  before,after,proof=self.fixture();after['references'].reverse();report=m.validate_window(before,after,proof)
  self.assertTrue(report['observedCrossStoreConsistencyVerified']);self.assertFalse(report['atomicSnapshotVerified']);self.assertFalse(report['automaticDeploymentAllowed'])
 def test_business_migration_queue_or_reference_drift_refused(self):
  for field,value in [('pending',1),('business',{}),('ledger',[]),('queue',[]),('references',[{'version_id':'changed'}])]:
   before,after,proof=self.fixture();after[field]=value
   with self.subTest(field=field),self.assertRaises(ValueError):m.validate_window(before,after,proof)
 def test_incomplete_object_readback_does_not_prove_consistency(self):
  for key,value in [('completed',False),('allPinnedVersionIdsAndBytesVerified',False),('historicalObjectVersionsVerified',1)]:
   before,after,proof=self.fixture();proof[key]=value
   with self.subTest(key=key),self.assertRaises(ValueError):m.validate_window(before,after,proof)

if __name__=='__main__':unittest.main()
