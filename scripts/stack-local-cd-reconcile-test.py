"""Offline group reconciliation controls; no live Compose or Docker calls."""
import contextlib,copy,importlib.util,json,pathlib,types,unittest
from unittest.mock import Mock,patch
spec=importlib.util.spec_from_file_location('reconcile',pathlib.Path(__file__).with_name('stack-local-cd-reconcile.py'))
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)

class ReconciliationTests(unittest.TestCase):
 def fixture(self):
  names=sorted(r.planner.COMPONENTS)
  groups=[{'services':names[:3]},{'services':names[3:5]},{'services':names[5:]}]
  base={'services':{name:{'image':'agenttrust-'+component+':local','restart':'no','environment':{'PRIVATE_TOKEN':'synthetic-secret'},'read_only':True}
                    for name,component in r.planner.COMPONENTS.items()}}
  models=[copy.deepcopy(base) for _ in groups]
  for i,model in enumerate(models):
   for name in names:model['services'][name]['image']='agenttrust-review-'+str(i)+':local'
  return models,groups
 def test_images_selected_only_from_owning_group(self):
  models,groups=self.fixture();selected,diff=r.compare_models(models,groups)
  self.assertEqual(diff,[])
  for i,group in enumerate(groups):
   for service in group['services']:
    self.assertEqual(selected[service]['group'],i+1)
    self.assertEqual(selected[service]['image'],'agenttrust-review-'+str(i)+':local')
 def test_private_environment_difference_is_redacted(self):
  models,groups=self.fixture();service=groups[1]['services'][0]
  models[1]['services'][service]['environment']['PRIVATE_TOKEN']='different-synthetic-secret'
  selected,differences=r.compare_models(models,groups)
  self.assertEqual(differences,[{'group':2,'service':service,'changedFields':['environment']}])
  self.assertNotIn('synthetic-secret',str(differences))
 def test_missing_duplicate_foreign_or_unsafe_service_images_refused(self):
  for fault in ['missing','duplicate','foreign','image']:
   models,groups=self.fixture()
   if fault=='missing':groups[2]['services']=groups[2]['services'][:-1]
   elif fault=='duplicate':groups[1]['services'].append(groups[0]['services'][0])
   elif fault=='foreign':groups[2]['services'][0]='db'
   else:models[0]['services'][groups[0]['services'][0]]['image']='--privileged'
   with self.assertRaises((ValueError,KeyError)):r.compare_models(models,groups)
 def candidate_flow(self,fault=None):
  models,groups=self.fixture()
  for i,group in enumerate(groups):group['filesInOrder']=['group-'+str(i)]
  for model in models:
   for helper in ['stack-migrate','stack-object-init']:model['services'][helper]={'image':'fixture:old','restart':'no'}
  inventory={s:{'rollbackImageId':'sha256:'+'b'*64,'restartPolicy':'unless-stopped'} for s in set(r.planner.COMPONENTS)|r.planner.PRESERVED}
  plan=[{'service':service,'candidate':'docker.io/automaster5013/agenttrust-'+component+'@sha256:'+'d'*64,
         'rollbackImageId':'sha256:'+'b'*64,'restartPolicy':'unless-stopped'} for service,component in r.planner.COMPONENTS.items()]
  config={'checksumsSha256':'c'*64,'repository':'automaster5013/AgentTrust','receipt':'fixture-receipt','receiptSha256':'e'*64,'runId':1,'runAttempt':1}
  release={'directory':pathlib.Path('fixture-bundle'),'identity':'identity','records':[],'plan':plan}
  ledger=[{'fixture':'ledger'}]
  evidence=types.SimpleNamespace(anchored_file=Mock(return_value=json.dumps(config).encode()),
      delivery=types.SimpleNamespace(json_bytes=json.loads,validate=Mock(return_value=(release['directory'],'identity',[]))),
      live_ledger=Mock(side_effect=[ledger,[]] if fault=='ledger' else lambda:copy.deepcopy(ledger)),
      migration_catalog=Mock(return_value=[]),same_schema=Mock(),verify_candidate_release=Mock(return_value=release))
  if fault=='trust':evidence.verify_candidate_release.side_effect=ValueError('simulated trust refusal')
  if fault=='artifact':evidence.delivery.validate.return_value=(pathlib.Path('changed'),'other',[])
  render_calls=[]
  def render(unused,override):
   render_calls.append(override)
   rendered=copy.deepcopy(models)
   for model in rendered:
    for service,fields in override['services'].items():model['services'][service].update(fields)
   if fault=='settings' and len(render_calls)==2:rendered[0]['services']['stack-core-api']['read_only']=False
   return rendered
  def docker(args):
   if args[0]=='inspect':return '[]'
   if args[0]=='image':return 'sha256:'+'b'*64
   index=int(args[args.index('-f')+1].split('-')[-1])
   return json.dumps(models[index])
  with contextlib.ExitStack() as stack:
   def obj(target,name,**kw):return stack.enter_context(patch.object(target,name,**kw))
   obj(r.planner,'running_ids',return_value=tuple(format(i,'064x') for i in range(20)))
   obj(r.planner,'docker',side_effect=docker);obj(r.planner,'summarize',return_value=inventory)
   obj(r.planner,'compose_hashes',return_value={'fixture':'hash'});obj(r.planner,'runtime_file_groups',return_value=groups)
   recheck=obj(r.planner,'recheck');obj(r,'render_review',side_effect=render);obj(r,'candidate_evidence_module',return_value=evidence)
   online=stack.enter_context(patch('stack_release_online.main_run',return_value={'trustedMainRunVerified':True}))
   if fault=='online':online.side_effect=ValueError('simulated online refusal')
   if fault:
    with self.assertRaises(ValueError):r.analyze(candidate=(pathlib.Path('config'),'f'*64,'a'*40))
   else:
    result=r.analyze(candidate=(pathlib.Path('config'),'f'*64,'a'*40))
    self.assertTrue(result['candidateSignaturesVerified']);self.assertTrue(result['candidateModelsEqualAcrossGroups'])
    self.assertFalse(result['candidateImagesExecuted']);self.assertFalse(result['automaticDeploymentAllowed'])
    self.assertFalse(result['backupOrRecoveryVerifiedHere']);self.assertTrue(result['registryContacted'])
    self.assertEqual(len(render_calls),2);self.assertEqual(recheck.call_count,1)
    self.assertEqual(evidence.live_ledger.call_count,2);self.assertEqual(evidence.anchored_file.call_count,3)
 def test_simulated_candidate_renderer_keeps_execution_disabled(self):self.candidate_flow()
 def test_candidate_renderer_trust_state_and_artifact_failures(self):
  for fault in ['trust','settings','artifact','online','ledger']:
   with self.subTest(fault=fault):self.candidate_flow(fault)
 def test_candidate_override_uses_digest_images_and_matching_one_shot_helpers(self):
  originals,_=self.fixture()
  inventory={s:{'rollbackImageId':'sha256:'+'b'*64,'restartPolicy':'unless-stopped'} for s in set(r.planner.COMPONENTS)|r.planner.PRESERVED}
  plan=[{'service':service,'candidate':'docker.io/automaster5013/agenttrust-'+component+'@sha256:'+'d'*64,
         'rollbackImageId':'sha256:'+'b'*64,'restartPolicy':'unless-stopped'} for service,component in r.planner.COMPONENTS.items()]
  override=r.candidate_review_override(plan,inventory)
  self.assertFalse(set(override['services'])&r.planner.PRESERVED)
  for original in originals:
   for helper in ['stack-migrate','stack-object-init']:original['services'][helper]={'image':'fixture:old','restart':'no'}
  rendered=copy.deepcopy(originals)
  for model in rendered:
   for service,fields in override['services'].items():model['services'][service].update(fields)
  self.assertTrue(r.review_model_checks(rendered,inventory,originals,override)['nonImageSettingsPreserved'])
  bad=copy.deepcopy(override);bad['services']['stack-migrate']['image']='fixture:stale'
  with self.assertRaises(ValueError):r.review_model_checks(rendered,inventory,originals,bad)
  for value in override['services'].values():self.assertNotIn('environment',value)
 def test_review_baseline_binds_runtime_and_one_shot_images_without_other_changes(self):
  models,_=self.fixture()
  inventory={s:{'rollbackImageId':'sha256:'+'b'*64,'restartPolicy':'unless-stopped'} for s in set(r.planner.COMPONENTS)|r.planner.PRESERVED}
  override=r.review_baseline_override(inventory)
  self.assertEqual(set(override['services']),set(r.planner.COMPONENTS)|{'stack-migrate','stack-object-init'})
  for original in models:
   for helper in ['stack-migrate','stack-object-init']:original['services'][helper]={'image':'fixture:old','restart':'no','command':['fixture-init']}
  rendered=copy.deepcopy(models)
  for model in rendered:
   for service,fields in override['services'].items():model['services'][service].update(fields)
  self.assertTrue(r.baseline_model_checks(rendered,inventory,models)['reviewBaselineImagesBound'])
  for kind in ['runtime-setting','helper-loop','project-resource']:
   bad=copy.deepcopy(rendered)
   if kind=='runtime-setting':bad[0]['services']['stack-core-api']['read_only']=False
   elif kind=='helper-loop':bad[0]['services']['stack-migrate']['restart']='unless-stopped'
   else:bad[0]['volumes']={'changed':{}}
   with self.assertRaises(ValueError):r.baseline_model_checks(bad,inventory,models)
 def test_project_network_volume_and_secret_definitions_are_compared(self):
  models,_=self.fixture();self.assertEqual(r.project_resource_differences(models),[])
  for field in ['networks','volumes','secrets','configs']:
   altered=copy.deepcopy(models);altered[1][field]={'fixture':{'synthetic-private':'hidden'}}
   differences=r.project_resource_differences(altered)
   self.assertEqual(differences,[{'group':2,'changedFields':[field]}])
   self.assertNotIn('hidden',str(differences))
 def test_resource_field_differences_require_reconciliation(self):
  models,groups=self.fixture();service=groups[2]['services'][0]
  models[2]['services'][service]['mem_limit']=1073741824
  _,differences=r.compare_models(models,groups)
  self.assertEqual(differences[0]['changedFields'],['mem_limit'])

if __name__=='__main__':unittest.main()
