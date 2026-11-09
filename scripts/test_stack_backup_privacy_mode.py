"""Check the backup transport privacy mode without accessing Docker."""
from pathlib import Path
import subprocess
import sys
import unittest


class BackupPrivacyModeTest(unittest.TestCase):
    def test_privacy_test_refuses_before_importing_backup_tools(self):
        script = Path(__file__).with_name('stack-backup-transport-privacy-test.py')
        # Isolated mode excludes adjacent modules, so even a regression stops before setup.
        result = subprocess.run([sys.executable, '-I', '-S', '-O', str(script)],
                                capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, '')
        self.assertEqual(result.stderr.strip(),
                         'Backup transport privacy test requires Python assertions to be enabled')
