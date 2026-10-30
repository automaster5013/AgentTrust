"""Native SQLite read-only snapshot and authenticated metadata probe boundaries."""
import contextlib,hashlib,importlib.util,io,json,pathlib,sqlite3,tempfile,unittest,urllib.parse
from unittest.mock import patch
ROOT=pathlib.Path(__file__).resolve().parent.parent
def module(name,file):
 spec=importlib.util.spec_from_file_location(name,ROOT/'scripts'/file);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
helper=module('grafana_sqlite','stack-file-volume-helper.py');probe=module('grafana_probe','stack-grafana-recovery-probe.py')

class GrafanaRecovery(unittest.TestCase):
 def test_native_online_snapshot_restores_rows_without_changing_source(self):
  with tempfile.TemporaryDirectory(dir=ROOT/'.local') as temporary,patch.object(helper,'ROOT',pathlib.Path(temporary)):
   path=pathlib.Path(temporary)/'grafana.db';connection=sqlite3.connect(path)
   connection.executescript("CREATE TABLE dashboard(uid TEXT,title TEXT,is_folder INTEGER); INSERT INTO dashboard VALUES('fixture','Saved history',0); CREATE TABLE data_source(uid TEXT,type TEXT,url TEXT); INSERT INTO data_source VALUES('metrics','prometheus','http://fixture:9090');");connection.close()
   original=hashlib.sha256(path.read_bytes()).digest();snapshot=helper.sqlite_snapshot();proof=helper.sqlite_verify(snapshot)
   self.assertTrue(proof['integrityVerified']);self.assertEqual(proof['dashboards'],[{'uid':'fixture','title':'Saved history'}]);self.assertEqual(hashlib.sha256(path.read_bytes()).digest(),original)
   with self.assertRaises(ValueError):helper.sqlite_verify(b'not a SQLite database')
 def test_empty_metadata_is_reported_without_inventing_history(self):
  with tempfile.TemporaryDirectory(dir=ROOT/'.local') as temporary,patch.object(helper,'ROOT',pathlib.Path(temporary)):
   connection=sqlite3.connect(pathlib.Path(temporary)/'grafana.db');connection.executescript('CREATE TABLE dashboard(uid TEXT,title TEXT); CREATE TABLE data_source(uid TEXT,type TEXT,url TEXT);');connection.close()
   proof=helper.sqlite_verify(helper.sqlite_snapshot());self.assertEqual(proof['dashboards'],[]);self.assertEqual(proof['dataSources'],[])
 def metadata_probe(self,mismatch):
  expected={'dashboards':[{'uid':'fixture','title':'Saved history'}],'dataSources':[{'uid':'metrics','type':'prometheus','url':'http://fixture:9090'}]}
  class Response:
   status=200
   def __init__(self,body):self.body=body
   def __enter__(self):return self
   def __exit__(self,*args):pass
   def read(self,size):return json.dumps(self.body).encode()
  class Opener:
   def open(self,request,**kwargs):
    self.request=request;assert request.full_url.startswith('http://stack-grafana:3000/');path=urllib.parse.urlsplit(request.full_url).path
    bodies={'/api/health':{'database':'ok'},'/api/search':[{'uid':'fixture'}],'/api/datasources':expected['dataSources'],'/api/dashboards/uid/fixture':{'dashboard':{'uid':'fixture','title':'changed' if mismatch else 'Saved history'}}}
    return Response(bodies[path])
  output=io.StringIO()
  with patch.object(pathlib.Path,'read_bytes',return_value=json.dumps(expected).encode()),patch.object(pathlib.Path,'read_text',return_value='a'*64),patch.object(probe.urllib.request,'build_opener',return_value=Opener()),contextlib.redirect_stdout(output):result=probe.main()
  self.assertEqual(result,1 if mismatch else 0);self.assertEqual(json.loads(output.getvalue())['completed'],not mismatch)
 def test_restored_dashboards_and_sources_must_be_queryable(self):self.metadata_probe(False)
 def test_changed_dashboard_metadata_refused(self):self.metadata_probe(True)

if __name__=='__main__':unittest.main()
