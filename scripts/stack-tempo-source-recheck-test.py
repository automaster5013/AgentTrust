"""Known-file read-only copy contracts; no daemon or operating reads."""
import copy,hashlib,io,subprocess,tarfile,unittest
from types import SimpleNamespace as NS
from unittest.mock import Mock,patch
import stack_tempo_source_recheck as audit

PREFIXES=['blocks/tenant/00000000-0000-0000-0000-'+str(i).zfill(12) for i in (1,2)]
FILES={p+'/'+n:{'bytes':0,'sha256':hashlib.sha256(b'').hexdigest(),'mode':384} for p in PREFIXES for n in ('meta.json','data.parquet','index','bloom-0')}
SOURCE={'Name':'/agenttrust-stack-tempo-1','Config':{'Labels':{'com.docker.compose.project':'agenttrust','com.docker.compose.service':'stack-tempo'}},'State':{'Running':True,'Health':{'Status':'healthy'}},'Mounts':[{'Destination':'/var/tempo','Type':'volume','Name':'agenttrust_stack-tempo-data'}]}
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
  read=Mock(side_effect=lambda p:archive(p));result=audit.recheck(SOURCE,FILES,read)
  self.assertEqual(read.call_count,4);self.assertTrue(result['twoPassManifestEquality'])
  for field in ('crossFileSnapshotAtomic','fullSourceManifestRechecked','pathAndDestinationRechecked','newContainerStarted','sourceWritesPerformed','freshReaderExecuted','operatingTempoRecoveryVerified','automaticDeploymentAllowed'):self.assertFalse(result[field])
 def test_drift_links_extra_bytes_and_escape_refuse(self):
  for mutation in ('mode','symlink','hardlink','extra','nonempty','traversal'):
   read=Mock(side_effect=lambda p:archive(p,mutation))
   with self.subTest(mutation=mutation),self.assertRaises(ValueError):audit.recheck(SOURCE,FILES,read)
 def test_second_pass_drift_is_not_a_fresh_receipt(self):
  reads=iter([archive(PREFIXES[0]),archive(PREFIXES[1]),archive(PREFIXES[0],'mode')])
  with self.assertRaises(ValueError):audit.recheck(SOURCE,FILES,lambda _:next(reads))
 def test_wrong_source_mount_or_health_precedes_copy(self):
  for field in ('volume','health'):
   source=copy.deepcopy(SOURCE)
   if field=='volume':source['Mounts'][0]['Name']='foreign'
   else:source['State']['Health']['Status']='unhealthy'
   read=Mock()
   with self.assertRaises(ValueError):audit.recheck(source,FILES,read)
   read.assert_not_called()
 def test_oversized_or_invalid_archive_refused(self):
  for raw in (b'',b'x'*(audit.LIMIT+1)):
   with self.assertRaises(ValueError):audit.archive_rows(raw,PREFIXES[0])
 def test_cli_timeout_kills_only_owned_copy_process(self):
  proc=NS(stdout=io.BytesIO(b''),wait=Mock(side_effect=[subprocess.TimeoutExpired('docker cp',20),-9]),poll=Mock(return_value=None),kill=Mock())
  with patch.object(audit.subprocess,'Popen',return_value=proc):
   with self.assertRaises(subprocess.TimeoutExpired):audit.copy_archive(PREFIXES[0])
  proc.kill.assert_called_once();self.assertTrue(proc.stdout.closed)
if __name__=='__main__':unittest.main()
