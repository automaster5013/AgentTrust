"""Boundary checks for online capture/owned restore; no operational Docker calls."""
import datetime,hashlib,importlib.util,json,pathlib,subprocess,tempfile,types,unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('online',pathlib.Path(__file__).with_name('stack-online-recovery.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class OnlineRecovery(unittest.TestCase):
 def test_windows_key_directory_removes_explicit_broad_aces_then_validates(self):
  with tempfile.TemporaryDirectory(dir=m.ROOT/'.local') as temporary:
   destination=pathlib.Path(temporary)/'owned-key'
   with patch.object(m.os,'name','nt'),patch.object(m.c,'run',return_value=subprocess.CompletedProcess([],0,b'fixture-owner\n',b'')) as command,patch('stack_backup_custody.windows_owner_only') as validate:
    m.protect(destination)
   self.assertTrue(any('/remove:g' in call.args[0] and '*S-1-5-32-544' in call.args[0] and '*S-1-3-4' in call.args[0] for call in command.call_args_list))
   validate.assert_called_once_with((destination,))
 def test_online_capture_only_allowlisted_databases_without_quiescence(self):
  for database in m.DATABASES:
   command=m.dump_command(database)
   self.assertEqual(command[:3],['docker','exec','agenttrust-stack-db-1'])
   self.assertIn('--lock-wait-timeout=5s',command);self.assertIn('-Fc',command)
   self.assertFalse({'stop','restart','pause','volume','--clean'}&set(command))
  for value in ('postgres','logitrack','agenttrust_stack; DROP DATABASE x',''):
   with self.assertRaises(ValueError):m.dump_command(value)
 def test_owned_restore_has_no_host_ports_or_source_volume(self):
  with tempfile.TemporaryDirectory(dir=m.ROOT/'.local') as temporary:
   root=pathlib.Path(temporary);drill=types.SimpleNamespace(prefix='agenttrust-stack-coldrestore-fixture',id='fixture',directory=root,private=[])
   for service in m.c.SERVICES:
    entry={'user':'70:70','memory':536870912,'cpus':1000000000,'pids':128,'tmpfs':{},'workingDirectory':'','files':[],
           'entrypoint':[],'command':[],'imageId':'sha256:'+'a'*64,'volumeDestination':'/fixture-data'}
    command=m.fixture_command(drill,service,entry,root/'fixture.env')
    self.assertNotIn('--publish',command);self.assertNotIn('-p',command);self.assertNotIn('--mount',command)
    self.assertIn('--read-only',command);self.assertIn('--log-driver',command)
    self.assertEqual(command[command.index('--network')+1],drill.prefix)
    if service in m.c.STATEFUL:self.assertIn('--tmpfs',command)
   with self.assertRaises(ValueError):m.fixture_command(drill,'api',entry,root/'fixture.env')
 def test_restore_sql_rejects_operating_and_foreign_targets(self):
  for target in ('agenttrust-stack-db-1','logitrack-db-1','agenttrust-stack-coldrestore-no-uuid-stack-db'):
   with self.assertRaises(ValueError):m.target_sql(target,'SELECT 1;')
 def test_partial_online_evidence_cannot_satisfy_operating_recovery_gate(self):
  proof={'completed':True,'kind':'online-independent-logical-development-recovery','businessCriticalDevelopmentRecoveryVerified':False,
         'fullStackRecoveryVerified':False,'operatingDatabaseLogicalRestoreVerified':True}
  with self.assertRaises(ValueError):m.e.recovery_binding(proof,{}, {},datetime.datetime.now(datetime.timezone.utc),24)
 def exercise_restore(self,fail=False):
  with tempfile.TemporaryDirectory(dir=m.ROOT/'.local') as temporary:
   identifier='6c3b6bfc-fc5e-4caf-b67a-8ccb30231efb';prefix='agenttrust-stack-coldrestore-'+identifier
   waits=[];commands=[];checks=[]
   drill=types.SimpleNamespace(prefix=prefix,id=identifier,directory=pathlib.Path(temporary),private=[],containers=[],network=False,wait=lambda name,service:waits.append(service))
   config={s:{'user':'70:70','memory':536870912,'cpus':1000000000,'pids':128,'tmpfs':{},'workingDirectory':'','files':[],
              'entrypoint':[],'command':[],'imageId':'sha256:'+'a'*64,'volumeDestination':'/fixture-data','env':['FIXTURE_ONLY=true']} for s in m.c.SERVICES}
   payload={'roles':b'-- fixture roles','businessFingerprints':{'table':'fingerprint'},**{db:b'PGDMP-fixture' for db in m.DATABASES}}
   def command(args,data=None,**kwargs):
    commands.append(args)
    if 'pg_restore' in args:
     self.assertEqual(args[3],prefix+'-stack-db');self.assertEqual(data,b'PGDMP-fixture')
     if fail:raise ValueError('simulated restore failure')
    if args[:3]==['docker','network','inspect']:return subprocess.CompletedProcess(args,0,json.dumps([{'Internal':True,'Containers':{str(i):{} for i in range(11)}}]).encode(),b'')
    return subprocess.CompletedProcess(args,0,b'',b'')
   def inspect(name):return {'Image':'sha256:'+'a'*64,'HostConfig':{'PortBindings':{}},'NetworkSettings':{'Networks':{prefix:{}}},'Mounts':[]}
   with patch.object(m.c,'run',side_effect=command),patch.object(m.c,'inspect',side_effect=inspect),patch.object(m.c,'fingerprint',return_value=payload['businessFingerprints']):
    if fail:
     with self.assertRaises(ValueError):m.restore(drill,config,payload,lambda:checks.append(True))
    else:m.restore(drill,config,payload,lambda:checks.append(True))
   if fail:self.assertFalse(waits)
   else:
    self.assertEqual(waits,list(m.c.SERVICES));self.assertEqual(len(checks),11)
    self.assertEqual(sum('pg_restore' in command for command in commands),2)
   self.assertFalse(any('agenttrust-stack-db-1' in command or any(x in command for x in ['stop','restart','pause','volume']) for command in commands))
 def test_complete_mocked_eleven_service_restore(self):self.exercise_restore()
 def test_restore_failure_never_starts_application_services(self):self.exercise_restore(True)
 def retained_fixture(self,change=None):
  crypto=m.load('online_test_crypto','stack-backup-crypt.py');key=b'k'*32
  with tempfile.TemporaryDirectory(dir=m.ROOT/'.local') as snapshot,tempfile.TemporaryDirectory(dir=m.ROOT/'.local') as keys:
   directory=pathlib.Path(snapshot);key_path=pathlib.Path(keys)/'key.bin';m.c.private_file(key_path,key)
   identifier='6c3b6bfc-fc5e-4caf-b67a-8ccb30231efb'
   bodies={'roles':b'-- fixture only','configuration':json.dumps({s:{'imageId':'sha256:'+'a'*64} for s in m.c.SERVICES}).encode(),
           'businessFingerprints':json.dumps({'fixture':{'rows':1,'sha256':'a'*64}}).encode(),**{db:b'PGDMP-fixture' for db in m.DATABASES}}
   if change in ('live','live-mismatch'):
    import io,tarfile,stack_live_state as live
    stream=io.BytesIO()
    with tarfile.open(fileobj=stream,mode='w:gz') as tar:
     entry=tarfile.TarInfo('fixture');entry.size=2;tar.addfile(entry,io.BytesIO(b'ok'))
    raw=stream.getvalue();fingerprints={name:m.c.archive_fingerprints(raw) for name in live.VOLUMES}
    if change=='live-mismatch':fingerprints['stack-nats']['fixture']['sha256']='0'*64
    bodies.update({name+'-live':raw for name in live.VOLUMES})
    bodies['liveStateMetadata']=json.dumps({'schemaVersion':1,'crossStoreSnapshotAtomic':False,'fileFingerprints':fingerprints,'queue':[{}],'objectReferences':[{}]}).encode()
   descriptors={}
   for name,body in bodies.items():
    raw=crypto.transform('encrypt',key,body);(directory/(name+'.aesgcm')).write_bytes(raw);descriptors[name]=m.component(raw)
   manifest={'schemaVersion':1,'kind':'online-independent-logical','snapshotId':identifier,'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
             'components':descriptors,'sourceImageIds':{s:'sha256:'+'a'*64 for s in m.c.SERVICES},'crossDatabaseSnapshotAtomic':False,'crossStoreSnapshotAtomic':False}
   if change in ('live','live-mismatch'):manifest['liveStateIncluded']=True
   if change=='claim':manifest['crossStoreSnapshotAtomic']=True
   encrypted=crypto.transform('encrypt',key,json.dumps(manifest).encode());(directory/'online-manifest.aesgcm').write_bytes(encrypted)
   if change=='key':key_path.write_bytes(b'x'*32)
   if change=='component':(directory/'roles.aesgcm').write_bytes(b'changed fixture')
   with patch.object(m.c,'retained_key',return_value=(key_path,hashlib.sha256(key_path.read_bytes()).digest())):
    return m.verify_retained(directory,key_path,hashlib.sha256(encrypted).hexdigest(),identifier)
 def test_retained_archive_authenticates_without_claiming_cross_store_recovery(self):
  proof=self.retained_fixture();self.assertTrue(proof['onlineLogicalArchiveAuthenticated']);self.assertFalse(proof['fullStackRecoveryVerified'])
 def test_wrong_key_and_tampered_component_refused(self):
  from cryptography.exceptions import InvalidTag
  for change,error in (('key',InvalidTag),('component',ValueError)):
   with self.subTest(change=change),self.assertRaises(error):self.retained_fixture(change)
 def test_false_atomicity_claim_refused(self):
  with self.assertRaises(ValueError):self.retained_fixture('claim')
 def test_extended_live_components_authenticated(self):self.assertEqual(self.retained_fixture('live')['liveStateArchivesAuthenticated'],3)
 def test_authenticated_manifest_cannot_hide_archive_fingerprint_mismatch(self):
  with self.assertRaises(ValueError):self.retained_fixture('live-mismatch')

if __name__=='__main__':unittest.main()
