"""The explicit offline fixture must refuse before Docker outside its CI scope."""
import json
import os
import pathlib
import subprocess
import sys
import unittest

SCRIPT = pathlib.Path(__file__).with_name('stack-delivery-offline-smoke.py')


class ExecutionBoundary(unittest.TestCase):
    def test_default_plan_does_not_execute(self):
        result = subprocess.run([sys.executable, str(SCRIPT)], capture_output=True, text=True, timeout=10)
        self.assertEqual(0, result.returncode)
        self.assertEqual({'completed': True, 'executed': False, 'productionDeploymentPerformed': False}, json.loads(result.stdout))

    def test_each_foreign_ci_scope_is_refused_before_docker_or_private_directory(self):
        root = SCRIPT.resolve().parent.parent / '.local'
        before = set(root.glob('stack-delivery-offline-*'))
        base = dict(os.environ, CI='true', GITHUB_ACTIONS='true', GITHUB_REPOSITORY='automaster5013/AgentTrust',
            GITHUB_REF='refs/heads/main', GITHUB_SHA='1' * 40)
        for key, value in [('CI', 'false'), ('GITHUB_ACTIONS', 'false'), ('GITHUB_REPOSITORY', 'foreign/repository'),
                ('GITHUB_REF', 'refs/heads/foreign')]:
            env = dict(base); env[key] = value
            result = subprocess.run([sys.executable, str(SCRIPT), '--execute'], env=env,
                capture_output=True, text=True, timeout=10)
            self.assertEqual(1, result.returncode)
            self.assertEqual('OFFLINE_DELIVERY_FIXTURE_REFUSED', json.loads(result.stdout)['code'])
        self.assertEqual(before, set(root.glob('stack-delivery-offline-*')))


if __name__ == '__main__': unittest.main()
