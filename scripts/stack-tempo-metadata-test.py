"""Metadata controls refuse source mutation and distinguish corrupt/ordinary 404s."""
import contextlib,datetime,hashlib,importlib.util,json,pathlib,tempfile,unittest
from types import SimpleNamespace as NS
from unittest.mock import Mock,patch
ROOT=pathlib.Path(__file__).resolve().parent.parent
def module(name,file):
 spec=importlib.util.spec_from_file_location(name,ROOT/'scripts'/file);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
helper=module('metadata_volume','stack-file-volume-helper.py');control=module('metadata_rehearsal','stack-tempo-metadata-rehearsal.py')
PREFIX='blocks/tenant/00000000-0000-0000-0000-000000000001'

class MetadataControl(unittest.TestCase):
 def test_quarantine_preserves_bytes_and_requires_empty_metadata(self):
  with tempfile.TemporaryDirectory(dir=ROOT) as tmp,patch.object(helper,'ROOT',pathlib.Path(tmp)):
   root=pathlib.Path(tmp);path=root/PREFIX;path.mkdir(parents=True);(path/'meta.json').write_bytes(b'');(path/'data.parquet').write_bytes(b'original bytes')
   self.assertEqual(helper.quarantine_block(PREFIX),{'quarantined':True,'bytesDeleted':False});self.assertFalse(path.exists());self.assertEqual((root/'quarantine'/PREFIX/'data.parquet').read_bytes(),b'original bytes')
   path.mkdir(parents=True);(path/'meta.json').write_bytes(b'{}')
   with self.assertRaises(ValueError):helper.quarantine_block(PREFIX)
   (path/'meta.json').write_bytes(b'')
   with self.assertRaises(ValueError):helper.quarantine_block(PREFIX)
   self.assertTrue(path.exists())
 def test_inverse_move_is_no_clobber_and_preserves_bytes(self):
  with tempfile.TemporaryDirectory(dir=ROOT) as tmp,patch.object(helper,'ROOT',pathlib.Path(tmp)):
   root=pathlib.Path(tmp);path=root/PREFIX;path.mkdir(parents=True);(path/'meta.json').write_bytes(b'');(path/'data').write_bytes(b'preserve')
   helper.quarantine_block(PREFIX);path.mkdir()
   with self.assertRaises(ValueError):helper.restore_quarantined_block(PREFIX)
   path.rmdir();self.assertTrue(helper.restore_quarantined_block(PREFIX)['restored']);self.assertEqual((path/'data').read_bytes(),b'preserve')
 def test_hot_observation_rejects_changed_started_at(self):
  with patch.object(control,'hot_identity',side_effect=[('id','image','one'),('id','image','two')]):
   with self.assertRaises(ValueError):control.observe_hot(None,'fixture',lambda:None,lambda:True)
 def test_hot_timeout_does_not_restart_or_inverse_automatically(self):
  with patch.object(control,'hot_identity',return_value=('id','image','started')),patch.object(control.time,'monotonic',side_effect=[0,901]),patch.object(control.time,'sleep') as sleep,patch.object(control.m.c,'run') as run:
   with self.assertRaises(ValueError):control.observe_hot(None,'fixture',lambda:None,lambda:False)
   sleep.assert_not_called();run.assert_not_called()
 def test_inverse_source_volume_refused(self):
  drill=NS(source_volume='operating',target_volume='owned',own_volume=Mock())
  with self.assertRaises(ValueError):control.cache.file_command(drill,'operating','restore-quarantined-block',PREFIX)
  with self.assertRaises(ValueError):control.inverse_owned(drill,'operating',PREFIX,{})
  drill.own_volume.assert_not_called()
 def test_sustained_host_refusal_precedes_all_docker_or_source_observation(self):
  with patch.object(control,'require_sustained_host_capacity',side_effect=ValueError('fixture reserve drop')),patch.object(control.m,'session_capacity') as capacity,patch.object(control.m.c,'run') as command,patch.object(control,'protected_logitrack') as protected:
   with self.assertRaises(ValueError):control.run({})
   capacity.assert_not_called();command.assert_not_called();protected.assert_not_called()
 def test_quarantine_source_volume_is_refused_before_tool_call(self):
  drill=NS(source_volume='operating',target_volume='owned',own_volume=Mock())
  with self.assertRaises(ValueError):control.cache.file_command(drill,'operating','quarantine-block',PREFIX)
  with self.assertRaises(ValueError):control.quarantine_owned(drill,'operating',PREFIX,{})
  drill.own_volume.assert_not_called()
 def test_only_registered_owned_fixture_can_be_stopped(self):
  drill=NS(prefix='agenttrust-stack-coldrestore-fixture',id='fixture',containers=['agenttrust-stack-coldrestore-fixture-stack-tempo'])
  with patch.object(control.m.c,'inspect') as inspect,patch.object(control.m.c,'run') as run:
   with self.assertRaises(ValueError):control.stop_owned(drill,'agenttrust-stack-tempo-1')
   inspect.assert_not_called();run.assert_not_called()
   inspect.return_value={'Config':{'Labels':{'agenttrust.fixture':'wrong'}}}
   with self.assertRaises(ValueError):control.stop_owned(drill,drill.containers[0])
   run.assert_not_called()
 def test_stale_owned_data_prevents_quarantine(self):
  drill=NS(source_volume='operating',target_volume='owned',own_volume=Mock())
  with patch.object(control.cache,'file_command',return_value=['safe-inventory']),patch.object(control.m.c,'run',return_value=NS(stdout=b'{}')) as command:
   with self.assertRaises(ValueError):control.quarantine_owned(drill,'owned',PREFIX,{'expected':{}})
   self.assertEqual(command.call_count,1)
 def test_positive_negative_recovery_must_all_be_present(self):
  before={'trace':('a'*64,3)};negative={'statusCode':404,'ready':True,'truncatedJsonErrors':1};proof=control.verdict(before,negative,before)
  self.assertTrue(proof['ownedCopyQuarantineRecoveryVerified']);self.assertFalse(proof['automaticDeploymentAllowed']);self.assertFalse(proof['operatingMetadataRepaired'])
  for bad in [dict(negative,statusCode=503),dict(negative,truncatedJsonErrors=0),dict(negative,ready=False)]:
   with self.assertRaises(ValueError):control.verdict(before,bad,before)
  for after in ({},{'trace':('b'*64,3)}):
   with self.assertRaises(ValueError):control.verdict(before,negative,after)
 def test_protected_logitrack_must_have_twelve_healthy_original_identities(self):
  ids=[format(i,'064x') for i in range(1,13)];rows=[{'Id':value,'Image':'sha256:'+'a'*64,'Config':{'Labels':{'com.docker.compose.project':'logitrack'}},'State':{'Running':True,'Health':{'Status':'healthy'}}} for value in ids]
  with patch.object(control.m.c,'run',return_value=NS(stdout=__import__('json').dumps(rows).encode())):
   self.assertEqual(len(control.protected_logitrack(ids)),12)
  rows[0]['State']['Health']['Status']='unhealthy'
  with patch.object(control.m.c,'run',return_value=NS(stdout=__import__('json').dumps(rows).encode())):
   with self.assertRaises(ValueError):control.protected_logitrack(ids)
  with patch.object(control.m.c,'run') as run:
   with self.assertRaises(ValueError):control.protected_logitrack(ids[:11])
   run.assert_not_called()
 def test_block_paths_cannot_escape_or_target_wal(self):
  for path in ('../blocks/tenant/escape','wal/tenant/00000000-0000-0000-0000-000000000001','blocks/tenant/invalid','blocks/tenant//00000000-0000-0000-0000-000000000001'):
   with self.assertRaises(ValueError):control.block_prefix(path)


class FullControlPath(unittest.TestCase):
 def exercise(self,missing_failure=False,changed_recovery=False,launch_failure=False,hot=False,inverse_failure=False,retained=False,masked_reset=False,capacity_failure=False,protected_failure=False,other_growth=False):
  m=control.m;source_volume='agenttrust_stack-tempo-data';fixture='00000000-0000-0000-0000-000000000099';blocks=['blocks/tenant/00000000-0000-0000-0000-'+str(i).zfill(12) for i in (10,11,12)]
  original={blocks[0]+'/meta.json':b'{}',blocks[0]+'/data.parquet':b'valid original spans'}
  for prefix in blocks[1:]:original.update({prefix+'/meta.json':b'',prefix+'/data.parquet':b'preserved affected bytes'})
  volumes={source_volume:dict(original)};containers={};calls=[];drills=[];inverse_restored=[False];source_checked=[False]
  def rows(data,prefix=None):return {k:{'bytes':len(v),'mode':384,'sha256':hashlib.sha256(v).hexdigest()} for k,v in data.items() if prefix is None or k.startswith(prefix+'/')}
  def answer(v=b''):return NS(stdout=json.dumps(v).encode() if not isinstance(v,bytes) else v,stderr=b'',returncode=0)
  def command(args,**kwargs):
   calls.append(args)
   if args[:3]==['docker','volume','inspect']:return answer([{'Labels':{'com.docker.compose.project':'agenttrust','com.docker.compose.volume':'stack-tempo-data'}}])
   if args[:3]==['docker','volume','create']:volumes[args[-1]]={};return answer()
   if args[:3]==['docker','image','inspect']:return answer([{'Id':'sha256:'+'c'*64}])
   if args[:3]==['docker','run','-d']:
    name=args[args.index('--name')+1];volume=next(v for v in args if v.startswith('type=volume,source=')).split('source=')[1].split(',')[0]
    if launch_failure and name.endswith('-stack-tempo') and not name.endswith('-original-stack-tempo'):return NS(stdout=b'',stderr=b'logging driver validation failed',returncode=1)
    containers[name]={'Id':'d'*64,'RestartCount':0,'State':{'Running':True,'OOMKilled':False,'StartedAt':'fixture-start'},'Image':args[-3],'HostConfig':{'NetworkMode':'none','PortBindings':None},'Config':{'Labels':{'agenttrust.fixture':fixture}},'volume':volume};return answer()
   if args[:3]==['docker','rm','-f']:containers.pop(args[-1]);return answer()
   if args[:2]==['docker','logs']:return answer(b'fixture: unexpected end of JSON input')
   if '/helper.py' in args:
    volume=next(v for v in args if v.startswith('type=volume,source=')).split('source=')[1].split(',')[0];data=volumes[volume]
    if 'inventory' in args:return answer(rows(data,args[args.index('--prefix')+1] if '--prefix' in args else None))
    path=args[args.index('--path')+1];offset=int(args[args.index('--offset')+1]);size=int(args[args.index('--size')+1])
    if 'read' in args:return answer(data[path][offset:offset+size])
    assert volume!=source_volume
    if 'write' in args:
     assert len(data.get(path,b''))==offset;data[path]=data.get(path,b'')+kwargs['data'];return answer()
    if 'finalize' in args:assert len(data[path])==offset;return answer()
    if 'restore-quarantined-block' in args:
     inverse_restored[0]=True
     moved={k:v for k,v in data.items() if k.startswith('quarantine/'+path+'/')}
     for key,value in moved.items():del data[key];data[key.removeprefix('quarantine/')]=value
     return answer({'restored':True,'bytesDeleted':False})
    if 'quarantine-block' in args:
     moved={k:v for k,v in data.items() if k.startswith(path+'/')}
     for key,value in moved.items():del data[key];data['quarantine/'+key]=value
     return answer({'quarantined':True,'bytesDeleted':False})
   return answer()
  def capacity(*args):
   if capacity_failure and source_checked[0]:
    error=ValueError('Synthetic host reserve exhausted');error.capacity_failure={'hostMemoryAvailableMiB':1016,'hostMemoryRequiredMiB':1024};raise error
  def recheck(*args):
   if protected_failure and source_checked[0]:raise ValueError('Synthetic source identity change')
  original_observe=control.observe_hot
  def observe(drill,name,checkpoint,condition,timeout=900):
   if other_growth and condition.__name__=='corrupt_again':
    assert condition() is None
    raise ValueError('Synthetic unrelated tenant growth is inconclusive')
   if inverse_failure and condition.__name__=='corrupt_again':raise ValueError('synthetic inverse observation timeout')
   return original_observe(drill,name,checkpoint,condition,timeout)
  def api(name,path):
   if name=='agenttrust-stack-tempo-1':
    source_checked[0]=True
    error=ValueError('fixture source 404');error.read_failure={'statusCode':404};raise error
   data=volumes[containers[name]['volume']];bad=any(k.startswith('blocks/') and k.endswith('/meta.json') and not v for k,v in data.items())
   if path=='/metrics' and other_growth:return {'metrics':'tempodb_blocklist_tenant_index_errors_total{tenant="tenant"} 1\ntempodb_blocklist_tenant_index_errors_total{tenant="other"} '+str(2 if inverse_restored[0] else 1)+'\ntempodb_blocklist_poll_duration_seconds_count 2\n'}
   if path=='/metrics' and masked_reset:return {'metrics':'tempodb_blocklist_tenant_index_errors_total{tenant="a"} '+str(0 if inverse_restored[0] else 5)+'\ntempodb_blocklist_tenant_index_errors_total{tenant="b"} '+str(8 if inverse_restored[0] else 1)+'\ntempodb_blocklist_poll_duration_seconds_count 2\n'}
   if path=='/metrics':return {'metrics':'tempodb_blocklist_tenant_index_errors_total{tenant="tenant"} '+str(2 if inverse_restored[0] else 1)+'\ntempodb_blocklist_poll_duration_seconds_count 2\n'}
   if bad and not missing_failure and not (retained and inverse_restored[0]):
    error=ValueError('fixture corrupt 404');error.read_failure={'statusCode':404};raise error
   if path.startswith('/api/search?'):return {'traces':[{'traceID':'f'*32}]}
   changed=changed_recovery and any(k.startswith('quarantine/') for k in data)
   return {'batches':[{'resource':{},'scopeSpans':[{'spans':[{'spanId':'one','name':'changed' if changed else 'same'}]}]}]}
  with tempfile.TemporaryDirectory(dir=ROOT) as tmp,contextlib.ExitStack() as stack:
   root=pathlib.Path(tmp);local=root/'.local';baseline=local/'baseline';audit_dir=local/'audit';release_dir=local/'release'
   for path in (baseline,audit_dir,release_dir,local/'baseline-key',local/'audit-key'):path.mkdir(parents=True,exist_ok=True)
   for path in (local/'baseline-key/key.bin',local/'audit-key/key.bin'):path.write_bytes(b'0'*32)
   good=rows({k:v for k,v in original.items() if k.startswith(blocks[0]+'/')});manifest=control.chunks.capture(good,lambda name,offset,size:original[name][offset:offset+size],lambda raw:raw,lambda name,raw:(baseline/name).write_bytes(raw))
   reference='docker.io/automaster5013/agenttrust-tempo@sha256:'+'b'*64;manifest.update(component='tempo-closed-block-selection',sourceImageId='sha256:'+'a'*64,candidateRevision='a'*40,candidateReference=reference,selected=[{'prefix':blocks[0],'start':1000,'end':2000}]);raw=json.dumps(manifest).encode();(baseline/'blocks-manifest.aesgcm').write_bytes(raw)
   common={'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'completed':True,'operationalContainersUnchanged':True,'ownFixtureAndTemporarySecretsCleaned':True}
   base_report={**common,'retainedKeyDirectory':str(local/'baseline-key'),'encryptedManifestSha256':hashlib.sha256(raw).hexdigest()}
   invalid=[{'path':v+'/meta.json','category':'empty-json','bytes':0,'sha256':hashlib.sha256(b'').hexdigest()} for v in blocks[1:]];raw=json.dumps({'invalid':invalid,'oversizedNotValidated':0,'volatileNotValidated':0}).encode();(audit_dir/'metadata-audit.aesgcm').write_bytes(raw)
   audit_report={**common,'retainedKeyDirectory':str(local/'audit-key'),'encryptedAuditSha256':hashlib.sha256(raw).hexdigest()}
   config={'hotPolling':hot}
   for key,path,value in [('baselineSummary',baseline/'summary.json',base_report),('auditSummary',audit_dir/'summary.json',audit_report),('candidateConfig',local/'candidate.json',{'revision':'a'*40})]:
    raw=json.dumps(value).encode();path.write_bytes(raw);config[key]=str(path);config[key+'Sha256']=hashlib.sha256(raw).hexdigest()
   (release_dir/'runtime-identity.json').write_text(json.dumps({'imageIds':{'tempo':'sha256:'+'c'*64}}));settings=root/'tempo.yaml';settings.write_bytes(b'fixture: source config')
   source={'Image':'sha256:'+'a'*64,'Config':{'User':'10001:10001'},'Mounts':[{'Type':'volume','Name':source_volume},{'Type':'bind','Destination':'/etc/tempo.yaml','Source':str(settings)}]}
   class Drill:
    def __init__(self,sources):
     self.id=fixture;self.prefix='agenttrust-stack-coldrestore-'+fixture;self.directory=local/'proof';self.directory.mkdir();self.volumes=[];self.containers=[];self.private=[];self.report={};drills.append(self)
    def stage(self,name):self.report['stage']=name
    def own_volume(self,volume):assert volume in volumes and volume!=source_volume and volume.startswith(self.prefix+'-')
    def volume_command(self,*args,**kwargs):pass
    def wait(self,*args):pass
    def cleanup(self):containers.clear();self.report['cleaned']=True
   patches=[(control,'require_sustained_host_capacity',lambda:{'hostSustainedMemoryVerified':True}),(control,'observe_hot',observe),(control,'protected_logitrack',lambda *a:tuple((format(i,'064x'),'sha256:'+'a'*64) for i in range(1,13))),(control,'ROOT',root),(m,'session_capacity',capacity),(m.d,'live_baseline',lambda:(['source'],{}, {},{'stack-tempo':source})),(m.d,'resolved_groups',lambda *a:({},{})),(m.d,'hash_files',lambda *a:{}),(m.e.planner,'compose_hashes',lambda *a:{}),(m.e.planner,'recheck',recheck),(m.e,'verify_candidate_release',lambda *a:{'directory':release_dir,'receipt':{'images':[{'name':'tempo','reference':reference}]}}),(m.c,'reserve',lambda:None),(m.c,'run',command),(m.c,'inspect',lambda name:containers[name]),(m.c,'Rehearsal',Drill),(m.c,'private_file',lambda path,raw:path.write_bytes(raw)),(m.c,'retained_key',lambda root,path:(path,'unchanged')),(m.c,'key_unchanged',lambda *a:True),(m,'protect',lambda path:path.mkdir(parents=True)),(m,'load',lambda *a:NS(transform=lambda action,key,raw:raw)),(m,'cached_identity',lambda *a:None),(control.tempo,'get',api)]
   for obj,name,value in patches:stack.enter_context(patch.object(obj,name,value))
   drill=control.run(config);self.assertTrue(drill.report['cleaned']);self.assertEqual(volumes[source_volume],original);self.assertFalse(containers)
   self.assertEqual(drill.report['completed'],not(missing_failure or changed_recovery or launch_failure or inverse_failure or masked_reset or capacity_failure or protected_failure or other_growth));self.assertFalse(drill.report['automaticDeploymentAllowed']);self.assertFalse(drill.report['operatingMetadataRepaired'])
   if launch_failure:self.assertEqual(drill.report['fixtureStartErrorCategory'],'logging');self.assertIn('encryptedStartErrorSha256',drill.report)
   if drill.report['completed']:self.assertTrue(drill.report['metadataFailureReproduced']);self.assertEqual(drill.report['matchingTraces'],1);self.assertEqual(drill.report['quarantinedOwnedBlocks'],2)
   if capacity_failure:
    self.assertTrue(drill.report['operationalContainersUnchanged']);self.assertFalse(drill.report['finalCapacityCheckPassed']);self.assertEqual(drill.report['finalCapacityFailure']['hostMemoryAvailableMiB'],1016)
   if protected_failure:
    self.assertFalse(drill.report['operationalContainersUnchanged']);self.assertTrue(drill.report['finalCapacityCheckPassed'])
   if other_growth:self.assertEqual(drill.report['errorType'],'ValueError')
   if inverse_failure or masked_reset or other_growth:
    self.assertTrue(drill.report['restartFreeApplyVerified']);self.assertFalse(drill.report['restartFreeRollbackVerified']);self.assertTrue(drill.report['inverseNamespaceFilesVerified']);self.assertIn('encryptedHotRecoveryPhaseSha256',drill.report)
   if retained and drill.report['completed']:
    private=json.loads((drill.directory/'comparison-evidence.aesgcm').read_bytes());self.assertIn('series',private['inverseMetricSamples']['before']);self.assertIn('series',private['inverseMetricSamples']['after']);self.assertNotIn('series',json.dumps(drill.report))
   if hot and drill.report['completed']:
    self.assertTrue(drill.report['restartFreeApplyVerified']);self.assertFalse(drill.report['restartFreeRollbackVerified']);self.assertTrue(drill.report['restartFreeNamespaceInverseVerified']);self.assertFalse(drill.report['healthyRollbackGuaranteed']);self.assertFalse(drill.report['automaticDeploymentAllowed']);self.assertEqual(drill.report['inverseReproducedKnown404'],not retained);self.assertEqual(drill.report['retainedGoodBlocklistObserved'],retained)
   starts=[v for v in calls if v[:3]==['docker','run','-d']]
   self.assertEqual(len(starts),2 if hot or missing_failure or launch_failure else 3)
   first_candidate=next(i for i,v in enumerate(calls) if v[:3]==['docker','run','-d'] and v[v.index('--name')+1].endswith('-stack-tempo') and not v[v.index('--name')+1].endswith('-original-stack-tempo'))
   original_stopped=next(i for i,v in enumerate(calls) if v[:3]==['docker','rm','-f'] and v[-1].endswith('-original-stack-tempo'));self.assertLess(original_stopped,first_candidate)
   for args in starts:
    self.assertEqual(args[args.index('--network')+1],'none');self.assertNotIn('-p',args)
    if args[args.index('--log-driver')+1]=='local':self.assertIn('max-file=2',args);self.assertIn('max-size=1m',args)
 def test_inverse_timeout_preserves_authenticated_recovery_phase(self):self.exercise(hot=True,inverse_failure=True)
 def test_full_warm_inverse_rejects_other_tenant_only_errors(self):self.exercise(hot=True,retained=True,other_growth=True)
 def test_full_memory_stop_keeps_independent_source_identity_verdict(self):self.exercise(hot=True,retained=True,capacity_failure=True)
 def test_full_source_identity_failure_not_misclassified_as_memory(self):self.exercise(hot=True,retained=True,protected_failure=True)
 def test_full_warm_inverse_rejects_reset_hidden_by_other_tenant_growth(self):self.exercise(hot=True,retained=True,masked_reset=True)
 def test_full_warm_inverse_retains_traces_despite_new_poll_errors(self):self.exercise(hot=True,retained=True)
 def test_hot_full_flow_never_restarts_candidate(self):self.exercise(hot=True)
 def test_full_positive_corrupt_quarantine_and_recovery_flow(self):self.exercise()
 def test_nonreproduced_fault_stops_before_quarantine_and_cleans(self):self.exercise(missing_failure=True)
 def test_candidate_launch_failure_is_diagnostic_not_fault_reproduction(self):self.exercise(launch_failure=True)
 def test_changed_recovered_trace_never_promotes_cd(self):self.exercise(changed_recovery=True)

class PollingEvidence(unittest.TestCase):
 def test_failure_retention_is_distinct_from_healthy_rollback(self):
  from stack_tempo_poll_evidence import counters,classify_inverse
  before=counters('tempodb_blocklist_tenant_index_errors_total{tenant="test"} 2\ntempodb_blocklist_poll_duration_seconds_count 3')
  after=counters('tempodb_blocklist_tenant_index_errors_total{tenant="test"} 4\ntempodb_blocklist_poll_duration_seconds_count 3')
  result=classify_inverse(before,after,True,'test')
  self.assertTrue(result['retainedGoodBlocklistObserved']);self.assertFalse(result['healthyRollbackGuaranteed']);self.assertEqual(result['newPollCycles'],0)
  self.assertFalse(classify_inverse(before,before,True,'test')['retainedGoodBlocklistObserved'])
  self.assertFalse(classify_inverse(before,after,False,'test')['retainedGoodBlocklistObserved'])
 def test_completed_failed_poll_is_not_reported_as_success(self):
  from stack_tempo_poll_evidence import counters,classify_inverse
  before=counters('tempodb_blocklist_tenant_index_errors_total{tenant="test"} 2\ntempodb_blocklist_poll_duration_seconds_count 3')
  after=counters('tempodb_blocklist_tenant_index_errors_total{tenant="test"} 4\ntempodb_blocklist_poll_duration_seconds_count 4')
  result=classify_inverse(before,after,True,'test');self.assertEqual(result['newPollCycles'],1);self.assertNotIn('newSuccessfulPolls',result);self.assertFalse(result['healthyRollbackGuaranteed'])
 def test_series_reset_and_disappearance_refuse_even_when_total_grows(self):
  from stack_tempo_poll_evidence import counters,classify_inverse
  old=counters('tempodb_blocklist_tenant_index_errors_total{tenant="a"} 5\ntempodb_blocklist_tenant_index_errors_total{tenant="b"} 1\ntempodb_blocklist_poll_duration_seconds_count 3')
  new=counters('tempodb_blocklist_tenant_index_errors_total{tenant="a"} 0\ntempodb_blocklist_tenant_index_errors_total{tenant="b"} 8\ntempodb_blocklist_poll_duration_seconds_count 3')
  self.assertGreater(new['totals']['tempodb_blocklist_tenant_index_errors_total'],old['totals']['tempodb_blocklist_tenant_index_errors_total'])
  with self.assertRaises(ValueError):classify_inverse(old,new,True,'a')
  changed=counters('tempodb_blocklist_tenant_index_errors_total{tenant="b"} 10\ntempodb_blocklist_poll_duration_seconds_count 3')
  with self.assertRaises(ValueError):classify_inverse(old,changed,True,'a')
 def test_unrelated_tenant_increase_cannot_prove_bound_retention(self):
  from stack_tempo_poll_evidence import counters,classify_inverse
  before=counters('tempodb_blocklist_tenant_index_errors_total{tenant="test"} 1\ntempodb_blocklist_tenant_index_errors_total{tenant="other"} 1\ntempodb_blocklist_poll_duration_seconds_count 3')
  after=counters('tempodb_blocklist_tenant_index_errors_total{tenant="test"} 1\ntempodb_blocklist_tenant_index_errors_total{tenant="other"} 2\ntempodb_blocklist_poll_duration_seconds_count 3')
  result=classify_inverse(before,after,True,'test');self.assertFalse(result['retainedGoodBlocklistObserved']);self.assertEqual(result['newPollErrors'],0);self.assertEqual(result['aggregateNewPollErrors'],1)
  with self.assertRaises(ValueError):classify_inverse(before,after,True,'missing')
 def test_missing_reset_nan_duplicate_or_negative_counters_refused(self):
  from stack_tempo_poll_evidence import counters,classify_inverse
  base='tempodb_blocklist_tenant_index_errors_total 2\ntempodb_blocklist_poll_duration_seconds_count 3'
  for text in ('',base.replace('total 2','total NaN'),base.replace('total 2','total -1'),base+'\ntempodb_blocklist_tenant_index_errors_total 2'):
   with self.assertRaises(ValueError):counters(text)
  old=counters(base);new=counters(base.replace('total 2','total 1'))
  with self.assertRaises(ValueError):classify_inverse(old,new,True,'a')

if __name__=='__main__':unittest.main()
