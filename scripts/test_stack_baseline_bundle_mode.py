"""Check the baseline bundle test mode without accessing Docker."""
from pathlib import Path
import subprocess
import sys
import unittest


class BaselineBundleModeTest(unittest.TestCase):
    def test_baseline_bundle_refuses_before_importing_stack_client(self):
        script = Path(__file__).with_name('stack-baseline-bundle-smoke.py')
        # Isolated mode excludes adjacent modules, so even a regression stops before setup.
        result = subprocess.run([sys.executable, '-I', '-S', '-O', str(script)],
                                capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, '')
        self.assertEqual(result.stderr.strip(),
                         'Baseline bundle smoke test requires Python assertions to be enabled')
