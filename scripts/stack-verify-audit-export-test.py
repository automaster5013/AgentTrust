"""Offline process controls for downloaded unsigned audit metadata."""
import base64,hashlib,json,pathlib,struct,subprocess,tempfile,unittest,uuid
ROOT=pathlib.Path(__file__).resolve().parent.parent
ORG='11111111-1111-4111-8111-111111111111';PROJECT='22222222-2222-4222-8222-222222222222'
class Controls(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory(prefix='audit-cli-controls-',dir=ROOT/'.local');self.folder=pathlib.Path(self.temp.name)
  self.doc={'schemaVersion':1,'kind':'project-audit-export','organizationId':ORG,'projectId':PROJECT,'ordering':'created-at-id-desc','limit':500,'entries':[],'recordCount':0,'hasOlderRecords':False,'entireProjectHistory':True,'currentDeploymentAuthority':False,'signed':False,'newestCursor':None,'oldestCursor':None}
 def tearDown(self):
  self.assertTrue(self.folder.resolve().is_relative_to((ROOT/'.local').resolve()));self.temp.cleanup()
 def run_cli(self,raw,changes=None,extra=None):
  path=self.folder/'audit.json';path.write_bytes(raw);before=hashlib.sha256(raw).hexdigest();options={'--file':str(path),'--sha256':before,'--organization':ORG,'--project':PROJECT};options.update(changes or {});args=[x for pair in options.items() for x in pair]+(extra or [])
  r=subprocess.run(['node','--experimental-strip-types',str(ROOT/'scripts/stack-verify-audit-export.ts'),*args],cwd=ROOT,capture_output=True,text=True,encoding='utf-8',timeout=15);self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),before);self.assertLess(len(r.stdout),2048);value=json.loads(r.stdout);self.assertFalse(value['currentDeploymentAuthority']);self.assertFalse(value['issuerAuthenticated']);self.assertFalse(value['networkUsed']);return r.returncode,value
 def raw(self,doc=None):return json.dumps(doc or self.doc,separators=(',',':')).encode()
 def test_valid_complete_empty_snapshot(self):
  code,value=self.run_cli(self.raw());self.assertEqual(code,0);self.assertTrue(value['completed']);self.assertEqual(value['recordCount'],0);self.assertTrue(value['entireProjectHistory'])
 def test_wrong_expected_digest_or_scope(self):
  for change in [{'--sha256':'0'*64},{'--organization':PROJECT},{'--project':ORG},{'--sha256':'X'*64},{'--organization':'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'}]:
   with self.subTest(change=change):self.assertEqual(self.run_cli(self.raw(),change)[0],1)
 def test_invalid_bytes_size_and_json(self):
  for raw in [b'',b'\xff',b'{',b' '*262145,b'\xef\xbb\xbf'+self.raw()]:
   with self.subTest(size=len(raw)):self.assertEqual(self.run_cli(raw)[0],1)
 def test_wrong_contract_or_authority(self):
  for change in [{'signed':True},{'currentDeploymentAuthority':True},{'hasOlderRecords':True},{'recordCount':1},{'extra':True}]:
   with self.subTest(change=change):self.assertEqual(self.run_cli(self.raw({**self.doc,**change}))[0],1)
 def entries_document(self,count,more=False):
  rows=[{'id':'ffffffff-ffff-4fff-8fff-'+format(count-i,'012x'),'actorId':ORG,'resourceId':PROJECT,'action':'evaluation.completed','createdAt':'2026-10-12T00:00:00.123456Z'} for i in range(count)]
  def boundary(row):return base64.urlsafe_b64encode(uuid.UUID(ORG).bytes+uuid.UUID(PROJECT).bytes+struct.pack('>qi',1791763200,123456000)+uuid.UUID(row['id']).bytes).decode().rstrip('=')
  return {**self.doc,'entries':rows,'recordCount':count,'hasOlderRecords':more,'entireProjectHistory':not more,'newestCursor':boundary(rows[0]),'oldestCursor':boundary(rows[-1])}
 def test_five_hundred_rows_and_order_across_pages(self):
  doc=self.entries_document(500,True);code,value=self.run_cli(self.raw(doc));self.assertEqual(code,0);self.assertEqual(value['recordCount'],500);self.assertTrue(value['hasOlderRecords']);self.assertFalse(value['entireProjectHistory'])
  for mutate in ['duplicate','page-order','boundary']:
   changed=json.loads(json.dumps(doc))
   if mutate=='duplicate':changed['entries'][25]=changed['entries'][24]
   elif mutate=='page-order':changed['entries'][24],changed['entries'][25]=changed['entries'][25],changed['entries'][24]
   else:changed['oldestCursor']=changed['newestCursor']
   self.assertEqual(self.run_cli(self.raw(changed))[0],1)
 def test_exact_maximum_utf8_byte_boundary(self):
  raw=self.raw();self.assertEqual(self.run_cli(raw+b' '*(262144-len(raw)))[0],0);self.assertEqual(self.run_cli(raw+b' '*(262145-len(raw)))[0],1)
 def test_missing_or_directory_input_is_refused(self):
  for path in [self.folder,self.folder/'missing.json']:
   self.assertEqual(self.run_cli(self.raw(),{'--file':str(path)})[0],1)
 def test_duplicate_and_unknown_arguments(self):
  for extra in [['--project',PROJECT],['--unknown','x']]:self.assertEqual(self.run_cli(self.raw(),extra=extra)[0],1)
if __name__=='__main__':unittest.main()
