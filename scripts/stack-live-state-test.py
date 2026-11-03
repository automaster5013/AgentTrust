"""Live read boundaries, archived state contracts and complete mocked fault exercise."""
import hashlib,importlib.util,io,json,pathlib,subprocess,tarfile,tempfile,types,unittest
from unittest.mock import patch,Mock
import stack_live_state as live

def module(name,file):
 spec=importlib.util.spec_from_file_location(name,pathlib.Path(__file__).with_name(file));value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
m=module('live_online_tests','stack-online-recovery.py');probe=module('live_probe_tests','stack-stateful-recovery-probe.py')

def archive(body,name='appendonlydir/appendonly.aof.1.incr.aof'):
 target=io.BytesIO()
 with tarfile.open(fileobj=target,mode='w:gz') as handle:
  row=tarfile.TarInfo(name);row.size=len(body);row.mode=0o600;handle.addfile(row,io.BytesIO(body))
 return target.getvalue()

def resp(*args):return b'*'+str(len(args)).encode()+b'\r\n'+b''.join(b'$'+str(len(v)).encode()+b'\r\n'+v+b'\r\n' for v in args)

class LiveState(unittest.TestCase):
 def test_queue_contract_preserves_positions_but_ignores_poll_timestamps(self):
  consumer={'stream_name':'fixture','name':'durable','created':'original','config':{},'num_ack_pending':0,'num_redelivered':0,'num_pending':0,
            'delivered':{'consumer_seq':7,'stream_seq':11,'last_active':'before'},'ack_floor':{'consumer_seq':7,'stream_seq':11},'num_waiting':1,'ts':'before'}
  frame={'account_details':[{'stream_detail':[{'name':'fixture','created':'original','config':{},'state':{'messages':0},'consumer_detail':[consumer]}]}]}
  with patch.object(live,'command',side_effect=lambda args:json.dumps(frame).encode()):
   before=live.queue_state('agenttrust-stack-nats-1');consumer.update(ts='after',num_waiting=0);consumer['delivered']['last_active']='after'
   self.assertEqual(before,live.queue_state('agenttrust-stack-nats-1'))
   consumer['num_ack_pending']=1;self.assertNotEqual(before,live.queue_state('agenttrust-stack-nats-1'))
 def test_expired_quota_cannot_be_resurrected_and_active_ttl_is_preserved(self):
  metadata={'capturedAtEpoch':100,'redisKeys':['stack:quota:fixture'],'redisValues':[['stack:quota:fixture','3',60]]};drill=types.SimpleNamespace(prefix='fixture')
  with patch.object(live.time,'time',return_value=200),patch.object(live,'redis_values',return_value=[['stack:quota:fixture','3',10]]):
   with self.assertRaises(ValueError):live.verify_redis(drill,metadata)
  with patch.object(live.time,'time',return_value=105),patch.object(live,'redis_values',return_value=[['stack:quota:fixture','3',55]]):
   self.assertEqual(live.verify_redis(drill,metadata)['stillLiveQuotaValuesVerified'],1)
 def test_aof_only_extracts_bounded_quota_keys(self):
  key=b'stack:quota:fixture';raw=archive(resp(b'MULTI')+resp(b'INCR',key)+resp(b'PEXPIREAT',key,b'9999')+resp(b'EXEC'))
  self.assertEqual(live.aof_keys(raw),[key.decode()])
  for raw in (archive(resp(b'SET',key,b'secret')),archive(resp(b'INCR',b'foreign:key')),archive(b'*3\r\n$100\r\nshort'),archive(resp(b'INCR',key),'../escape.incr.aof')):
   with self.assertRaises(ValueError):live.aof_keys(raw)
 def test_operating_volume_label_mismatch_refused_before_read(self):
  source={'Config':{'Labels':{'com.docker.compose.project':'agenttrust','com.docker.compose.service':'stack-nats'},'User':'10001'},'Mounts':[{'Type':'volume','Name':'logitrack_data'}]}
  with patch.object(live,'volume_stream') as stream:
   with self.assertRaises(ValueError):live.source_archive(source,'stack-nats')
   stream.assert_not_called()
 def test_live_copy_is_readonly_and_rejects_changed_files(self):
  source={'Config':{'Labels':{'com.docker.compose.project':'agenttrust','com.docker.compose.service':'stack-nats'},'User':'10001'},'Mounts':[{'Type':'volume','Name':'agenttrust_stack-nats-data'}]}
  volume=[{'Labels':{'com.docker.compose.project':'agenttrust','com.docker.compose.volume':'stack-nats-data'}}]
  with patch.object(live,'command',return_value=json.dumps(volume).encode()),patch.object(live,'volume_stream',side_effect=[b'4 /data',archive(b'fixture')]) as stream:
   live.source_archive(source,'stack-nats')
   for call in stream.call_args_list:self.assertFalse(call.kwargs.get('write',False))
  with patch.object(live,'queue_state',return_value=[]),patch.object(live,'source_archive',side_effect=[archive(b'first'),archive(b'changed')]):
   with self.assertRaises(ValueError):live.capture({'stack-object-store':{}},Mock())
 def test_source_redis_command_has_only_readonly_lua_and_fixed_token_path(self):
  with patch.object(live,'command',return_value=b'[["stack:quota:fixture",null,-2]]') as command:
   live.redis_values('agenttrust-stack-redis-1',['stack:quota:fixture'])
   args=command.call_args.args[0];script=args[args.index('EVAL')+1]
   self.assertIn("redis.call('GET'",script);self.assertIn("redis.call('TTL'",script);self.assertNotIn('INCR',script)
   self.assertIn('"$@"',args[5]);self.assertNotIn('DUMP',args)
 def test_capture_parses_multiline_postgres_json_without_losing_rows(self):
  raw=archive(b'');sources={name:{} for name in live.VOLUMES};output='BEGIN\nSET\n[\n{"fixture":1},\n{"fixture":2}\n]\nCOMMIT'
  with patch.object(live,'source_archive',return_value=raw),patch.object(live,'queue_state',return_value=[{'fixture':True}]),patch.object(live,'redis_values',return_value=[]):
   payload=live.capture(sources,lambda statement:output)
  self.assertEqual(len(json.loads(payload['liveStateMetadata'])['objectReferences']),2)
 def test_object_probe_requires_exact_version_id_and_hash(self):
  body=b'{"fixture":true}';key='organizations/'+'a'*36+'/projects/'+'b'*36+'/runs/'+'c'*36+'/'+hashlib.sha256(body).hexdigest()+'.json'
  row={'object_key':key,'version_id':'fixture-version','content_sha256':hashlib.sha256(body).hexdigest(),'content_bytes':len(body)}
  response=Mock(status=200,headers={'x-amz-version-id':'fixture-version'});response.read.return_value=body;response.__enter__=Mock(return_value=response);response.__exit__=Mock(return_value=False)
  with patch.object(probe.urllib.request,'build_opener') as opener:
   opener.return_value.open.return_value=response;probe.signed_object(row,'stack-evidence','a'*64)
   request=opener.return_value.open.call_args.args[0];self.assertTrue(request.full_url.startswith('http://stack-object-store:9000/stack-evidence/'));self.assertIn('versionId=fixture-version',request.full_url)
   response.headers={'x-amz-version-id':'wrong'}
   with self.assertRaises(ValueError):probe.signed_object(row,'stack-evidence','a'*64)
  for changed in ({**row,'object_key':'../escape'},{**row,'version_id':'null'}):
   with self.assertRaises(ValueError):probe.signed_object(changed,'stack-evidence','a'*64)
 def test_operating_fault_targets_rejected_before_command(self):
  drill=types.SimpleNamespace(prefix='agenttrust-stack-coldrestore-fixture',id='fixture')
  with patch.object(m.c,'inspect',return_value={'Config':{'Labels':{'agenttrust.fixture':'foreign'}}}),patch.object(m.c,'run') as command:
   with self.assertRaises(ValueError):m.owned_runtime(drill,'stack-core-api','restart')
   with self.assertRaises(ValueError):m.owned_runtime(drill,'api','restart')
   command.assert_not_called()
 def test_complete_mocked_history_queue_and_session_exercise(self):
  with tempfile.TemporaryDirectory(dir=live.ROOT/'.local') as temporary:
   drill=types.SimpleNamespace(directory=pathlib.Path(temporary),report={},prefix='agenttrust-stack-coldrestore-fixture')
   capsule={'cookie':'private-fixture-cookie','runId':'6c3b6bfc-fc5e-4caf-b67a-8ccb30231efb'}
   def phase(drill,fixture,name,*args):return {'completed':True,'capsule':capsule} if name=='admit' else {'completed':True}
   state=[{'name':'fixture','created':'original','state':{'messages':1,'last_seq':17}}];faults=[]
   with patch.object(m,'state_probe',side_effect=phase),patch.object(m,'owned_runtime',side_effect=lambda d,s,a:faults.append((s,a))),patch.object(live,'seed_fixture_quota',return_value='stack:quota:fixture'),patch.object(live,'redis_values',side_effect=[[['stack:quota:fixture','3',14]],[['stack:quota:fixture',None,-2]]]),patch.object(live,'queue_state',return_value=state):
    m.state_exercise(drill,{}, {'liveStateMetadata':json.dumps({'queue':state}).encode()},b'k'*32)
   self.assertTrue(drill.report['queuePersistenceAndReplayVerified']);self.assertTrue(drill.report['sessionReauthenticationRequired']);self.assertFalse(drill.report['existingSessionContinuityVerified'])
   self.assertEqual(faults,[('stack-redis','restart'),('stack-ai-worker','stop'),('stack-nats','restart'),('stack-ai-worker','start'),('stack-core-api','restart')])
   self.assertNotIn(b'private-fixture-cookie',(pathlib.Path(temporary)/'fixture-session.aesgcm').read_bytes())
 def test_three_store_exercise_has_no_application_or_source_faults(self):
  drill=types.SimpleNamespace(report={},prefix='fixture');state=[{'name':'fixture','created':'original','state':{'messages':1,'last_seq':17}}];faults=[];phases=[]
  with patch.object(m,'state_probe',return_value={'completed':True}),patch.object(m,'store_queue_probe',side_effect=lambda d,f,p:phases.append(p)),patch.object(m,'owned_runtime',side_effect=lambda d,s,a:faults.append((s,a))),patch.object(live,'seed_fixture_quota',return_value='stack:quota:fixture'),patch.object(live,'redis_values',side_effect=[[['stack:quota:fixture','3',14]],[['stack:quota:fixture',None,-2]]]),patch.object(live,'queue_state',return_value=state):
   m.store_exercise(drill,{}, {'liveStateMetadata':json.dumps({'queue':state}).encode()})
  self.assertEqual(faults,[('stack-redis','restart'),('stack-nats','restart')]);self.assertEqual(phases,['admit','completion'])
  self.assertFalse(drill.report['existingSessionContinuityVerified']);self.assertTrue(drill.report['sourceQueuePositionsUnchanged'])
 def test_store_only_mode_requires_explicit_live_execution(self):
  with patch.object(m.d,'live_baseline') as baseline:
   with self.assertRaises(ValueError):m.run(None,None,False,True,True)
   baseline.assert_not_called()
 def test_empty_restore_scope_cannot_fall_back_to_full_stack(self):
  with patch.object(m.c,'run') as command:
   with self.assertRaises(ValueError):m.restore(None,{}, {},lambda:None,services=[])
   command.assert_not_called()

if __name__=='__main__':unittest.main()
