"""Check the mode guard without running any signing setup operations."""
from pathlib import Path
import subprocess
import sys
import unittest


BLOCK_FIRST_DEPENDENCY = """
import runpy
import sys


class BlockArgparse:
    def find_spec(self, fullname, path=None, target=None):
        if fullname == 'argparse':
            raise RuntimeError('Signing setup attempted to import argparse')


if 'argparse' in sys.modules:
    raise RuntimeError('Isolation requires argparse to be absent')
sys.meta_path.insert(0, BlockArgparse())
runpy.run_path(sys.argv[1], run_name='__main__')
"""


class GateSigningSetupModeTest(unittest.TestCase):
    def test_optimized_setup_exits_before_importing_dependencies(self):
        script = Path(__file__).with_name('stack-gate-signing-setup.py')
        result = subprocess.run(
            [sys.executable, '-I', '-S', '-O', '-c', BLOCK_FIRST_DEPENDENCY, str(script)],
            capture_output=True, text=True, timeout=10,
        )
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, '')
        self.assertEqual(result.stderr.strip(),
                         'Gate signing setup requires Python assertions to be enabled')
