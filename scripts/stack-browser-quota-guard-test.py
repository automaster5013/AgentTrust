"""Independent reserve and malformed counter controls, without Redis writes."""
import contextlib,importlib.util,io,json,pathlib,unittest
from types import SimpleNamespace
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('quota_guard',pathlib.Path(__file__).with_name('stack-browser-quota-guard.py'));module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class BudgetTests(unittest.TestCase):
 def test_exact_headroom_is_available_and_one_excess_count_waits(self):
  self.assertEqual(module.wait_seconds(144,60,240,96),0);self.assertEqual(module.wait_seconds(145,60,240,96),61)
  self.assertEqual(module.wait_seconds(44,60,60,16),0);self.assertEqual(module.wait_seconds(45,12,60,16),13)
 def test_missing_counter_and_expiring_full_counter(self):
  self.assertEqual(module.wait_seconds(0,-2,240,96),0);self.assertEqual(module.wait_seconds(240,0,240,96),1)
 def test_corrupt_or_persistent_counters_never_trigger_a_reset(self):
  for values in [(-1,20,240,96),(241,20,240,96),(1,-2,240,96),(1,-1,240,96),(1,61,240,96),(True,20,240,96),(1,20,240,0),(1,20,240,241)]:
   with self.assertRaises(ValueError):module.wait_seconds(*values)
 def test_foreign_container_is_rejected_before_forwarding_token(self):
  scope={key:'00000000-0000-0000-0000-000000000001' for key in ('organizationId','projectId')}
  inputs=[io.BytesIO(json.dumps([scope]).encode()),io.BytesIO(b'a'*64)]
  inspection=SimpleNamespace(stdout='foreign stack-redis')
  counters=SimpleNamespace(stdout=b'0\n-2\n0\n-2\n')
  with patch.object(pathlib.Path,'open',side_effect=inputs),patch.object(module.subprocess,'run',side_effect=[inspection,counters]) as run,contextlib.redirect_stdout(io.StringIO()):
   result=module.main()
  self.assertEqual(result,1)
  run.assert_called_once()
  self.assertEqual(run.call_args.args[0][1],'inspect')
  self.assertNotIn('input',run.call_args.kwargs)
if __name__=='__main__':unittest.main()
