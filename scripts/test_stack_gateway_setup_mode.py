"""Check the mode guard without running any gateway setup operations."""
from pathlib import Path
import subprocess
import sys
import unittest


BLOCK_FIRST_DEPENDENCY = """
import runpy
import sys


class BlockHashlib:
    def find_spec(self, fullname, path=None, target=None):
        if fullname == 'hashlib':
            raise RuntimeError('Gateway setup attempted to import hashlib')


if 'hashlib' in sys.modules:
    raise RuntimeError('Isolation requires hashlib to be absent')
sys.meta_path.insert(0, BlockHashlib())
runpy.run_path(sys.argv[1], run_name='__main__')
"""


class GatewaySetupModeTest(unittest.TestCase):
    def test_optimized_setup_exits_before_importing_dependencies(self):
        script = Path(__file__).with_name('stack-gateway-setup.py')
        result = subprocess.run(
            [sys.executable, '-I', '-S', '-O', '-c', BLOCK_FIRST_DEPENDENCY, str(script)],
            capture_output=True, text=True, timeout=10,
        )
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, '')
        self.assertEqual(result.stderr.strip(),
                         'Gateway setup requires Python assertions to be enabled')
