"""Closed-block selection and semantic trace identity, no operating service calls."""
import contextlib,datetime,importlib.util,io,json,pathlib,tempfile,unittest
from types import SimpleNamespace
from unittest.mock import patch
ROOT=pathlib.Path(__file__).resolve().parent.parent
def module(name,file):
 spec=importlib.util.spec_from_file_location(name,ROOT/'scripts'/file);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
logs=module('logs_history','stack-loki-history-recovery.py')
metrics=module('metrics_history','stack-prometheus-history-recovery.py')
model=module('offline_model','stack-offline-model-probe.py')
helper=module('block_helper','stack-file-volume-helper.py');tempo=module('tempo_rehearsal','stack-tempo-history-recovery.py')

class ExtraHistory(unittest.TestCase):
 def test_closed_selection_excludes_wal_and_recent_unfinished_time(self):
  with tempfile.TemporaryDirectory(dir=ROOT/'.local') as temporary,patch.object(helper,'ROOT',pathlib.Path(temporary)):
   root=pathlib.Path(temporary);now=datetime.datetime.now(datetime.timezone.utc)
   for base,block,seconds in [('blocks','old',1800),('blocks','recent',10),('wal','never-selected',300)]:
    path=root/base/'tenant'/block;path.mkdir(parents=True);(path/'meta.json').write_text(json.dumps({'blockID':block,'startTime':(now-datetime.timedelta(seconds=seconds+10)).isoformat(),'endTime':(now-datetime.timedelta(seconds=seconds)).isoformat(),'totalObjects':1}))
   selected=helper.select_blocks();self.assertEqual([row['prefix'] for row in selected],['blocks/tenant/old'])
 def test_trace_order_is_normalized_but_changed_span_is_not(self):
  def frame(values):return {'batches':[{'resource':{'attributes':[]},'scopeSpans':[{'spans':values}]}]}
  first={'spanId':'one','name':'read','attributes':[{'key':'z','value':1},{'key':'a','value':2}]};second={'spanId':'two','name':'query'}
  self.assertEqual(tempo.trace_fingerprint(frame([first,second])),tempo.trace_fingerprint(frame([second,first])))
  self.assertNotEqual(tempo.trace_fingerprint(frame([first])),tempo.trace_fingerprint(frame([{**first,'name':'changed'}])))
  with self.assertRaises(ValueError):tempo.trace_fingerprint({'batches':[]})
 def test_offline_probe_checks_done_and_never_prints_response(self):
  class Response:
   status=200
   def __enter__(self):return self
   def __exit__(self,*args):pass
   def read(self,size):return json.dumps({'done':True,'model':'qwen3:0.6b','response':'private generated fixture','eval_count':2}).encode()
  class Opener:
   def open(self,request,**kwargs):
    assert request.full_url=='http://127.0.0.1:11434/api/generate'
    assert json.loads(request.data)['options']['num_predict']==16
    return Response()
  output=io.StringIO()
  with patch.object(model.urllib.request,'build_opener',return_value=Opener()),contextlib.redirect_stdout(output):result=model.main()
  self.assertEqual(result,0);self.assertNotIn('private generated fixture',output.getvalue());self.assertTrue(json.loads(output.getvalue())['offlineInferenceVerified'])
 def test_capacity_retries_entire_transient_sample_without_ignoring_usage(self):
  result=lambda raw:SimpleNamespace(stdout=raw)
  with patch.object(tempo.m.c,'run',side_effect=[result(b'8589934592'),result(b'-- / --\n'),result(b'4GiB / 8GiB\n')]):
   self.assertEqual(tempo.m.session_capacity()['reportedFreeWorkingSetMiB'],4096)
  with patch.object(tempo.m.c,'run',side_effect=[result(b'8589934592')]+[result(b'-- / --\n')]*3):
   with self.assertRaises(ValueError):tempo.m.session_capacity()
  with patch.object(tempo.m.c,'run',side_effect=[result(b'8589934592'),result(b'7GiB / 8GiB\n')]):
   with self.assertRaises(ValueError):tempo.m.session_capacity()
 def test_tempo_hex_ids_restore_omitted_leading_zeroes(self):
  self.assertEqual(tempo.trace_id('AB12'),'0'*28+'ab12')
  for value in ('../escape','g'*32,'f'*33,''):
   with self.assertRaises(ValueError):tempo.trace_id(value)
 def test_prometheus_selects_closed_ulid_blocks_without_wal(self):
  with tempfile.TemporaryDirectory(dir=ROOT/'.local') as temporary,patch.object(helper,'ROOT',pathlib.Path(temporary)):
   root=pathlib.Path(temporary);path=root/('0'*25+'1');path.mkdir();(root/'wal').mkdir()
   (path/'meta.json').write_text(json.dumps({'ulid':path.name,'minTime':1000000,'maxTime':2000000,'stats':{'numSamples':3}}))
   self.assertEqual(helper.select_prometheus()[0]['prefix'],path.name)
   row=json.loads((path/'meta.json').read_text());row['ulid']='substitute';(path/'meta.json').write_text(json.dumps(row))
   with self.assertRaises(ValueError):helper.select_prometheus()
 def test_metric_content_changes_and_empty_results_refused(self):
  def frame(v):return {'status':'success','data':{'resultType':'matrix','result':[{'metric':{'job':'agenttrust-otel'},'values':[[100,'1'],[130,v]]}]}}
  self.assertEqual(metrics.metric_fingerprint(frame('1'))[1],2);self.assertNotEqual(metrics.metric_fingerprint(frame('1')),metrics.metric_fingerprint(frame('0')))
  for bad in ({'status':'success','data':{'resultType':'matrix','result':[]}},dict(frame('1'),warnings=['partial'])):
   with self.assertRaises(ValueError):metrics.metric_fingerprint(bad)
 def test_metrics_reads_refuse_other_names_and_large_windows(self):
  for name,start,end in [('logitrack-prometheus',100,200),('agenttrust-stack-prometheus-1',100,4000)]:
   with self.assertRaises(ValueError):metrics.get(name,start,end)
 def test_log_bytes_and_timestamp_are_bound_and_empty_history_refused(self):
  def frame(value):return {'status':'success','data':{'resultType':'streams','result':[{'stream':{'service_name':'fixture'},'values':[['1000000000',value]]}]}}
  self.assertEqual(logs.log_fingerprint(frame('saved'))[1],1);self.assertNotEqual(logs.log_fingerprint(frame('saved')),logs.log_fingerprint(frame('changed')))
  with self.assertRaises(ValueError):logs.log_fingerprint({'status':'success','data':{'resultType':'streams','result':[]}})
 def test_base64_padding_filename_is_safe_but_traversal_is_not(self):
  self.assertEqual(helper.path_for('chunks/Zml4dHVyZQ==').name,'Zml4dHVyZQ==')
  with self.assertRaises(ValueError):helper.path_for('chunks/../escape==')
 def test_trace_scope_and_resource_metadata_changes_are_bound(self):
  def frame(scope,resource):return {'batches':[{'resource':resource,'scopeSpans':[{'scope':scope,'spans':[{'spanId':'one','name':'read'}]}]}]}
  original=tempo.trace_fingerprint(frame({'name':'one'},{'droppedAttributesCount':0}))
  self.assertNotEqual(original,tempo.trace_fingerprint(frame({'name':'two'},{'droppedAttributesCount':0})))
  self.assertNotEqual(original,tempo.trace_fingerprint(frame({'name':'one'},{'droppedAttributesCount':1})))
 def test_original_reader_requires_fixture_identity_and_uses_only_loopback_namespace(self):
  identity='00000000-0000-0000-0000-000000000001';name='agenttrust-stack-coldrestore-'+identity+'-original-stack-tempo';path='/api/traces/'+'a'*32+'?start=100&end=200'
  row={'Id':'reader','HostConfig':{'NetworkMode':'none'},'Config':{'Labels':{'agenttrust.fixture':identity}}}
  with patch.object(tempo.m.c,'inspect',return_value=row),patch.object(tempo.m.c,'run',return_value=SimpleNamespace(stdout=b'{}',returncode=0)) as command:
   self.assertEqual(tempo.get(name,path),{});args=command.call_args[0][0];self.assertEqual(args[args.index('--network')+1],'container:reader');self.assertFalse(any('type=volume' in v for v in args))
  row['Config']['Labels']['agenttrust.fixture']='other'
  with patch.object(tempo.m.c,'inspect',return_value=row),patch.object(tempo.m.c,'run') as command:
   with self.assertRaises(ValueError):tempo.get(name,path)
   command.assert_not_called()
  with self.assertRaises(ValueError):tempo.get('agenttrust-stack-tempo-1','/api/traces/'+'a'*32+'?start=100&end=9999999999')
 def test_metadata_audit_detects_empty_and_truncated_json_without_writing(self):
  with tempfile.TemporaryDirectory(dir=ROOT/'.local') as temporary,patch.object(helper,'ROOT',pathlib.Path(temporary)):
   path=pathlib.Path(temporary)/'blocks'/'tenant'/'block';path.mkdir(parents=True)
   for name,raw in [('meta.json',b''),('meta.compacted.json',b'{'),('index.json',b'{}')]: (path/name).write_bytes(raw)
   before={p.name:p.read_bytes() for p in path.iterdir()};proof=helper.audit_tempo_metadata()
   self.assertEqual(proof['metadataFilesExamined'],3);self.assertEqual(len(proof['invalid']),2);self.assertEqual(sum(r['category']=='empty-json' for r in proof['invalid']),1)
   self.assertFalse(proof['sourceWritesPerformed']);self.assertEqual(before,{p.name:p.read_bytes() for p in path.iterdir()})
 def test_offline_probe_refuses_redirects(self):
  with self.assertRaises(ValueError):model.RefuseRedirect().redirect_request(None,None,None,None,None,None)
 def test_trace_probe_refuses_other_services_and_unbounded_paths(self):
  for name,path in [('logitrack-tempo','/api/search?limit=1'),('agenttrust-stack-tempo-1','/api/traces/../escape')]:
   with self.assertRaises(ValueError):tempo.get(name,path)

if __name__=='__main__':unittest.main()
