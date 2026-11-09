"""Verify admission-sensitive smoke tests refuse optimization before stack access."""
from pathlib import Path
import subprocess
import sys
import unittest


class StackAdmissionModeTest(unittest.TestCase):
    def test_optimized_smoke_tests_refuse_before_stack_imports(self):
        entrypoints = {
            "review-precondition": "Review precondition",
            "policy": "Policy",
            "provider": "Provider",
            "campaign-model": "Campaign model",
            "audit-search": "Audit search",
        }
        for name, label in entrypoints.items():
            with self.subTest(entrypoint=name):
                script = Path(__file__).with_name(f"stack-{name}-smoke.py")
                command = [sys.executable, "-I", "-S", "-O", str(script)]
                if name == "review-precondition":
                    command.append("--allow-synthetic-writes")
                # Isolated mode keeps adjacent stack helpers out of the subprocess.
                result = subprocess.run(command, capture_output=True, text=True, timeout=10)
                self.assertEqual(result.returncode, 1)
                self.assertEqual(result.stdout, "")
                self.assertEqual(
                    result.stderr.strip(),
                    f"{label} smoke test requires Python assertions to be enabled",
                )
