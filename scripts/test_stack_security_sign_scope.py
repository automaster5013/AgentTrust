"""Reject foreign signing contexts before any evidence or signing operation."""
import os
from pathlib import Path
import subprocess
import sys
import unittest


class SecuritySigningScopeTest(unittest.TestCase):
    def test_foreign_scope_is_refused_before_revision_lookup(self):
        script = Path(__file__).with_name('stack-security-sign.py')
        for invalid_scope in (
            {'GITHUB_ACTIONS': 'false'},
            {'GITHUB_REPOSITORY': 'synthetic/foreign'},
            {'GITHUB_REF': 'refs/heads/synthetic'},
        ):
            with self.subTest(invalid_scope=invalid_scope):
                env = dict(os.environ, GITHUB_ACTIONS='true',
                           GITHUB_REPOSITORY='automaster5013/AgentTrust',
                           GITHUB_REF='refs/heads/main')
                # A scope regression still stops before any evidence reads.
                env.pop('GITHUB_SHA', None)
                env.update(invalid_scope)
                args = ['-O'] if sys.flags.optimize else []
                result = subprocess.run([sys.executable, *args, str(script)], env=env,
                                        capture_output=True, text=True, timeout=10)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('ValueError: Signing evidence or scope refused', result.stderr)
                self.assertEqual(result.stdout, '')
