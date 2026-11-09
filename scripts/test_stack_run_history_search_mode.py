"""Verify run history search planning and execution under optimized Python."""
import json
from pathlib import Path
import subprocess
import sys
import unittest


class RunHistorySearchModeTest(unittest.TestCase):
    def test_plan_remains_available_and_execution_refuses_optimization(self):
        script = Path(__file__).with_name("stack-run-history-search-smoke.py")
        # Isolated mode excludes adjacent stack helpers even if the guard regresses.
        command = [sys.executable, "-I", "-S", "-O", str(script)]
        plan = subprocess.run(command, capture_output=True, text=True, timeout=10)
        self.assertEqual(plan.returncode, 0)
        self.assertEqual(plan.stderr, "")
        self.assertIs(json.loads(plan.stdout)["executed"], False)

        result = subprocess.run(command + ["--execute"], capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, "")
        self.assertEqual(
            result.stderr.strip(),
            "Run history search smoke test requires Python assertions to be enabled",
        )
