"""Synthetic audit delivery boundaries; no Docker, registry or signing credentials."""
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).with_name('stack-audit-candidate-delivery.py')
spec = importlib.util.spec_from_file_location('audit_delivery', SCRIPT)
delivery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(delivery)
REVISION = 'a' * 40


class AuditDeliveryTests(unittest.TestCase):
    def setUp(self):
        scratch = SCRIPT.parent.parent / '.local'
        scratch.mkdir(exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(prefix='audit-delivery-unit-', dir=scratch)
        self.addCleanup(self.temporary.cleanup)
        self.folder = Path(self.temporary.name)
        self.addCleanup(patch.stopall)
        patch.object(delivery, 'BUNDLE', self.folder).start()
        self.verifier = patch.object(delivery, 'cosign').start()

    def write(self, name, value):
        (self.folder / name).write_text(json.dumps(value), encoding='utf-8')

    def checksums(self):
        self.write('checksums.json', {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                   for p in self.folder.iterdir() if p.name != 'checksums.json'})

    def fixture(self):
        images = {}
        for name in delivery.CONTEXTS:
            images[name] = f'ghcr.io/automaster5013/agenttrust-{name}@sha256:' + '1' * 64
            sbom = {'bomFormat': 'CycloneDX', 'components': []}
            self.write(name + '.cdx.json', sbom)
            self.write(name + '.trivy.json', {'SchemaVersion': 2, 'Results': [{}]})
            for suffix, predicate in (('signature', {}), ('sbom', sbom)):
                statement = {'subject': [{'digest': {'sha256': '1' * 64}}], 'predicate': predicate}
                self.write(name + '.' + suffix + '.bundle.json', {'dsseEnvelope': {
                    'payload': base64.b64encode(json.dumps(statement).encode()).decode()}})
        self.write('manifest.json', {'revision': REVISION, 'ref': delivery.REF, 'images': images})
        self.checksums()

    def test_structural_fixture_requires_six_external_verifications_bound_to_revision(self):
        self.fixture()
        with patch('builtins.print'):
            delivery.verify(REVISION)
        self.assertEqual(self.verifier.call_count, 6)
        for call in self.verifier.call_args_list:
            arguments = call.args[0]
            self.assertEqual(arguments[arguments.index('--certificate-github-workflow-sha') + 1], REVISION)
            self.assertEqual(arguments[arguments.index('--certificate-identity') + 1], delivery.IDENTITY)

    def test_wrong_cohort_revision_or_ref_refused_before_verifier(self):
        for key, value in (('revision', 'b' * 40), ('ref', 'refs/heads/foreign'), ('images', {})):
            with self.subTest(key=key):
                self.fixture()
                manifest = json.loads((self.folder / 'manifest.json').read_bytes())
                manifest[key] = value
                self.write('manifest.json', manifest)
                with self.assertRaises(ValueError):
                    delivery.verify(REVISION)
                self.verifier.assert_not_called()

    def test_substituted_bytes_and_extra_files_refused(self):
        self.fixture()
        path = self.folder / 'core-api.trivy.json'
        path.write_bytes(path.read_bytes() + b'\n')
        with self.assertRaises(ValueError):
            delivery.verify(REVISION)
        self.fixture()
        (self.folder / 'unexpected').write_bytes(b'synthetic')
        with self.assertRaises(ValueError):
            delivery.verify(REVISION)

    def test_vulnerability_report_refused_even_with_matching_checksums(self):
        self.fixture()
        self.write('core-api.trivy.json', {'SchemaVersion': 2, 'Results': [
            {'Vulnerabilities': [{'Severity': 'HIGH'}]}]})
        self.checksums()
        with self.assertRaises(ValueError):
            delivery.verify(REVISION)

    def test_optimized_python_refuses_empty_foreign_cohort_without_external_verifier(self):
        self.write('manifest.json', {'revision': 'b' * 40, 'ref': 'refs/heads/foreign', 'images': {}})
        self.write('checksums.json', {})
        code = ('import importlib.util,pathlib,sys; '
                's=importlib.util.spec_from_file_location("audit_delivery",sys.argv[1]); '
                'm=importlib.util.module_from_spec(s); s.loader.exec_module(m); '
                'm.BUNDLE=pathlib.Path(sys.argv[2]); '
                'm.cosign=lambda *a,**k: sys.exit(99); m.verify("a"*40)')
        result = subprocess.run([sys.executable, '-O', '-c', code, str(SCRIPT), str(self.folder)],
                                capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 1)
        self.assertNotIn('verifiedImages', result.stdout)

    def test_optimized_cli_refuses_foreign_scope_before_bundle_or_docker_access(self):
        env = dict(os.environ, GITHUB_ACTIONS='false', GITHUB_REPOSITORY='foreign/repository',
                   GITHUB_SHA=REVISION)
        result = subprocess.run([sys.executable, '-O', str(SCRIPT), 'verify'], env=env,
                                capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 1)
        self.assertIn('Audit candidate verification refused', result.stderr)
        self.assertNotIn('verifiedImages', result.stdout)


if __name__ == '__main__':
    unittest.main()
