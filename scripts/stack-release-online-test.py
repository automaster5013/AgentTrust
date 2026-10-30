"""Offline main-run and registry tampering controls. No external calls."""
import copy,hashlib,json,unittest,urllib.error
from stack_release_online import JOBS,MEDIA,validate_run,validate_publication_run,verify_release_runs,public_manifests,get
from unittest.mock import patch
REV='a'*40

def fixture():
 run={'id':1,'run_attempt':2,'head_sha':REV,'repository':{'full_name':'automaster5013/AgentTrust'},
      'head_repository':{'full_name':'automaster5013/AgentTrust'},'head_branch':'main','event':'push',
      'path':'.github/workflows/original-stack.yml','status':'completed','conclusion':'success'}
 jobs={'total_count':5,'jobs':[{'name':n,'run_id':1,'run_attempt':2,'status':'completed','conclusion':'success'} for n in JOBS]}
 return run,jobs

class OnlineTests(unittest.TestCase):
 def test_separate_main_source_and_owned_publisher_runs(self):
  source,jobs=fixture();jobs['jobs']=[j for j in jobs['jobs'] if j['name']!='Publish verified stack to Docker Hub'];jobs['total_count']=4
  self.assertTrue(validate_run(source,jobs,REV,1,2,JOBS-{'Publish verified stack to Docker Hub'})['trustedMainRunVerified'])
  with self.assertRaises(ValueError):validate_run(source,jobs,REV,1,2)
  published=copy.deepcopy(source);published.update(id=3,path='.github/workflows/dockerhub-main-mirror.yml',head_branch='codex/commercial-workspace-ux-20261026')
  pubjobs={'total_count':1,'jobs':[{'name':'publish','run_id':3,'run_attempt':2,'status':'completed','conclusion':'success'}]}
  self.assertTrue(validate_publication_run(published,pubjobs,REV,3,2)['publicationRunVerified'])
  for key,value in [('event','pull_request'),('head_branch','other'),('head_sha','b'*40),('path','other.yml')]:
   bad=copy.deepcopy(published);bad[key]=value
   with self.assertRaises(ValueError):validate_publication_run(bad,pubjobs,REV,3,2)
  config={'sourceRunId':1,'sourceRunAttempt':2,'runId':3,'runAttempt':2,'publicationRevision':REV}
  receipt={'schemaVersion':3,'sourceRun':{'runId':1,'runAttempt':2},'publicationRun':{'runId':3,'runAttempt':2}}
  with patch('stack_release_online.main_run',return_value={'trustedMainRunVerified':True}) as check_source,patch('stack_release_online.publication_run',return_value={'publicationRunVerified':True}) as check_pub:
   result=verify_release_runs(config,REV,receipt);self.assertTrue(result['publicationRunVerified'])
   self.assertEqual(check_source.call_args.kwargs['expected_jobs'],JOBS-{'Publish verified stack to Docker Hub'})
   bad=copy.deepcopy(receipt);bad['sourceRun']['runAttempt']=1
   with self.assertRaises(ValueError):verify_release_runs(config,REV,bad)
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
 def test_platform_manifest_binds_the_signed_config_image_id(self):
  names=['component-'+chr(ord('a')+i) for i in range(16)]
  config_id='sha256:'+'c'*64
  def fixture(ambiguous=False,wrong_config=False,corrupt_child=False):
   child=json.dumps({'schemaVersion':2,'mediaType':MEDIA[0],
                     'config':{'digest':'sha256:'+'d'*64 if wrong_config else config_id},'layers':[]}).encode()
   child_digest='sha256:'+hashlib.sha256(child).hexdigest()
   entry={'digest':child_digest,'platform':{'os':'linux','architecture':'amd64'}}
   top=json.dumps({'schemaVersion':2,'mediaType':MEDIA[1],
                   'manifests':[entry,entry] if ambiguous else [entry]}).encode()
   top_digest='sha256:'+hashlib.sha256(top).hexdigest()
   rows=[{'name':name,'reference':'docker.io/automaster5013/agenttrust-'+name+'@'+top_digest} for name in names]
   def fetch(url,headers=None,limit=1048576):
    if 'auth.docker.io' in url:return b'{"token":"fixture"}',{}
    expected=url.rsplit('/',1)[1]
    raw=top if expected==top_digest else child+(b' ' if corrupt_child else b'')
    return raw,{'Docker-Content-Digest':expected}
   return rows,fetch
  rows,fetch=fixture()
  result=public_manifests(rows,fetch,image_ids={name:config_id for name in names})
  self.assertTrue(result['destinationImageConfigDigestsVerified'])
  self.assertEqual(result['publicRegistryManifestsRead'],32)
  self.assertFalse(result['imageConfigBlobsDownloaded'])
  for kwargs in [{'ambiguous':True},{'wrong_config':True},{'corrupt_child':True}]:
   rows,fetch=fixture(**kwargs)
   with self.assertRaises(ValueError):public_manifests(rows,fetch,image_ids={name:config_id for name in names})
  rows,fetch=fixture()
  with self.assertRaises(ValueError):public_manifests(rows,fetch,image_ids={})
 def test_gateway_retry_is_bounded_and_does_not_bypass_auth(self):
  class Response:
   status=200;headers={}
   def __enter__(self):return self
   def __exit__(self,*args):pass
   def read(self,n):return b'{}'
  for code,expected in [(503,3),(403,1),(429,1)]:
   error=urllib.error.HTTPError('https://api.github.com/a',code,'fixture',{},None)
   with patch('stack_release_online.urllib.request.build_opener') as factory,patch('stack_release_online.time.sleep'):
    factory.return_value.open.side_effect=[error]*(expected-1)+[Response()] if code==503 else error
    if code==503:self.assertEqual(get('https://api.github.com/a')[0],b'{}')
    else:
     with self.assertRaises(urllib.error.HTTPError):get('https://api.github.com/a')
    self.assertEqual(factory.return_value.open.call_count,expected);error.close()
  with patch('stack_release_online.urllib.request.build_opener') as factory,patch('stack_release_online.time.sleep'):
   factory.return_value.open.side_effect=urllib.error.HTTPError('https://api.github.com/a',502,'fixture',{},None)
   with self.assertRaises(urllib.error.HTTPError):get('https://api.github.com/a')
   self.assertEqual(factory.return_value.open.call_count,3)
 def test_untrusted_network_destination_refused_before_request(self):
  for url in ['http://api.github.com/a','https://evil.example/a','https://token@api.github.com/a']:
   with self.assertRaises(ValueError):get(url)

if __name__=='__main__':unittest.main()
