"""Check the mode guard without running any OIDC endpoint proxy smoke test operations."""
from pathlib import Path
import subprocess
import sys
import unittest


BLOCK_FIRST_DEPENDENCY = """
import runpy
import sys


class BlockDatetime:
    def find_spec(self, fullname, path=None, target=None):
        if fullname == 'datetime':
            raise RuntimeError('OIDC endpoint proxy smoke test attempted to import datetime')


if 'datetime' in sys.modules:
    raise RuntimeError('Isolation requires datetime to be absent')
sys.meta_path.insert(0, BlockDatetime())
runpy.run_path(sys.argv[1], run_name='__main__')
"""


class OidcProxyModeTest(unittest.TestCase):
    def test_optimized_setup_exits_before_importing_dependencies(self):
        script = Path(__file__).with_name('stack-oidc-endpoint-proxy-smoke.py')
        result = subprocess.run(
            [sys.executable, '-I', '-S', '-O', '-c', BLOCK_FIRST_DEPENDENCY, str(script)],
            capture_output=True, text=True, timeout=10,
        )
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, '')
        self.assertEqual(result.stderr.strip(),
                         'OIDC endpoint proxy smoke test requires Python assertions to be enabled')
