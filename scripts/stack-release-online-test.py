"""Offline main-run and registry tampering controls. No external calls."""
import copy,hashlib,json,unittest
from stack_release_online import JOBS,MEDIA,validate_run,public_manifests,get
REV='a'*40

def fixture():
 run={'id':1,'run_attempt':2,'head_sha':REV,'repository':{'full_name':'automaster5013/AgentTrust'},
      'head_repository':{'full_name':'automaster5013/AgentTrust'},'head_branch':'main','event':'push',
      'path':'.github/workflows/original-stack.yml','status':'completed','conclusion':'success'}
 jobs={'total_count':5,'jobs':[{'name':n,'run_id':1,'run_attempt':2,'status':'completed','conclusion':'success'} for n in JOBS]}
 return run,jobs

class OnlineTests(unittest.TestCase):
 def test_main_identity_attempt_and_all_jobs(self):
  run,jobs=fixture();self.assertTrue(validate_run(run,jobs,REV,1,2)['trustedMainRunVerified'])
  for key,value in [('head_branch','feature'),('event','pull_request'),('run_attempt',1),('head_sha','b'*40),('conclusion','failure'),('path','.github/workflows/other.yml')]:
   bad=copy.deepcopy(run);bad[key]=value
   with self.assertRaises(ValueError):validate_run(bad,jobs,REV,1,2)
  for key,value in [('conclusion','skipped'),('run_attempt',1),('run_id',3)]:
   bad=copy.deepcopy(jobs);bad['jobs'][0][key]=value
   with self.assertRaises(ValueError):validate_run(run,bad,REV,1,2)
 def test_missing_duplicate_or_extra_jobs_refused(self):
  run,jobs=fixture()
  for rows in [jobs['jobs'][:-1],jobs['jobs']+[jobs['jobs'][0]],jobs['jobs'][:-1]+[jobs['jobs'][0]]]:
   bad={'total_count':len(rows),'jobs':rows}
   with self.assertRaises(ValueError):validate_run(run,bad,REV,1,2)
 def test_manifest_bytes_header_and_media(self):
  raw=json.dumps({'schemaVersion':2,'mediaType':MEDIA[0],'config':{},'layers':[]}).encode()
  digest='sha256:'+hashlib.sha256(raw).hexdigest()
  names=['component-'+chr(ord('a')+i) for i in range(16)]
  rows=[{'name':name,'reference':'docker.io/automaster5013/agenttrust-'+name+'@'+digest} for name in names]
  calls=[]
  def fetch(url,headers=None,limit=1048576):
   calls.append(url)
   if 'auth.docker.io' in url:return b'{"token":"fixture"}',{}
   return raw,{'Docker-Content-Digest':digest}
  self.assertEqual(public_manifests(rows,fetch)['publicRegistryManifestsRead'],16)
  self.assertEqual(len(calls),32);self.assertFalse(any('/blobs/' in url for url in calls))
  for changed,header in [(raw+b' ',digest),(raw,'sha256:'+'0'*64)]:
   def corrupt(url,headers=None,limit=1048576):
    if 'auth.docker.io' in url:return b'{"token":"fixture"}',{}
    return changed,{'Docker-Content-Digest':header}
   with self.assertRaises(ValueError):public_manifests(rows,corrupt)
  bad=copy.deepcopy(rows);bad[0]['reference']='docker.io/other/image@'+digest
  with self.assertRaises(ValueError):public_manifests(bad,fetch)
 def test_untrusted_network_destination_refused_before_request(self):
  for url in ['http://api.github.com/a','https://evil.example/a','https://token@api.github.com/a']:
   with self.assertRaises(ValueError):get(url)

if __name__=='__main__':unittest.main()
