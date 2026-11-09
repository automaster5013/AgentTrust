"""Check the approval observation mode without accessing fixtures or credentials."""
from pathlib import Path
import subprocess
import sys
import unittest


class ApprovalExpiryModeTest(unittest.TestCase):
    def test_optimized_observation_exits_before_importing_client(self):
        script = Path(__file__).with_name('stack-approval-expiry-observe.py')
        for mode in ('--prepare', '--verify'):
            with self.subTest(mode=mode):
                # Isolated mode blocks adjacent imports even if the guard regresses.
                result = subprocess.run(
                    [sys.executable, '-I', '-S', '-O', str(script), mode],
                    capture_output=True, text=True, timeout=10,
                )
                self.assertEqual(result.returncode, 1)
                self.assertEqual(result.stdout, '')
                self.assertEqual(result.stderr.strip(),
                                 'Approval expiry observation requires Python assertions to be enabled')
