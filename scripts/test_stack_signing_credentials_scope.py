"""Verify registry credential setup rejects synthetic invalid inputs before writes."""
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest


class SigningCredentialsScopeTest(unittest.TestCase):
    def test_foreign_repository_rejected_before_reading_actor(self):
        self.check_refusal('synthetic/foreign',
                           'Registry credential setup requires the authorized CI repository')

    def test_missing_credentials_rejected_before_preparing_directory(self):
        self.check_refusal('automaster5013/AgentTrust',
                           'Registry credential setup received invalid CI credentials')

    def check_refusal(self, repository, message):
        script = Path(__file__).with_name('stack-signing-setup.py')
        env = {**os.environ, 'GITHUB_ACTIONS': 'true', 'GITHUB_REPOSITORY': repository}
        env.pop('GITHUB_ACTOR', None)
        env.pop('STACK_REGISTRY_TOKEN', None)
        with TemporaryDirectory() as folder:
            root = Path(folder)
            isolated_script = root / 'scripts' / script.name
            isolated_script.parent.mkdir()
            isolated_script.write_bytes(script.read_bytes())
            for mode in ([], ['-O']):
                with self.subTest(mode=mode):
                    result = subprocess.run(
                        [sys.executable, '-I', '-S', *mode, str(isolated_script)],
                        env=env, capture_output=True, text=True, timeout=10,
                    )
                    self.assertEqual(result.returncode, 1)
                    self.assertEqual(result.stdout, '')
                    self.assertEqual(result.stderr.strip(), message)
            self.assertFalse((root / '.local').exists())
