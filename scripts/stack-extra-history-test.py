"""Closed-block selection and semantic trace identity, no operating service calls."""
import datetime,importlib.util,json,pathlib,tempfile,unittest
from unittest.mock import patch
ROOT=pathlib.Path(__file__).resolve().parent.parent
def module(name,file):
 spec=importlib.util.spec_from_file_location(name,ROOT/'scripts'/file);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
helper=module('block_helper','stack-file-volume-helper.py');tempo=module('tempo_rehearsal','stack-tempo-history-recovery.py')

class ExtraHistory(unittest.TestCase):
 def test_closed_selection_excludes_wal_and_recent_unfinished_time(self):
  with tempfile.TemporaryDirectory(dir=ROOT/'.local') as temporary,patch.object(helper,'ROOT',pathlib.Path(temporary)):
   root=pathlib.Path(temporary);now=datetime.datetime.now(datetime.timezone.utc)
   for base,block,seconds in [('blocks','old',300),('blocks','recent',10),('wal','never-selected',300)]:
    path=root/base/'tenant'/block;path.mkdir(parents=True);(path/'meta.json').write_text(json.dumps({'blockID':block,'startTime':(now-datetime.timedelta(seconds=seconds+10)).isoformat(),'endTime':(now-datetime.timedelta(seconds=seconds)).isoformat(),'totalObjects':1}))
   selected=helper.select_blocks();self.assertEqual([row['prefix'] for row in selected],['blocks/tenant/old'])
 def test_trace_order_is_normalized_but_changed_span_is_not(self):
  def frame(values):return {'batches':[{'resource':{'attributes':[]},'scopeSpans':[{'spans':values}]}]}
  first={'spanId':'one','name':'read','attributes':[{'key':'z','value':1},{'key':'a','value':2}]};second={'spanId':'two','name':'query'}
  self.assertEqual(tempo.trace_fingerprint(frame([first,second])),tempo.trace_fingerprint(frame([second,first])))
  self.assertNotEqual(tempo.trace_fingerprint(frame([first])),tempo.trace_fingerprint(frame([{**first,'name':'changed'}])))
  with self.assertRaises(ValueError):tempo.trace_fingerprint({'batches':[]})
 def test_trace_probe_refuses_other_services_and_unbounded_paths(self):
  for name,path in [('logitrack-tempo','/api/search?limit=1'),('agenttrust-stack-tempo-1','/api/traces/../escape')]:
   with self.assertRaises(ValueError):tempo.get(name,path)

if __name__=='__main__':unittest.main()
