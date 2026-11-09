"""Check the unresolved baseline smoke test without accessing the stack."""
from pathlib import Path
import subprocess
import sys
import unittest


class BaselineUnresolvedModeTest(unittest.TestCase):
    def test_optimized_mode_refuses_before_importing_stack_helpers(self):
        script = Path(__file__).with_name("stack-baseline-unresolved-smoke.py")
        # Isolated mode excludes adjacent stack helpers even if the guard regresses.
        result = subprocess.run(
            [sys.executable, "-I", "-S", "-O", str(script)],
            capture_output=True, text=True, timeout=10,
        )
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, "")
        self.assertEqual(
            result.stderr.strip(),
            "Unresolved baseline smoke test requires Python assertions to be enabled",
        )
