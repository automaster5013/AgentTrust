"""Full-path mocked restore orchestration: no daemon, network or source writes."""
import contextlib,hashlib,importlib.util,json,pathlib,tempfile,unittest,uuid
from types import SimpleNamespace as NS
from unittest.mock import patch
ROOT=pathlib.Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('metric_orchestration',ROOT/'scripts/stack-prometheus-history-recovery.py');driver=importlib.util.module_from_spec(spec);spec.loader.exec_module(driver)

class Orchestration(unittest.TestCase):
 def exercise(self,mismatch=False,drift=False):
  m=driver.m;commands=[];written={};drills=[];data=b'fixture persisted samples';block='0'*25+'1';files={block+'/index':{'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'mode':384}};selected=[{'prefix':block,'start':1000,'end':2000}]
  source={'Image':'sha256:'+'a'*64,'Config':{'User':'10001:10001','Cmd':['--config.file=/etc/prometheus.yaml','--storage.tsdb.path=/prometheus']},'Mounts':[{'Type':'volume','Name':'agenttrust_stack-prometheus-data'},{'Type':'bind','Destination':'/etc/prometheus.yaml','Source':str(ROOT/'infra/stack-observability/prometheus.yaml')}]}
  def result(value=b''):return NS(stdout=json.dumps(value).encode() if not isinstance(value,bytes) else value,returncode=0)
  def run(args,**kwargs):
   commands.append(args)
   if args[:3]==['docker','volume','inspect']:return result([{'Labels':{'com.docker.compose.project':'agenttrust','com.docker.compose.volume':'stack-prometheus-data'}}])
   if args[:3]==['docker','image','inspect']:return result([{'Id':'sha256:'+'b'*64}])
   if 'select-prometheus' in args:return result(selected)
   if 'inventory' in args:
    value=json.loads(json.dumps(files))
    if drift and sum('inventory' in c for c in commands)>=3:value[block+'/index']['sha256']='f'*64
    return result(value)
   if 'read' in args:return result(data)
   if 'write' in args:written[args[args.index('--path')+1]]=kwargs['data'];return result()
   return result()
  with tempfile.TemporaryDirectory(dir=ROOT/'.local') as temporary,contextlib.ExitStack() as stack:
   directory=pathlib.Path(temporary)
   class Drill:
    def __init__(self,sources):
     self.id=str(uuid.uuid4());self.prefix='agenttrust-stack-coldrestore-'+self.id;self.directory=directory;self.report={};self.volumes=[];self.private=[];self.containers=[];drills.append(self)
    def stage(self,value):self.report['stage']=value
    def own_volume(self,*args):pass
    def volume_command(self,*args,**kwargs):pass
    def wait(self,*args):pass
    def cleanup(self):self.report['cleaned']=True
   config=directory/'candidate.json';raw=json.dumps({'revision':'c'*40}).encode();config.write_bytes(raw)
   release={'receipt':{'images':[{'name':'prometheus','reference':'docker.io/automaster5013/agenttrust-prometheus@sha256:'+'d'*64}]},'directory':directory}
   (directory/'runtime-identity.json').write_text(json.dumps({'imageIds':{'prometheus':'sha256:'+'b'*64}}))
   def api(name,start,end):
    value='0' if mismatch and 'coldrestore' in name else '1'
    return {'status':'success','data':{'resultType':'matrix','result':[{'metric':{'job':'agenttrust-otel'},'values':[[start,'1'],[end,value]]}]}}
   patches=[(m,'session_capacity',lambda *a:None),(m.d,'live_baseline',lambda:(['source'],{}, {'stack-prometheus':{}},{'stack-prometheus':source})),(m.d,'resolved_groups',lambda *a:({},{})),(m.d,'hash_files',lambda *a:{}),(m.e.planner,'compose_hashes',lambda *a:{}),(m.e.planner,'recheck',lambda *a:None),(m.e,'verify_candidate_release',lambda *a:release),(m.c,'reserve',lambda:None),(m.c,'run',run),(m.c,'Rehearsal',Drill),(m.c,'private_file',lambda p,r:p.write_bytes(r)),(m,'protect',lambda p:p.mkdir()),(m,'cached_identity',lambda *a:None),(m,'load',lambda *a:NS(transform=lambda action,key,raw:raw)),(driver,'get',api)]
   for obj,name,value in patches:stack.enter_context(patch.object(obj,name,value))
   try:drill=driver.run(config,hashlib.sha256(raw).hexdigest())
   finally:
    for drill in drills:
     keydir=pathlib.Path(drill.report['retainedKeyDirectory']);(keydir/'key.bin').unlink();keydir.rmdir()
   self.assertTrue(drill.report['cleaned']);self.assertTrue(drill.report['operationalContainersUnchanged'])
   self.assertEqual(drill.report['completed'],not(mismatch or drift));self.assertFalse(drill.report['fullStackRecoveryVerified']);self.assertFalse(drill.report['actualDeploymentPerformed'])
   starts=[c for c in commands if c[:3]==['docker','run','-d']]
   self.assertEqual(len(starts),0 if drift else 1)
   for command in starts:self.assertEqual(command[command.index('--network')+1],'none');self.assertNotIn('-p',command)
   self.assertEqual(written[block+'/index'],data)
 def test_full_path_restore_and_source_readback(self):self.exercise()
 def test_changed_metric_blocks_success_and_cleans_fixture(self):self.exercise(mismatch=True)
 def test_source_file_drift_prevents_candidate_start(self):self.exercise(drift=True)
if __name__=='__main__':unittest.main()
