"""Check the rehearsal's mode guard without accessing Docker or fixtures."""
from pathlib import Path
import subprocess
import sys
import unittest


class DatabaseProcessModeTest(unittest.TestCase):
    def test_rehearsal_refuses_before_creating_fixture_or_launching_process(self):
        script = Path(__file__).with_name('stack-database-process-adversarial.py')
        # Isolated mode excludes adjacent modules, so even a regression stops before setup.
        result = subprocess.run([sys.executable, '-I', '-S', '-O', str(script)],
                                capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, '')
        self.assertEqual(result.stderr.strip(),
                         'Database process rehearsal requires Python assertions to be enabled')
