"""Known-file read-only copy contracts; no daemon or operating reads."""
import copy,datetime,hashlib,io,subprocess,tarfile,unittest
from types import SimpleNamespace as NS
from unittest.mock import Mock,patch
import stack_tempo_source_recheck as audit

PREFIXES=['blocks/tenant/00000000-0000-0000-0000-'+str(i).zfill(12) for i in (1,2)]
FILES={p+'/'+n:{'bytes':0,'sha256':hashlib.sha256(b'').hexdigest(),'mode':384} for p in PREFIXES for n in ('meta.json','data.parquet','index','bloom-0')}
SOURCE={'Id':'a'*64,'Image':'sha256:'+'b'*64,'Name':'/agenttrust-stack-tempo-1','Config':{'Labels':{'com.docker.compose.project':'agenttrust','com.docker.compose.service':'stack-tempo'}},'State':{'StartedAt':'2026-10-31T00:00:00Z','Running':True,'Health':{'Status':'healthy'}},'Mounts':[{'Destination':'/var/tempo','Type':'volume','Name':'agenttrust_stack-tempo-data'}]}
def archive(prefix,mutation=None):
 root=prefix.split('/')[-1];buf=io.BytesIO()
 with tarfile.open(fileobj=buf,mode='w') as tar:
  item=tarfile.TarInfo(root);item.type=tarfile.DIRTYPE;tar.addfile(item)
  for name in ('meta.json','data.parquet','index','bloom-0')+ (('extra',) if mutation=='extra' else ()):
   item=tarfile.TarInfo(root+'/'+name);item.mode=384
   if name=='meta.json':
    if mutation=='mode':item.mode=420
    if mutation in ('symlink','hardlink'):item.type=tarfile.SYMTYPE if mutation=='symlink' else tarfile.LNKTYPE;item.linkname='/outside'
    if mutation=='nonempty':item.size=1
    if mutation=='traversal':item.name=root+'/../meta.json'
   tar.addfile(item,io.BytesIO(b'x') if item.size else None)
 return buf.getvalue()
class Recheck(unittest.TestCase):
 def test_two_pass_known_files_only_never_promote_recovery(self):
  read=Mock(side_effect=lambda p:archive(p));result=audit.recheck(SOURCE,FILES,read,lambda _:copy.deepcopy(SOURCE))
  self.assertEqual(read.call_count,4);self.assertTrue(result['twoPassManifestEquality'])
  for field in ('crossFileSnapshotAtomic','fullSourceManifestRechecked','pathAndDestinationRechecked','newContainerStarted','sourceWritesPerformed','freshReaderExecuted','operatingTempoRecoveryVerified','automaticDeploymentAllowed'):self.assertFalse(result[field])
 def test_slow_first_copy_never_gets_a_new_fresh_timestamp(self):
  initial=datetime.datetime(2026,10,31,tzinfo=datetime.timezone.utc);elapsed=[0]
  def read(prefix):elapsed[0]=301;return archive(prefix)
  with patch.object(audit,'clock',side_effect=lambda:(initial+datetime.timedelta(seconds=elapsed[0]),elapsed[0])):
   with self.assertRaises(ValueError):audit.recheck(SOURCE,FILES,read,lambda _:copy.deepcopy(SOURCE))
 def test_clock_jump_is_inconclusive_even_when_files_match(self):
  initial=datetime.datetime(2026,10,31,tzinfo=datetime.timezone.utc)
  for jump in (-1,60):
   changed=[False]
   def read(prefix):changed[0]=True;return archive(prefix)
   with self.subTest(jump=jump),patch.object(audit,'clock',side_effect=lambda:(initial+datetime.timedelta(seconds=jump if changed[0] else 0),1 if changed[0] else 0)):
    with self.assertRaises(ValueError):audit.recheck(SOURCE,FILES,read,lambda _:copy.deepcopy(SOURCE))
 def test_expiry_is_bound_to_first_observation_not_completion(self):
  initial=datetime.datetime(2026,10,31,tzinfo=datetime.timezone.utc);elapsed=[0]
  def read(prefix):elapsed[0]+=10;return archive(prefix)
  with patch.object(audit,'clock',side_effect=lambda:(initial+datetime.timedelta(seconds=elapsed[0]),elapsed[0])):result=audit.recheck(SOURCE,FILES,read,lambda _:copy.deepcopy(SOURCE))
  self.assertEqual(result['observationDurationSeconds'],40);self.assertEqual(datetime.datetime.fromisoformat(result['observedAt']),initial+datetime.timedelta(seconds=40));self.assertEqual(datetime.datetime.fromisoformat(result['evidenceExpiresAt']),initial+datetime.timedelta(seconds=300))
 def test_drift_links_extra_bytes_and_escape_refuse(self):
  for mutation in ('mode','symlink','hardlink','extra','nonempty','traversal'):
   read=Mock(side_effect=lambda p:archive(p,mutation))
   with self.subTest(mutation=mutation),self.assertRaises(ValueError):audit.recheck(SOURCE,FILES,read,lambda _:copy.deepcopy(SOURCE))
 def test_second_pass_drift_is_not_a_fresh_receipt(self):
  reads=iter([archive(PREFIXES[0]),archive(PREFIXES[1]),archive(PREFIXES[0],'mode')])
  with self.assertRaises(ValueError):audit.recheck(SOURCE,FILES,lambda _:next(reads),lambda _:copy.deepcopy(SOURCE))
 def test_wrong_source_mount_or_health_precedes_copy(self):
  for field in ('volume','health'):
   source=copy.deepcopy(SOURCE)
   if field=='volume':source['Mounts'][0]['Name']='foreign'
   else:source['State']['Health']['Status']='unhealthy'
   read=Mock()
   with self.assertRaises(ValueError):audit.recheck(source,FILES,read,lambda _:copy.deepcopy(source))
   read.assert_not_called()
 def test_changed_identity_or_health_after_copy_refuses_receipt(self):
  for field in ('Id','Image','StartedAt','health'):
   changed=copy.deepcopy(SOURCE)
   if field in ('Id','Image'):changed[field]='c'*64 if field=='Id' else 'sha256:'+'c'*64
   elif field=='StartedAt':changed['State']['StartedAt']='2026-10-31T01:00:00Z'
   else:changed['State']['Health']['Status']='unhealthy'
   observations=Mock(side_effect=[copy.deepcopy(SOURCE),copy.deepcopy(SOURCE),changed])
   read=Mock(side_effect=lambda p:archive(p))
   with self.subTest(field=field),self.assertRaises(ValueError):audit.recheck(SOURCE,FILES,read,observations)
   self.assertEqual(read.call_count,1)
 def test_default_copy_uses_immutable_id_and_full_orchestration(self):
  with patch.object(audit,'copy_archive',side_effect=lambda container,p:archive(p)) as read:
   result=audit.recheck(SOURCE,FILES,observe=lambda _:copy.deepcopy(SOURCE))
  self.assertTrue(result['sourceIdentityBound']);self.assertTrue(result['sourceIdentityPreserved']);self.assertEqual(read.call_count,4)
  self.assertTrue(all(call.args[0]==SOURCE['Id'] for call in read.call_args_list))
 def test_copy_cli_address_is_id_not_reusable_name(self):
  proc=NS(returncode=0,stdout=io.BytesIO(archive(PREFIXES[0])),wait=Mock(return_value=0),poll=Mock(return_value=0),kill=Mock())
  with patch.object(audit.subprocess,'Popen',return_value=proc) as run:audit.copy_archive(SOURCE['Id'],PREFIXES[0])
  self.assertEqual(run.call_args.args[0][2],SOURCE['Id']+':/var/tempo/'+PREFIXES[0]);proc.kill.assert_not_called()
 def test_oversized_or_invalid_archive_refused(self):
  for raw in (b'',b'x'*(audit.LIMIT+1)):
   with self.assertRaises(ValueError):audit.archive_rows(raw,PREFIXES[0])
 def test_cli_timeout_kills_only_owned_copy_process(self):
  proc=NS(stdout=io.BytesIO(b''),wait=Mock(side_effect=[subprocess.TimeoutExpired('docker cp',20),-9]),poll=Mock(return_value=None),kill=Mock())
  with patch.object(audit.subprocess,'Popen',return_value=proc):
   with self.assertRaises(subprocess.TimeoutExpired):audit.copy_archive(SOURCE['Id'],PREFIXES[0])
  proc.kill.assert_called_once();self.assertTrue(proc.stdout.closed)
if __name__=='__main__':unittest.main()
