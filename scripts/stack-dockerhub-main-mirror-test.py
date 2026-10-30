"""Owned publisher context controls; never authenticate or publish in tests."""
import importlib.util,pathlib,unittest
spec=importlib.util.spec_from_file_location('mirror',pathlib.Path(__file__).with_name('stack-dockerhub-main-mirror.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class MirrorTests(unittest.TestCase):
 def test_context_rejects_foreign_workflow_pr_and_missing_attempt(self):
  env={'GITHUB_ACTIONS':'true','GITHUB_REPOSITORY':m.REPOSITORY,'GITHUB_REF':m.BRANCH,
       'GITHUB_WORKFLOW_REF':m.REPOSITORY+'/'+m.WORKFLOW+'@'+m.BRANCH,'GITHUB_EVENT_NAME':'push',
       'GITHUB_RUN_ID':'123','GITHUB_RUN_ATTEMPT':'1'}
  self.assertEqual(m.context(env)['runId'],123)
  for key,value in [('GITHUB_REPOSITORY','other/repo'),('GITHUB_REF','refs/heads/other'),
                    ('GITHUB_WORKFLOW_REF','other'),('GITHUB_EVENT_NAME','pull_request'),('GITHUB_RUN_ATTEMPT','0')]:
   with self.subTest(key=key),self.assertRaises(ValueError):m.context({**env,key:value})
 def test_source_revision_run_and_checksum_are_explicitly_pinned(self):
  self.assertEqual(m.SOURCE,'d40cdd063f7f711fdd513d231ec2da2473796619')
  self.assertEqual(m.SOURCE_RUN,40266953272)
  self.assertEqual(m.CHECKSUM,'36205e03707d098850b99d8fe64d20211b6c7eb134e81082fc4e46ecafc13519')

if __name__=='__main__':unittest.main()
