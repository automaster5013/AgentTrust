"""Check that ownership-sensitive smoke tests refuse optimized Python."""
from pathlib import Path
import subprocess
import sys
import unittest


class StackOwnershipModeTest(unittest.TestCase):
    def test_optimized_smoke_tests_refuse_before_stack_imports(self):
        entrypoints = {
            "cancellation": "Cancellation",
            "observability-outage": "Observability outage",
            "gateway": "Gateway",
            "object": "Object storage",
            "campaign-archive": "Campaign archive",
            "audit": "Audit navigation",
            "audit-export": "Audit export",
        }
        for name, label in entrypoints.items():
            with self.subTest(entrypoint=name):
                script = Path(__file__).with_name(f"stack-{name}-smoke.py")
                # Exclude adjacent stack helpers even if a guard regresses.
                result = subprocess.run(
                    [sys.executable, "-I", "-S", "-O", str(script)],
                    capture_output=True, text=True, timeout=10,
                )
                self.assertEqual(result.returncode, 1)
                self.assertEqual(result.stdout, "")
                self.assertEqual(
                    result.stderr.strip(),
                    f"{label} smoke test requires Python assertions to be enabled",
                )
