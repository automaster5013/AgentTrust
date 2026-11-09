"""Verify the audit period entrypoints refuse optimization before stack access."""
from pathlib import Path
import subprocess
import sys
import unittest


class AuditPeriodModeTest(unittest.TestCase):
    def test_optimized_search_and_export_refuse_before_stack_imports(self):
        for operation in ("search", "export"):
            with self.subTest(operation=operation):
                script = Path(__file__).with_name(f"stack-audit-period-{operation}-smoke.py")
                # Isolated mode excludes adjacent stack helpers even if the guard regresses.
                result = subprocess.run(
                    [sys.executable, "-I", "-S", "-O", str(script), "--execute"],
                    capture_output=True, text=True, timeout=10,
                )
                self.assertEqual(result.returncode, 1)
                self.assertEqual(result.stdout, "")
                self.assertEqual(
                    result.stderr.strip(),
                    f"Audit period {operation} smoke test requires Python assertions to be enabled",
                )
