"""Offline group reconciliation controls; no live Compose or Docker calls."""
import copy,importlib.util,pathlib,unittest
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
