"""Owned tmpfs-only database fixture boundaries; never start a database in tests."""
import importlib.util,pathlib,unittest,uuid
from unittest.mock import patch
s=importlib.util.spec_from_file_location('db_fixture',pathlib.Path(__file__).with_name('stack-isolated-database-rehearsal.py'))
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class DatabaseFixtureTests(unittest.TestCase):
 def test_command_cannot_attach_operational_ports_or_volumes(self):
  identifier=str(uuid.uuid4());name='agenttrust-cd-db-'+identifier+'-source'
  command=m.fixture_command('docker.io/automaster5013/agenttrust-database@sha256:'+'b'*64,name,identifier)
  self.assertEqual(command[command.index('--network')+1],'none');self.assertIn('--rm',command)
  self.assertFalse(set(command)&{'--mount','-v','--volume','-p','--publish','--privileged'})
  self.assertEqual(command[command.index('--user')+1],'70:70')
  self.assertEqual(command.count('--tmpfs'),3)
 def test_existing_operational_name_is_never_an_allowed_fixture(self):
  identifier=str(uuid.uuid4());reference='docker.io/automaster5013/agenttrust-database@sha256:'+'b'*64
  with self.assertRaises(ValueError):m.fixture_command(reference,'agenttrust-stack-db-1',identifier)
  with patch.object(m,'run') as run:
   with self.assertRaises(ValueError):m.sql('agenttrust-stack-db-1','SELECT 1')
   run.assert_not_called()
 def test_isolation_requires_no_persistent_mounts(self):
  identifier=str(uuid.uuid4());row={'Config':{'Labels':{'agenttrust.fixture':identifier},'User':'70:70'},'HostConfig':{'NetworkMode':'none','PortBindings':{},'ReadonlyRootfs':True},'Mounts':[]}
  m.isolation(row,identifier)
  row['Mounts']=[{'Type':'volume','Name':'operational'}]
  with self.assertRaises(ValueError):m.isolation(row,identifier)
if __name__=='__main__':unittest.main()
