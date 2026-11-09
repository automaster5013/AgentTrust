"""Verify provider and identity smoke tests refuse optimized Python."""
from pathlib import Path
import subprocess
import sys
import unittest


RUN_WITHOUT_SIDE_EFFECTS = """
import runpy
import sys

def reject_operations(event, args):
    if event in ('os.mkdir', 'subprocess.Popen', 'socket.connect'):
        raise RuntimeError('Smoke test reached a fixture operation')

sys.addaudithook(reject_operations)
runpy.run_path(sys.argv[1], run_name='__main__')
"""


class StackProviderIdentityModeTest(unittest.TestCase):
    def test_optimized_smoke_tests_refuse_before_fixture_operations(self):
        entrypoints = {
            "provider-integrity": "Provider integrity",
            "quality-campaign": "Quality campaign",
            "identity": "Identity",
        }
        for name, label in entrypoints.items():
            with self.subTest(entrypoint=name):
                script = Path(__file__).with_name(f"stack-{name}-smoke.py")
                result = subprocess.run(
                    [sys.executable, "-I", "-S", "-O", "-c", RUN_WITHOUT_SIDE_EFFECTS, str(script)],
                    capture_output=True, text=True, timeout=10,
                )
                self.assertEqual(result.returncode, 1)
                self.assertEqual(result.stdout, "")
                self.assertEqual(
                    result.stderr.strip(),
                    f"{label} smoke test requires Python assertions to be enabled",
                )
