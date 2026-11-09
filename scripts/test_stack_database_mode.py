"""Check database boundary mode refusal before stack access."""
from pathlib import Path
import subprocess
import sys
import unittest


RUN_WITHOUT_COMMANDS = """
import runpy
import sys

def refuse_command(event, args):
    if event == 'subprocess.Popen':
        raise SystemExit('Unexpected subprocess request')

sys.addaudithook(refuse_command)
runpy.run_path(sys.argv[1], run_name='__main__')
"""


class DatabaseBoundaryModeTest(unittest.TestCase):
    def test_optimized_mode_refuses_before_stack_imports(self):
        script = Path(__file__).with_name("stack-database-smoke.py")
        # The child audit hook blocks Docker if the mode check regresses.
        result = subprocess.run(
            [sys.executable, "-I", "-S", "-O", "-c", RUN_WITHOUT_COMMANDS, str(script)],
            capture_output=True, text=True, timeout=10,
        )
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, "")
        self.assertEqual(
            result.stderr.strip(),
            "Database boundary smoke test requires Python assertions to be enabled",
        )
