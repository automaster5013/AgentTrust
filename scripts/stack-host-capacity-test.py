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
 def test_host_refusal_precedes_engine_query(self):
  with patch.object(online,'require_host_capacity',side_effect=ValueError('fixture host pressure')),patch.object(online.c,'run') as command:
   with self.assertRaises(ValueError):online.session_capacity()
   command.assert_not_called()
if __name__=='__main__':unittest.main()
