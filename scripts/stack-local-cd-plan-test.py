import copy, importlib.util, pathlib, unittest
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
