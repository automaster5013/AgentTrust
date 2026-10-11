"""Independent reserve and malformed counter controls, without Redis writes."""
import importlib.util,pathlib,unittest
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
if __name__=='__main__':unittest.main()
