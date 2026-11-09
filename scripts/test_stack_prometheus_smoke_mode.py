"""Check the mode guard without running any Prometheus smoke test operations."""
import ast
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
            raise RuntimeError('Prometheus smoke test attempted to import datetime')


if 'datetime' in sys.modules:
    raise RuntimeError('Isolation requires datetime to be absent')
sys.meta_path.insert(0, BlockDatetime())
runpy.run_path(sys.argv[1], run_name='__main__')
"""


class PrometheusSmokeModeTest(unittest.TestCase):
    def test_optimized_setup_exits_before_importing_dependencies(self):
        script = Path(__file__).with_name('stack-prometheus-smoke.py')
        result = subprocess.run(
            [sys.executable, '-I', '-S', '-O', '-c', BLOCK_FIRST_DEPENDENCY, str(script)],
            capture_output=True, text=True, timeout=10,
        )
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, '')
        self.assertEqual(result.stderr.strip(),
                         'Prometheus smoke test requires Python assertions to be enabled')


    def test_optimized_embedded_probe_refuses_before_loading_http_client(self):
        script = Path(__file__).with_name('stack-prometheus-smoke.py')
        probe = next(
            item.value.value for item in ast.walk(ast.parse(script.read_bytes()))
            if isinstance(item, ast.Assign)
            and any(isinstance(target, ast.Name) and target.id == 'code'
                    for target in item.targets)
        )
        result = subprocess.run(
            [sys.executable, '-I', '-S', '-O', '-c', probe],
            capture_output=True, text=True, timeout=10,
        )
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, '')
        self.assertEqual(result.stderr.strip(),
                         'Prometheus browser probe requires Python assertions to be enabled')
