"""Deployment scope, command and failure-policy tests; no Docker/service mutations."""
import copy,datetime,hashlib,importlib.util,json,pathlib,tempfile,unittest
from unittest.mock import Mock,patch
from stack_local_cd_executor import *
NOW=datetime.datetime(2026,10,30,12,tzinfo=datetime.timezone.utc)

class ExecutorTests(unittest.TestCase):
 def approval(self,services):
  return {'planSha256':'a'*64,'allowServiceRecreation':True,'allowSameSchemaImageRollback':True,
          'localDevelopmentRecoveryScopeAccepted':True,'statefulTransitionReviewed':True,'services':services,
          'issuedAt':(NOW-datetime.timedelta(minutes=1)).isoformat(),'expiresAt':(NOW+datetime.timedelta(minutes=10)).isoformat()}
 def test_approval_is_explicit_fresh_and_exact_scope(self):
  services=['stack-ai-worker'];approval=self.approval(services);validate_approval(approval,'a'*64,services,NOW)
  for key,value in [('allowServiceRecreation',False),('planSha256','b'*64),('services',['db']),('issuedAt',(NOW-datetime.timedelta(hours=1)).isoformat()),('expiresAt',NOW.isoformat())]:
   with self.subTest(key=key),self.assertRaises(ValueError):validate_approval({**approval,key:value},'a'*64,services,NOW)
  with self.assertRaises(ValueError):validate_approval({**self.approval(['stack-db']),'statefulTransitionReviewed':False},'a'*64,['stack-db'],NOW)
 def test_compose_command_cannot_build_pull_dependencies_or_other_projects(self):
  with tempfile.TemporaryDirectory(dir=pathlib.Path(__file__).resolve().parent.parent) as tmp:
   root=pathlib.Path(tmp).resolve();paths=[]
   for name in ['base.yaml','private.env','review.json']:
    p=root/name;p.write_text('fixture');paths.append(str(p))
   command=compose_apply_command(root,[paths[0]],[paths[1]],paths[2],'stack-core-api')
   self.assertEqual(command[:4],['docker','compose','--project-name','agenttrust'])
   for flag in ['--no-build','--no-deps','--wait']:self.assertIn(flag,command)
   self.assertEqual(command[command.index('--pull')+1],'never')
   self.assertEqual(command[-1],'stack-core-api');self.assertNotIn('down',command)
   with self.assertRaises(ValueError):compose_apply_command(root,[paths[0]],[paths[1]],paths[2],'db')
 def test_success_uses_fixed_dependency_order(self):
  calls=[];result=transition(['stack-console','stack-core-api','stack-ai-worker'],lambda s,r:calls.append((s,r)),lambda *args:None,lambda touched:None)
  self.assertTrue(result['completed']);self.assertEqual([x[0] for x in calls],['stack-core-api','stack-ai-worker','stack-console'])
 def test_stateless_failure_restores_failed_target_and_previous_targets(self):
  calls=[]
  def apply(service,rollback):
   calls.append((service,rollback))
   if service=='stack-ai-worker' and not rollback:raise ValueError('fixture failure')
  result=transition(['stack-core-api','stack-ai-worker','stack-console'],apply,lambda *args:None,lambda touched:None)
  self.assertTrue(result['rolledBack']);self.assertFalse(result['completed']);self.assertFalse(result['manualRecoveryRequired'])
  self.assertEqual(calls,[('stack-core-api',False),('stack-ai-worker',False),('stack-ai-worker',True),('stack-core-api',True)])
 def test_stateful_failure_never_automatically_downgrades_data_images(self):
  calls=[]
  def apply(service,rollback):
   calls.append((service,rollback))
   if service=='stack-core-api':raise ValueError('fixture failure')
  result=transition(['stack-db','stack-core-api'],apply,lambda *args:None,lambda touched:None)
  self.assertTrue(result['manualRecoveryRequired']);self.assertFalse(result['rolledBack']);self.assertFalse(any(r for _,r in calls))
 def test_rollback_failure_stops_with_manual_recovery(self):
  result=transition(['stack-core-api','stack-console'],lambda *args:(_ for _ in ()).throw(ValueError('fixture failure')),lambda *args:None,lambda touched:None)
  self.assertTrue(result['manualRecoveryRequired']);self.assertEqual(len(result['events']),2)
 def test_checkpoint_failure_prevents_mutation(self):
  apply=Mock()
  with self.assertRaises(ValueError):transition(['stack-core-api'],apply,Mock(),lambda touched:(_ for _ in ()).throw(ValueError('drift')))
  apply.assert_not_called()
 def model(self):
  model={'read_only':True,'cap_drop':['ALL'],'security_opt':['no-new-privileges:true'],'networks':{'private':{}},
         'environment':{'SYNTHETIC_TOKEN':'fixture'},'mem_limit':128,'pids_limit':64,'ports':[{'target':8080,'published':'8080','host_ip':'127.0.0.1'}]}
  row={'Config':{'Env':['SYNTHETIC_TOKEN=fixture'],'User':'10001'},'HostConfig':{'ReadonlyRootfs':True,'Memory':128,'PidsLimit':64,'CapDrop':['ALL'],'SecurityOpt':['no-new-privileges'],
       'PortBindings':{'8080/tcp':[{'HostIp':'127.0.0.1','HostPort':'8080'}]}},'NetworkSettings':{'Networks':{'agenttrust_private':{}}},'Mounts':[]}
  return model,{'networks':{'private':{'name':'agenttrust_private'}}},row
 def test_resolved_environment_network_ports_and_resources_match_in_memory(self):
  model,resources,row=self.model();self.assertEqual(live_layout_matches(model,resources,row),[])
  for field,value in [('Memory',256),('Privileged',True),('PortBindings',{})]:
   bad=copy.deepcopy(row);bad['HostConfig'][field]=value
   with self.assertRaises(ValueError):live_layout_matches(model,resources,bad)
  bad=copy.deepcopy(row);bad['Config']['Env']=['SYNTHETIC_TOKEN=other']
  with self.assertRaises(ValueError):live_layout_matches(model,resources,bad)
 def full_execute_fixture(self,fail_worker=False):
  spec=importlib.util.spec_from_file_location('deployer_full',pathlib.Path(__file__).with_name('stack-local-cd-deploy.py'))
  d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d)
  fixture_spec=importlib.util.spec_from_file_location('inventory_tests',pathlib.Path(__file__).with_name('stack-local-cd-plan-test.py'))
  fixture=importlib.util.module_from_spec(fixture_spec);fixture_spec.loader.exec_module(fixture)
  with tempfile.TemporaryDirectory(dir=pathlib.Path(__file__).resolve().parent.parent) as tmp:
   root=pathlib.Path(tmp).resolve();(root/'.local').mkdir();base=root/'base.yaml';base.write_text('fixture');env=root/'private.env';env.write_text('fixture')
   originals=fixture.inventory_fixture()
   for i,row in enumerate(originals):
    row['Id']=format(i+1,'064x');row['Config']['Image']='sha256:'+'b'*64
    row['Config']['Labels']['com.docker.compose.project.config_files']=str(base)
   before=d.e.planner.summarize(originals);old={x['Config']['Labels']['com.docker.compose.service']:x for x in originals};current=copy.deepcopy(old)
   source=[{'service':service,'candidate':'docker.io/automaster5013/agenttrust-'+component+'@sha256:'+'c'*64,
            'rollbackImageId':before[service]['rollbackImageId'],'restartPolicy':'unless-stopped'} for service,component in d.e.planner.COMPONENTS.items()]
   config={'revision':'a'*40,'checksumsSha256':'f'*64,'repository':'automaster5013/AgentTrust'}
   plan={'services':['stack-core-api','stack-ai-worker'],'configPath':str(root/'config'),'configSha256':'e'*64,'revision':'a'*40,
         'inventory':before,'groups':[{'services':['stack-core-api','stack-ai-worker'],'filesInOrder':[str(base)],'environmentFiles':[str(env)]}],
         'composeFileSha256':d.e.planner.compose_hashes(before,root),'protectedFileSha256':{str(env):hashlib.sha256(env.read_bytes()).hexdigest()},
         'candidateOverride':d.r.candidate_review_override(source,before),'rollbackOverride':d.r.review_baseline_override(before),'ledger':[{'fixture':'ledger'}]}
   proof={'completed':True,'revision':'a'*40,'fullStackRecoveryVerified':True,'candidateImages':{s:v['image'] for s,v in plan['candidateOverride']['services'].items() if s in ORDER}}
   approval=self.approval(plan['services']);now=datetime.datetime.now(datetime.timezone.utc)
   approval.update(issuedAt=(now-datetime.timedelta(seconds=1)).isoformat(),expiresAt=(now+datetime.timedelta(minutes=5)).isoformat(),isolatedFullStackProof='proof',isolatedFullStackProofSha256='d'*64)
   (root/'runtime-identity.json').write_text(json.dumps({'imageIds':{name:'sha256:'+'d'*64 for name in d.e.planner.ALL_IMAGES}}))
   release={'plan':source,'directory':root,'receipt':{'images':[{'name':row['candidate'].split('agenttrust-')[1].split('@')[0],'reference':row['candidate']} for row in source]}}
   calls=[];counter=[100];failed=[False]
   def command(args,timeout=180):
    if args[:2]==['docker','pull']:return ''
    if args[:3]==['docker','image','inspect']:
     return json.dumps([{'Id':'sha256:'+'d'*64,'RepoDigests':[args[3].removeprefix('docker.io/')],'Os':'linux','Architecture':'amd64'}])
    if args[:2]==['docker','inspect']:
     values=[]
     for key in args[2:]:
      values.append(copy.deepcopy(current[key.removeprefix('agenttrust-').removesuffix('-1')]) if key.startswith('agenttrust-') else next(copy.deepcopy(v) for v in current.values() if v['Id']==key))
     return json.dumps(values)
    if args[:2]==['docker','compose']:
     service=args[-1];rollback=any(str(value).endswith('rollback.compose.json') for value in args);calls.append((service,rollback));counter[0]+=1
     current[service]['Id']=format(counter[0],'064x');current[service]['Image']='sha256:'+('b' if rollback else 'd')*64
     if fail_worker and service=='stack-ai-worker' and not rollback and not failed[0]:failed[0]=True;raise ValueError('simulated apply failure')
     return ''
    raise AssertionError('Unexpected command')
   def evidence(args,report):report.update(completed=True,retainedDevelopmentRecoveryEvidenceBound=True,currentSourceConfigurationBound=True)
   with patch.object(d,'ROOT',root),patch.object(d,'command',side_effect=command),patch.object(d.e,'anchored_file',side_effect=lambda path,*args:json.dumps(proof if str(path)=='proof' else config).encode()),patch.object(d.e,'run',side_effect=evidence),patch.object(d,'live_baseline',return_value=(tuple(v['Id'] for v in originals),originals,before,old)),patch.object(d,'resolved_groups',return_value=(plan['groups'],plan['protectedFileSha256'])),patch.object(d.e,'verify_candidate_release',return_value=release),patch.object(d.e,'live_ledger',return_value=plan['ledger']),patch.object(d.e.planner,'docker',side_effect=lambda args:'\n'.join(current)):
    result=d.execute(plan,'a'*64,approval)
   self.assertTrue(result['actualDeploymentPerformed']);self.assertTrue(result['mutationMayHaveStarted'])
   self.assertEqual(result['rolledBack'],fail_worker);self.assertEqual(result['completed'],not fail_worker)
   self.assertEqual(calls[:2],[('stack-core-api',False),('stack-ai-worker',False)])
   if fail_worker:self.assertEqual(calls[-2:],[('stack-ai-worker',True),('stack-core-api',True)])
   self.assertFalse(any(service in {'api','worker','db','stack-redis','stack-grafana'} for service,_ in calls))
 def test_complete_mocked_execution_with_real_command_construction(self):self.full_execute_fixture()
 def test_complete_mocked_execution_failure_rehearses_reverse_rollback(self):self.full_execute_fixture(True)
 def test_real_execute_cannot_reach_mutation_without_recovery_proof(self):
  spec=importlib.util.spec_from_file_location('deployer',pathlib.Path(__file__).with_name('stack-local-cd-deploy.py'))
  module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
  plan={'services':['stack-ai-worker'],'configPath':'fixture-config','configSha256':'b'*64,'revision':'c'*40}
  approval=self.approval(plan['services']);current=datetime.datetime.now(datetime.timezone.utc)
  approval.update(issuedAt=(current-datetime.timedelta(seconds=1)).isoformat(),expiresAt=(current+datetime.timedelta(minutes=5)).isoformat())
  with patch.object(module.e,'anchored_file',return_value=b'{}'),patch.object(module.e,'run',side_effect=ValueError('fresh recovery missing')),patch.object(module,'command') as command:
   with self.assertRaises(ValueError):module.execute(plan,'a'*64,approval)
   command.assert_not_called()

if __name__=='__main__':unittest.main()
