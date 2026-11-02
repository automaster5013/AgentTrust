"""Offline stateless fixture command boundaries; does not start containers."""
import copy,importlib.util,pathlib,unittest,uuid
s=importlib.util.spec_from_file_location('rehearsal',pathlib.Path(__file__).with_name('stack-isolated-worker-rehearsal.py'))
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class FixtureTests(unittest.TestCase):
 def test_isolated_command_has_no_ports_mounts_or_operational_names(self):
  identifier=str(uuid.uuid4());cmd=m.fixture_command('docker.io/automaster5013/agenttrust-ai-worker@sha256:'+'b'*64,identifier)
  self.assertEqual(cmd[cmd.index('--network')+1],'none')
  self.assertEqual(cmd[cmd.index('--user')+1],'10001:10001')
  self.assertIn('--read-only',cmd);self.assertIn('--rm',cmd)
  self.assertFalse(set(cmd)&{'--mount','--volume','-v','--publish','-p','--privileged'})
  self.assertEqual(cmd[cmd.index('--name')+1],'agenttrust-cd-worker-fixture-'+identifier)
 def test_config_and_manifest_backed_stores_bind_same_signed_reference(self):
  reference='docker.io/automaster5013/agenttrust-ai-worker@sha256:'+'b'*64;config='sha256:'+'c'*64
  image={'Id':config,'RepoDigests':[reference.removeprefix('docker.io/')],'Os':'linux','Architecture':'amd64'}
  self.assertEqual(m.cached_identity(image,reference,config),'config-id')
  image.update(Id='sha256:'+'b'*64,Descriptor={'digest':'sha256:'+'b'*64,'mediaType':'application/vnd.docker.distribution.manifest.v2+json'})
  self.assertEqual(m.cached_identity(image,reference,config),'manifest-descriptor')
  for key,value in [('Id','sha256:'+'d'*64),('RepoDigests',[]),('Architecture','arm64'),('Descriptor',{'digest':'sha256:'+'d'*64})]:
   bad=copy.deepcopy(image);bad[key]=value
   with self.assertRaises(ValueError):m.cached_identity(bad,reference,config)
 def test_invalid_image_or_fixture_identity_is_refused(self):
  for image in ['other:latest','docker.io/automaster5013/agenttrust-ai-worker@sha256:bad']:
   with self.assertRaises(ValueError):m.fixture_command(image,str(uuid.uuid4()))
  with self.assertRaises(ValueError):m.fixture_command('sha256:'+'a'*64,'operational')
if __name__=='__main__':unittest.main()
