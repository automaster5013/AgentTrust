import copy,sys,pathlib,unittest
from stack_console_runtime_policy import apply_and_recover,NAME,runtime_policy
class Engine:
 def __init__(self,fail=None):self.fail=fail;self.used=False;self.rows={'old':{'name':NAME,'running':True,'networks':{'net1','net2'},'owned':False,'image':'old'}};self.events=[]
 def step(self,value):
  self.events.append(value)
  if value==self.fail and not self.used:self.used=True;raise RuntimeError('synthetic failure')
 def stop(self,cid):self.step('stop-'+cid);self.rows[cid]['running']=False
 def rename(self,cid,name):self.step('rename-'+cid);self.rows[cid]['name']=name
 def disconnect(self,network,cid):self.step('disconnect-'+cid);self.rows[cid]['networks'].discard(network)
 def create(self,name,plan):
  self.step('create-before');self.rows['candidate']={'name':name,'running':False,'networks':set(plan['endpoints']),'owned':True,'image':plan['config']['Image']};self.step('create-after');return 'candidate'
 def verify_created(self,cid,plan):self.step('verify-created')
 def start(self,cid):self.step('start-'+cid);self.rows[cid]['running']=True
 def healthy(self,cid):self.step('healthy-'+cid);assert self.rows[cid]['running']
 def find_owned_candidate(self,*args):return 'candidate' if self.rows.get('candidate',{}).get('owned') else None
 def networks(self,cid):return self.rows[cid]['networks'].copy()
 def connect(self,network,cid,ep):self.step('connect-'+cid);self.rows[cid]['networks'].add(network)
 def verify_original(self,cid,old):self.step('verify-original');assert cid=='old' and self.rows[cid]['image']=='old'
class RuntimePolicyTest(unittest.TestCase):
 def plan(self):return {'config':{'Image':'signed-candidate'},'host':{},'endpoints':{'net1':{},'net2':{}}}
 def test_success_retains_stopped_original_and_only_runs_candidate(self):
  e=Engine();journal=[];result=apply_and_recover(e,{'Id':'old'},self.plan(),'a'*12,lambda initial:None,lambda cid:None,journal.append)
  self.assertTrue(result['completed']);self.assertFalse(e.rows['old']['running']);self.assertTrue(e.rows['candidate']['running']);self.assertEqual(e.rows['old']['networks'],set());self.assertIn('retained',e.rows['old']['name']);self.assertFalse(result['databaseChanged'])
 def test_failures_restore_original_even_if_create_response_was_lost(self):
  for failure in ['stop-old','rename-old','disconnect-old','create-before','create-after','verify-created','start-candidate','healthy-candidate']:
   e=Engine(failure);journal=[]
   with self.subTest(failure=failure),self.assertRaises(RuntimeError):apply_and_recover(e,{'Id':'old'},self.plan(),'a'*12,lambda initial:None,lambda cid:None,journal.append)
   self.assertEqual(e.rows['old']['name'],NAME);self.assertTrue(e.rows['old']['running']);self.assertEqual(e.rows['old']['networks'],{'net1','net2'})
   if 'candidate' in e.rows:self.assertFalse(e.rows['candidate']['running']);self.assertIn('failed',e.rows['candidate']['name'])
   self.assertEqual(journal[-1]['phase'],'original-restored')
 def test_failed_actual_acceptance_restores_without_deleting_candidate_or_original(self):
  e=Engine();journal=[]
  def refuse(cid):raise ValueError('synthetic acceptance failure')
  with self.assertRaises(ValueError):apply_and_recover(e,{'Id':'old'},self.plan(),'a'*12,lambda initial:None,refuse,journal.append)
  self.assertEqual(set(e.rows),{'old','candidate'});self.assertTrue(e.rows['old']['running']);self.assertFalse(e.rows['candidate']['running'])
 def test_failed_admission_has_zero_engine_mutations(self):
  e=Engine()
  def refuse(initial):raise ValueError('insufficient unchanged capacity')
  with self.assertRaises(ValueError):apply_and_recover(e,{'Id':'old'},self.plan(),'a'*12,refuse,lambda cid:None,lambda entry:None)
  self.assertEqual(e.events,[]);self.assertTrue(e.rows['old']['running'])
 def test_capacity_failure_does_not_prevent_restoration_of_the_original(self):
  e=Engine();journal=[];calls=0
  def capacity(initial):
   nonlocal calls
   calls+=1
   if calls>1:raise ValueError('synthetic checkpoint reserve failure')
  with self.assertRaises(ValueError):apply_and_recover(e,{'Id':'old'},self.plan(),'a'*12,capacity,lambda cid:None,journal.append)
  self.assertTrue(e.rows['old']['running']);self.assertFalse(e.rows['candidate']['running']);self.assertEqual(journal[-1]['phase'],'original-restored')
 def fixture(self):
  cfg={'Entrypoint':['docker-entrypoint.sh'],'Cmd':['node','image-entry.mjs'],'User':'node','WorkingDir':'/app','ExposedPorts':{'3000/tcp':{}},'Healthcheck':{'Test':['CMD','node','health']},'Labels':{'dev.agenttrust.oidc.profile':'local-review','dev.agenttrust.oidc.application-origin':'http://127.0.0.1:4320','dev.agenttrust.oidc.public-issuer':'http://127.0.0.1:4322/realms/agenttrust'},'Env':['NODE_ENV=production','PATH=/bin']}
  old={'Id':'old','Name':'/'+NAME,'Image':'old-image','Config':copy.deepcopy(cfg),'HostConfig':{'Privileged':False,'ReadonlyRootfs':True,'CapDrop':['ALL'],'CapAdd':None,'SecurityOpt':['no-new-privileges:true'],'Memory':536870912,'RestartPolicy':{'Name':'unless-stopped','MaximumRetryCount':0},'PortBindings':{'3000/tcp':[{'HostIp':'127.0.0.1','HostPort':'4320'}]},'NetworkMode':'net1'},'Mounts':[],'NetworkSettings':{'Networks':{'net1':{'Aliases':['stack-console']},'net2':{'Aliases':['stack-console']}}},'State':{'Running':True,'Paused':False,'Health':{'Status':'healthy'}}}
  old['Config']['Labels'].update({'com.docker.compose.project':'agenttrust','com.docker.compose.service':'stack-console'});old['Config']['Env']+=['CORE_API_URL=http://stack-gateway:8080','PORT=3000','HOSTNAME=0.0.0.0']
  before={'Id':'old-image','Config':copy.deepcopy(cfg)};after={'Id':'new-image','Config':copy.deepcopy(cfg),'RepoDigests':['signed-digest'],'Os':'linux','Architecture':'amd64'};after['Config']['Labels']['org.opencontainers.image.revision']='a'*40
  manifest={'image':'signed-digest','imageId':'new-image','revision':'a'*40,'scope':['stack-console'],'databaseChanged':False};return old,before,after,manifest
 def test_policy_preserves_host_ports_and_application_overrides_without_mounting_state(self):
  old,before,after,manifest=self.fixture();result=runtime_policy(old,before,after,manifest,'a'*12);self.assertEqual(result['host'],old['HostConfig']);self.assertIn('CORE_API_URL=http://stack-gateway:8080',result['config']['Env']);self.assertEqual(result['config']['Image'],'signed-digest');self.assertEqual(old['Image'],'old-image')
 def test_wrong_service_stateful_mount_or_changed_entrypoint_cannot_be_applied(self):
  for kind in ['service','mount','entrypoint','digest','profile','override','restart']:
   old,before,after,m=self.fixture()
   if kind=='service':old['Name']='/agenttrust-stack-core-api-1'
   elif kind=='mount':old['Mounts']=[{'Type':'volume'}]
   elif kind=='entrypoint':after['Config']['Cmd']=['arbitrary']
   elif kind=='digest':after['RepoDigests']=['wrong']
   elif kind=='profile':after['Config']['Labels']['dev.agenttrust.oidc.profile']='https-review'
   elif kind=='override':old['Config']['Env']+=['UNREVIEWED_SECRET=x']
   else:old['HostConfig']['RestartPolicy']['Name']='always'
   with self.subTest(kind=kind),self.assertRaises(ValueError):runtime_policy(old,before,after,m,'a'*12)
if __name__=='__main__':unittest.main()
