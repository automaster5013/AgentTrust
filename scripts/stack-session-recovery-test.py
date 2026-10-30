"""Session fixture ownership, resource refusal and complete mocked restart flow."""
import importlib.util,json,pathlib,subprocess,tempfile,types,unittest
from unittest.mock import Mock,patch
spec=importlib.util.spec_from_file_location('session_recovery',pathlib.Path(__file__).with_name('stack-online-recovery.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class SessionRecovery(unittest.TestCase):
 def test_capacity_refuses_insufficient_headroom(self):
  for usage,allowed in ((b'5GiB / 8GiB\n',True),(b'6.5GiB / 8GiB\n',False)):
   with patch.object(m.c,'run',side_effect=[subprocess.CompletedProcess([],0,str(8*1073741824).encode(),b''),subprocess.CompletedProcess([],0,usage,b'')]):
    if allowed:self.assertGreaterEqual(m.session_capacity()['reportedFreeWorkingSetMiB'],2048)
    else:
     with self.assertRaises(ValueError):m.session_capacity()
 def test_session_scope_is_explicit_and_exclusive(self):
  with patch.object(m.d,'live_baseline') as baseline:
   for execute,live,stores in ((False,False,False),(True,True,False),(True,True,True)):
    with self.assertRaises(ValueError):m.run(None,None,execute,live,stores,True)
   baseline.assert_not_called()
 def test_complete_mocked_cookie_restart_and_reauthentication(self):
  with tempfile.TemporaryDirectory(dir=m.ROOT/'.local') as temporary:
   drill=types.SimpleNamespace(directory=pathlib.Path(temporary),prefix='owned-fixture',report={});calls=[];checks=[]
   def phase(d,fixture,name,*args):
    calls.append(name)
    return {'completed':True,'capsule':{'cookie':'private-fixture-cookie'}} if name=='session-open' else {'completed':True}
   rows=[{'Id':'same-id','Image':'same-image','State':{'StartedAt':stamp}} for stamp in ('before','after')]
   with patch.object(m,'state_probe',side_effect=phase),patch.object(m.c,'inspect',side_effect=rows),patch.object(m,'owned_runtime') as restart:
    m.session_exercise(drill,{},b'k'*32,lambda:checks.append(True))
   self.assertEqual(calls,['session-open','session-check','reauth']);self.assertEqual(len(checks),4)
   restart.assert_called_once_with(drill,'stack-core-api','restart')
   self.assertTrue(drill.report['apiRestartReauthenticationVerified']);self.assertFalse(drill.report['existingSessionContinuityVerified'])
   self.assertNotIn('private-fixture-cookie',json.dumps(drill.report));self.assertNotIn(b'private-fixture-cookie',(pathlib.Path(temporary)/'fixture-session.aesgcm').read_bytes())
 def test_source_health_refusal_prevents_any_session_or_restart(self):
  with patch.object(m,'state_probe') as probe,patch.object(m,'owned_runtime') as restart:
   with self.assertRaises(ValueError):m.session_exercise(None,{},b'k'*32,Mock(side_effect=ValueError('source health unavailable')))
   probe.assert_not_called();restart.assert_not_called()

if __name__=='__main__':unittest.main()
