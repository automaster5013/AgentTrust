"""Verify request resolution entrypoints refuse optimization before stack access."""
from pathlib import Path
import subprocess
import sys
import unittest


class RequestResolutionModeTest(unittest.TestCase):
    def test_optimized_mode_refuses_before_stack_imports(self):
        for kind in ("campaign", "evaluation"):
            with self.subTest(kind=kind):
                script = Path(__file__).with_name(f"stack-{kind}-request-resolution-smoke.py")
                # Isolated mode excludes adjacent stack helpers if a guard regresses.
                result = subprocess.run(
                    [sys.executable, "-I", "-S", "-O", str(script)],
                    capture_output=True, text=True, timeout=10,
                )
                self.assertEqual(result.returncode, 1)
                self.assertEqual(result.stdout, "")
                self.assertEqual(
                    result.stderr.strip(),
                    f"{kind.capitalize()} request resolution smoke test requires Python assertions to be enabled",
                )
