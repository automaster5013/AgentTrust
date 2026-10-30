"""Offline evidence binding controls; no real signature, DB or backup operations."""
import copy,datetime,importlib.util,pathlib,tempfile,unittest
spec=importlib.util.spec_from_file_location('evidence',pathlib.Path(__file__).with_name('stack-local-cd-evidence.py'))
e=importlib.util.module_from_spec(spec);spec.loader.exec_module(e)
NOW=datetime.datetime(2026,10,30,10,tzinfo=datetime.timezone.utc)

class EvidenceTests(unittest.TestCase):
 def test_flyway_line_endings_and_bom(self):
  self.assertEqual(e.checksum(b'abc\ndef\n'),e.checksum(b'\xef\xbb\xbfabc\r\ndef\r\n'))
  self.assertNotEqual(e.checksum(b'abc'),e.checksum(b'abd'))
 def test_exact_schema_only(self):
  catalog=[{'version':'1','script':'V1__one.sql','checksum':123}]
  ledger=[{'version':'1','script':'V1__one.sql','checksum':123,'success':True,'installed_rank':1}]
  self.assertTrue(e.same_schema(catalog,ledger)['sameSchemaVerified'])
  cases=[[],ledger*2,[{**ledger[0],'success':False}],[{**ledger[0],'checksum':124}],[{**ledger[0],'script':'V1__changed.sql'}]]
  for bad in cases:
   with self.assertRaises((ValueError,KeyError)):e.same_schema(catalog,bad)
 def test_anchored_bytes_change_and_size(self):
  with tempfile.TemporaryDirectory(dir=e.ROOT) as temp:
   p=pathlib.Path(temp)/'proof.json';p.write_bytes(b'{}')
   digest=e.hashlib.sha256(b'{}').hexdigest()
   self.assertEqual(e.anchored_file(p,digest),b'{}')
   p.write_bytes(b'{ }')
   with self.assertRaises(ValueError):e.anchored_file(p,digest)
   with self.assertRaises(ValueError):e.anchored_file(p,e.hashlib.sha256(b'{ }').hexdigest(),2)
 def fixtures(self):
  snapshot={'snapshotId':'fixture','revision':'a'*40,'encryptedManifestSha256':'b'*64,'serviceImageIds':{'stack-db':'sha256:'+'c'*64}}
  inventory={'stack-db':{'rollbackImageId':'sha256:'+'c'*64}}
  proof={'completed':True,'businessCriticalDevelopmentRecoveryVerified':True,'sourceServicesRestored':True,
         'ownFixtureAndTemporarySecretsCleaned':True,'fixtureId':'fixture','sourceRevision':'a'*40,
         'encryptedManifestSha256':'b'*64,'startedAt':(NOW-datetime.timedelta(hours=1)).isoformat(),
         'sourceImageIds':snapshot['serviceImageIds'].copy()}
  return proof,inventory,snapshot
 def test_recovery_identity_and_current_images(self):
  proof,inventory,snapshot=self.fixtures()
  self.assertFalse(e.recovery_binding(proof,inventory,snapshot,NOW,24)['operationalBackupVerified'])
  for key,value in [('fixtureId','other'),('sourceRevision','d'*40),('encryptedManifestSha256','e'*64),('sourceServicesRestored',False),('sourceImageIds',{'stack-db':'wrong'})]:
   bad=copy.deepcopy(proof);bad[key]=value
   with self.assertRaises(ValueError):e.recovery_binding(bad,inventory,snapshot,NOW,24)
 def test_stale_future_naive_and_loosened_age_refused(self):
  proof,inventory,snapshot=self.fixtures()
  for value in [(NOW-datetime.timedelta(days=2)).isoformat(),(NOW+datetime.timedelta(seconds=1)).isoformat(),NOW.replace(tzinfo=None).isoformat()]:
   bad=copy.deepcopy(proof);bad['startedAt']=value
   with self.assertRaises(ValueError):e.recovery_binding(bad,inventory,snapshot,NOW,24)
  for age in [0,25]:
   with self.assertRaises(ValueError):e.recovery_binding(proof,inventory,snapshot,NOW,age)

if __name__=='__main__':unittest.main()
