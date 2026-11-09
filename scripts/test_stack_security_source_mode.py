"""Check the source scan mode guard without running scanners."""
from pathlib import Path
import subprocess
import sys
import unittest


class SecuritySourceModeTest(unittest.TestCase):
    def test_scan_refuses_before_importing_scan_work(self):
        script = Path(__file__).with_name('stack-security-source.py')
        # Isolated mode excludes adjacent modules, so even a regression stops before setup.
        result = subprocess.run([sys.executable, '-I', '-S', '-O', str(script)],
                                capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, '')
        self.assertEqual(result.stderr.strip(),
                         'Source security scan requires Python assertions to be enabled')
