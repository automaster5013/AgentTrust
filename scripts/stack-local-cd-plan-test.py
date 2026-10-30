import copy, importlib.util, pathlib, tempfile, unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('cd',pathlib.Path(__file__).with_name('stack-local-cd-plan.py'))
cd=importlib.util.module_from_spec(spec);spec.loader.exec_module(cd)
REV='a'*40;DIG='b'*64

def inventory_fixture():
 return [{'Name':'/agenttrust-'+name+'-1','Id':'c'*64,'Image':'sha256:'+DIG,
          'Config':{'Labels':{'com.docker.compose.project':'agenttrust','com.docker.compose.service':name,
                             'com.docker.compose.project.config_files':'C:\\AgentTrust\\compose.stack.yaml'}},
          'State':{'Running':True,'Health':{'Status':'healthy'}},
          'HostConfig':{'RestartPolicy':{'Name':'unless-stopped'}},'Mounts':[]}
         for name in sorted(set(cd.COMPONENTS)|cd.PRESERVED)]

def receipt_fixture():
 return {'schemaVersion':2,'publicationRun':{'repository':'automaster5013/AgentTrust','workflow':'.github/workflows/original-stack.yml','runId':1,'runAttempt':1},'revision':REV,'published':True,'destinationDigestsVerified':True,
         'sourceSignaturesVerifiedHere':True,'sourceChecksumsSha256':'c'*64,'serverDeployed':False,
         'images':[{'name':n,'source':'ghcr.io/automaster5013/agenttrust-'+n+'@sha256:'+DIG,
                    'reference':'docker.io/automaster5013/agenttrust-'+n+'@sha256:'+DIG,
                    'tag':'docker.io/automaster5013/agenttrust-'+n+':'+REV} for n in sorted(cd.ALL_IMAGES)]}

class PlanningTests(unittest.TestCase):
 def test_hot_updated_resources_and_security_policy_change_fingerprint(self):
  original=inventory_fixture();before=cd.summarize(original)
  for section,key,value in [('HostConfig','Memory',1073741824),('HostConfig','Privileged',True),
                            ('HostConfig','CapAdd',['SYS_ADMIN']),('HostConfig','PortBindings',{'8080/tcp':[{'HostPort':'9999'}]}),
                            ('Config','User','0'),('Config','Healthcheck',{'Test':['NONE']})]:
   changed=copy.deepcopy(original);changed[0][section][key]=value
   after=cd.summarize(changed);service=changed[0]['Config']['Labels']['com.docker.compose.service']
   self.assertNotEqual(before[service]['runtimePolicySha256'],after[service]['runtimePolicySha256'])
   self.assertEqual(before[service]['containerId'],after[service]['containerId'])
  self.assertNotIn('Env',str(before))
 def test_review_overrides_only_set_images_and_restart(self):
  inv=cd.summarize(inventory_fixture())
  plan=cd.receipt_plan(receipt_fixture(),REV,inv,'development')
  for override in [cd.candidate_override(plan,inv),cd.rollback_override(inv)]:
   self.assertEqual(set(override),{'services'})
   self.assertEqual(set(override['services']),set(cd.COMPONENTS))
   for service,value in override['services'].items():
    self.assertEqual(set(value),{'image','restart'})
    self.assertEqual(value['restart'],'unless-stopped')
  bad=copy.deepcopy(plan);bad[0]['service']='db'
  with self.assertRaises(ValueError):cd.candidate_override(bad,inv)
  bad=copy.deepcopy(plan);bad[0]['rollbackImageId']='sha256:'+'0'*64
  with self.assertRaises(ValueError):cd.candidate_override(bad,inv)
  with self.assertRaises(ValueError):cd.receipt_plan(receipt_fixture(),REV,inv,'typo')
 def test_per_service_override_order_is_preserved_without_union(self):
  inv=cd.summarize(inventory_fixture())
  inv['stack-console']['composeFiles']=['base','console-private']
  inv['stack-gateway']['composeFiles']=['console-private','base']
  groups=cd.runtime_file_groups(inv)
  self.assertEqual(len(groups),3)
  self.assertEqual(sorted(s for group in groups for s in group['services']),sorted(cd.COMPONENTS))
  console=next(group for group in groups if 'stack-console' in group['services'])
  self.assertEqual(console['filesInOrder'],['base','console-private'])
  self.assertNotIn('stack-gateway',console['services'])
 def test_running_id_membership_changes_refused_before_inspection(self):
  ids=tuple(format(i,'064x') for i in range(20))
  for current in [ids+('f'*64,),ids[:-1],ids[:-1]+('f'*64,),ids[:-1]+(ids[0],)]:
   with patch.object(cd,'docker',return_value='\n'.join(current)) as command:
    with self.assertRaises(ValueError):cd.recheck(ids,{},pathlib.Path.cwd(),{})
    self.assertEqual(command.call_count,1)
 def test_compose_hashes_reject_changed_files_and_oversized_config(self):
  with tempfile.TemporaryDirectory(dir=pathlib.Path(cd.__file__).parent.parent) as directory:
   root=pathlib.Path(directory).resolve();config=root/'private.compose.json';config.write_bytes(b'{}')
   inventory={'service':{'composeFiles':[str(config)]}}
   before=cd.compose_hashes(inventory,root);config.write_bytes(b'{ }')
   self.assertNotEqual(before,cd.compose_hashes(inventory,root))
   config.write_bytes(b'0'*1048577)
   with self.assertRaises(ValueError):cd.compose_hashes(inventory,root)
 def test_publication_origin_and_legacy_receipts_refused(self):
  inv=cd.summarize(inventory_fixture())
  for key,value in [('repository','other/AgentTrust'),('workflow','other.yml'),('runId',True),('runAttempt',0)]:
   bad=receipt_fixture();bad['publicationRun'][key]=value
   with self.assertRaises(ValueError):cd.receipt_plan(bad,REV,inv,'development')
  bad=receipt_fixture();bad['schemaVersion']=1
  with self.assertRaises(ValueError):cd.receipt_plan(bad,REV,inv,'development')
 def test_inventory_and_profile_selection(self):
  inv=cd.summarize(inventory_fixture());self.assertEqual(len(inv),20)
  for profile,component in [('development','console'),('https-review','console-https')]:
   rows=cd.receipt_plan(receipt_fixture(),REV,inv,profile)
   self.assertEqual(len(rows),15);self.assertFalse({r['service'] for r in rows}&cd.PRESERVED)
   self.assertIn('agenttrust-'+component+'@',next(r['candidate'] for r in rows if r['service']=='stack-console'))
 def test_foreign_duplicate_missing_and_unhealthy_inventory(self):
  cases=[]
  bad=inventory_fixture();bad[0]['Config']['Labels']['com.docker.compose.project']='logitrack';cases.append(bad)
  cases.extend([inventory_fixture()[:-1],inventory_fixture()+[inventory_fixture()[0]]])
  bad=inventory_fixture();bad[0]['State']['Health']['Status']='unhealthy';cases.append(bad)
  bad=inventory_fixture();bad[0]['HostConfig']['RestartPolicy']['Name']='no';cases.append(bad)
  for bad in cases:
   with self.assertRaises(ValueError):cd.summarize(bad)
 def test_unpublished_and_forged_target_receipts(self):
  inv=cd.summarize(inventory_fixture())
  for flag in ['published','destinationDigestsVerified','sourceSignaturesVerifiedHere']:
   bad=receipt_fixture();bad[flag]=False
   with self.assertRaises(ValueError):cd.receipt_plan(bad,REV,inv,'development')
  for field,value in [('reference','docker.io/other/agenttrust-core-api:latest'),('source','ghcr.io/other/image:main'),('tag','docker.io/automaster5013/image:main')]:
   bad=receipt_fixture();bad['images'][0][field]=value
   with self.assertRaises(ValueError):cd.receipt_plan(bad,REV,inv,'development')
 def test_incomplete_revision_and_duplicate_images(self):
  inv=cd.summarize(inventory_fixture())
  for rows in [receipt_fixture()['images'][:-1],receipt_fixture()['images'][:-1]+[receipt_fixture()['images'][0]]]:
   bad=receipt_fixture();bad['images']=rows
   with self.assertRaises(ValueError):cd.receipt_plan(bad,REV,inv,'development')
  with self.assertRaises(ValueError):cd.receipt_plan(receipt_fixture(),'d'*40,inv,'development')

if __name__=='__main__':unittest.main()
