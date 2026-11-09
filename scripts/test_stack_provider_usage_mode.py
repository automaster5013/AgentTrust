"""Verify the provider usage smoke test refuses optimization before stack access."""
from pathlib import Path
import subprocess
import sys
import unittest


class ProviderUsageModeTest(unittest.TestCase):
    def test_optimized_mode_refuses_before_stack_imports(self):
        script = Path(__file__).with_name("stack-provider-usage-smoke.py")
        # Isolated mode excludes adjacent stack helpers if the guard regresses.
        result = subprocess.run(
            [sys.executable, "-I", "-S", "-O", str(script)],
            capture_output=True, text=True, timeout=10,
        )
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, "")
        self.assertEqual(
            result.stderr.strip(),
            "Provider usage smoke test requires Python assertions to be enabled",
        )
