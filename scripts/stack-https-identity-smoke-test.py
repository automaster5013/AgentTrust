"""Actual process refusal controls; Docker is unavailable on the test PATH."""
import json
import os
import pathlib
import subprocess
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
SCRIPT = ROOT / 'scripts/stack-https-identity-smoke.py'


class HttpsFixtureProcessBoundaryTest(unittest.TestCase):
    def invoke(self, arguments, ci='false', actions='false'):
        environment = dict(os.environ, PATH='', CI=ci, GITHUB_ACTIONS=actions)
        before = {p.name for p in (ROOT / '.local').glob('stack-https-identity-*')}
        result = subprocess.run([sys.executable, str(SCRIPT), *arguments], cwd=ROOT,
            env=environment, capture_output=True, text=True, encoding='utf-8', timeout=15)
        after = {p.name for p in (ROOT / '.local').glob('stack-https-identity-*')}
        self.assertEqual(before, after)
        self.assertFalse(result.stderr)
        return result.returncode, json.loads(result.stdout)

    def test_default_plan_does_not_contact_docker_even_in_ci(self):
        code, value = self.invoke([], 'true', 'true')
        self.assertEqual(code, 0)
        self.assertTrue(value['completed'])
        self.assertFalse(value['executed'])
        self.assertFalse(value['actualTlsLoginVerified'])
        self.assertFalse(value['productionDeploymentPerformed'])

    def test_explicit_execution_requires_both_exact_ci_markers(self):
        for ci, actions in [('false', 'false'), ('true', 'false'), ('false', 'true'), ('TRUE', 'true')]:
            with self.subTest(ci=ci, actions=actions):
                code, value = self.invoke(['--execute'], ci, actions)
                self.assertEqual(code, 1)
                self.assertEqual(value['code'], 'SYNTHETIC_HTTPS_PREFLIGHT_REFUSED')
                self.assertFalse(value['executed'])


if __name__ == '__main__':
    unittest.main()
