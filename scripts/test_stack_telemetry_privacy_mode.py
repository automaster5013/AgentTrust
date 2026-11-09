"""Check the mode guard without running any telemetry privacy probe operations."""
from pathlib import Path
import subprocess
import sys
import unittest


BLOCK_FIRST_DEPENDENCY = """
import runpy
import sys


class BlockBase64:
    def find_spec(self, fullname, path=None, target=None):
        if fullname == 'base64':
            raise RuntimeError('Telemetry privacy probe attempted to import base64')


if 'base64' in sys.modules:
    raise RuntimeError('Isolation requires base64 to be absent')
sys.meta_path.insert(0, BlockBase64())
runpy.run_path(sys.argv[1], run_name='__main__')
"""


class TelemetryPrivacyModeTest(unittest.TestCase):
    def test_optimized_setup_exits_before_importing_dependencies(self):
        script = Path(__file__).with_name('stack-observability-probe.py')
        result = subprocess.run(
            [sys.executable, '-I', '-S', '-O', '-c', BLOCK_FIRST_DEPENDENCY, str(script)],
            capture_output=True, text=True, timeout=10,
        )
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, '')
        self.assertEqual(result.stderr.strip(),
                         'Telemetry privacy probe requires Python assertions to be enabled')
