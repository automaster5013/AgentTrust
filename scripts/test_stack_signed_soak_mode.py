"""Check the signed review soak mode guard without running traffic."""
from pathlib import Path
import subprocess
import sys
import unittest


class SignedSoakModeTest(unittest.TestCase):
    def test_soak_refuses_before_importing_evidence_tools(self):
        script = Path(__file__).with_name('stack-signed-review-soak.py')
        # Isolated mode excludes adjacent modules, so even a regression stops before setup.
        result = subprocess.run([sys.executable, '-I', '-S', '-O', str(script)],
                                capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, '')
        self.assertEqual(result.stderr.strip(),
                         'Signed review soak requires Python assertions to be enabled')
