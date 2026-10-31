"""Host pressure must refuse fixture work before any Docker command."""
import ctypes,importlib.util,pathlib,unittest
from unittest.mock import patch
import stack_host_capacity as host
ROOT=pathlib.Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('host_capacity_online',ROOT/'scripts/stack-online-recovery.py');online=importlib.util.module_from_spec(spec);spec.loader.exec_module(online)

class HostCapacity(unittest.TestCase):
 def test_native_structure_and_available_bytes(self):
  def fill(pointer):
   value=pointer._obj;self.assertEqual(value.length,64);value.totalPhysical=16*1024**3;value.availablePhysical=3*1024**3;return 1
  with patch.object(host.ctypes,'WinDLL',create=True) as library:
   library.return_value.GlobalMemoryStatusEx.side_effect=fill;self.assertEqual(host.windows_available_mib(),3072)
   library.return_value.GlobalMemoryStatusEx.side_effect=None;library.return_value.GlobalMemoryStatusEx.return_value=0
   with self.assertRaises(ValueError):host.windows_available_mib()
 def test_windows_initial_and_checkpoint_reserves(self):
  with patch.object(host.os,'name','nt'),patch.object(host,'windows_available_mib',return_value=463):
   with self.assertRaises(ValueError) as caught:host.require_host_capacity(2048)
   self.assertEqual(caught.exception.capacity_failure,{'hostMemoryAvailableMiB':463,'hostMemoryRequiredMiB':2048})
  with patch.object(host.os,'name','nt'),patch.object(host,'windows_available_mib',return_value=1000):
   with self.assertRaises(ValueError):host.require_host_capacity(512)
  with patch.object(host.os,'name','nt'),patch.object(host,'windows_available_mib',return_value=2048):self.assertEqual(host.require_host_capacity(2048)['hostMemoryRequiredMiB'],2048)
 def test_nonwindows_does_not_claim_windows_measurement(self):
  with patch.object(host.os,'name','posix'),patch.object(host,'windows_available_mib') as probe:
   self.assertIsNone(host.require_host_capacity(2048)['hostMemoryAvailableMiB']);probe.assert_not_called()
 def test_sustained_window_requires_all_samples_and_elapsed_time(self):
  with patch.object(host.os,'name','nt'),patch.object(host,'windows_available_mib',return_value=2300),patch.object(host.time,'sleep') as sleep,patch.object(host.time,'monotonic',side_effect=[100,340]):
   result=host.require_sustained_host_capacity();self.assertTrue(result['hostSustainedMemoryVerified']);self.assertEqual(result['hostMemorySamples'],13);self.assertEqual(sleep.call_count,12)
  with patch.object(host.os,'name','nt'),patch.object(host,'windows_available_mib',return_value=2300),patch.object(host.time,'sleep'),patch.object(host.time,'monotonic',side_effect=[100,339]):
   with self.assertRaises(ValueError):host.require_sustained_host_capacity()
 def test_transient_reserve_is_refused_without_finishing_window(self):
  with patch.object(host.os,'name','nt'),patch.object(host,'windows_available_mib',side_effect=[2400,2300,2047]),patch.object(host.time,'sleep') as sleep:
   with self.assertRaises(ValueError) as caught:host.require_sustained_host_capacity()
   self.assertEqual(caught.exception.capacity_failure['hostMemoryAvailableMiB'],2047);self.assertEqual(sleep.call_count,2)
 def test_sustained_probe_failure_and_nonwindows_do_not_claim_success(self):
  with patch.object(host.os,'name','nt'),patch.object(host,'windows_available_mib',side_effect=ValueError('unknown memory')),patch.object(host.time,'sleep') as sleep:
   with self.assertRaises(ValueError):host.require_sustained_host_capacity()
   sleep.assert_not_called()
  with patch.object(host.os,'name','posix'),patch.object(host,'windows_available_mib') as probe:
   self.assertFalse(host.require_sustained_host_capacity()['hostSustainedMemoryVerified']);probe.assert_not_called()
 def test_host_refusal_precedes_engine_query(self):
  with patch.object(online,'require_host_capacity',side_effect=ValueError('fixture host pressure')),patch.object(online.c,'run') as command:
   with self.assertRaises(ValueError):online.session_capacity()
   command.assert_not_called()
if __name__=='__main__':unittest.main()
