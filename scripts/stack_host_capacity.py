"""Read-only Windows host memory gate before adding isolated Docker workloads."""
import ctypes,os

def windows_available_mib():
 class MemoryStatus(ctypes.Structure):
  _fields_=[('length',ctypes.c_uint32),('load',ctypes.c_uint32)]+[(name,ctypes.c_uint64) for name in ('totalPhysical','availablePhysical','totalPageFile','availablePageFile','totalVirtual','availableVirtual','availableExtendedVirtual')]
 value=MemoryStatus();value.length=ctypes.sizeof(value)
 function=ctypes.WinDLL('kernel32',use_last_error=True).GlobalMemoryStatusEx;function.argtypes=[ctypes.POINTER(MemoryStatus)];function.restype=ctypes.c_int
 if not function(ctypes.byref(value)):raise ValueError('Windows host memory observation unavailable')
 if not 0<value.availablePhysical<=value.totalPhysical:raise ValueError('Windows host memory observation refused')
 return int(value.availablePhysical//1048576)

def require_host_capacity(minimum_mib):
 if os.name!='nt':return {'hostMemoryGate':'not-windows','hostMemoryAvailableMiB':None}
 available=windows_available_mib();required=max(1024,minimum_mib)
 if available<required:
  error=ValueError('Insufficient Windows host memory for isolated work');error.capacity_failure={'hostMemoryAvailableMiB':available,'hostMemoryRequiredMiB':required};raise error
 return {'hostMemoryGate':'windows-globalmemorystatusex','hostMemoryAvailableMiB':available,'hostMemoryRequiredMiB':required}
