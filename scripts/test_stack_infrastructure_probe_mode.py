"""Check that the offline probe refuses optimized mode before running its body."""
from pathlib import Path
import subprocess
import sys
import unittest


class InfrastructureProbeModeTest(unittest.TestCase):
    def test_optimized_mode_refuses_before_importing_dependencies(self):
        script = Path(__file__).with_name('stack-infrastructure-probe.py')
        # -S also prevents the pre-fix script from reaching any tool calls.
        result = subprocess.run([sys.executable, '-I', '-S', '-O', str(script)],
                                capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, '')
        self.assertEqual(result.stderr.strip(),
                         'Infrastructure probe requires Python assertions to be enabled')
