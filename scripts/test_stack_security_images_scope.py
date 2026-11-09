"""Invalid scan inputs must be refused before scratch or Docker access."""
import os
from pathlib import Path
import runpy
import unittest
from unittest.mock import patch


class ImageScanScopeTest(unittest.TestCase):
    def reject(self, environment):
        script = Path(__file__).with_name('stack-security-images.py')
        with patch.dict(os.environ, environment, clear=True), \
                patch.object(Path, 'mkdir', side_effect=RuntimeError('Unexpected scratch access')) as mkdir, \
                patch.object(Path, 'chmod', side_effect=RuntimeError('Unexpected permission change')) as chmod, \
                patch('subprocess.run', side_effect=RuntimeError('Unexpected process launch')) as run:
            with self.assertRaisesRegex(ValueError, 'Image scan evidence or scope refused'):
                runpy.run_path(str(script))
            mkdir.assert_not_called()
            chmod.assert_not_called()
            run.assert_not_called()

    def test_foreign_audit_scope_is_refused(self):
        self.reject({'AGENTTRUST_AUDIT_IMAGE_SCOPE': '1', 'GITHUB_ACTIONS': 'false'})

    def test_audit_scope_requires_all_three_references(self):
        self.reject({
            'AGENTTRUST_AUDIT_IMAGE_SCOPE': '1',
            'GITHUB_ACTIONS': 'true',
            'GITHUB_REPOSITORY': 'automaster5013/AgentTrust',
            'GITHUB_REF': 'refs/heads/codex/audit-release-integration-20261104',
            'GITHUB_EVENT_NAME': 'workflow_dispatch',
        })

    def test_invalid_registry_reference_is_refused(self):
        self.reject({'STACK_CORE_IMAGE': 'synthetic/invalid:mutable'})
