"""Synthetic public metadata only; no registry or runtime operations."""
import copy
import hashlib
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest

from stack_https_release_profile import DEPENDENCIES, EVIDENCE_FILE, FALSE_FIELDS, TRUE_FIELDS

ROOT = pathlib.Path(__file__).resolve().parent.parent
NAMES = ('core-api', 'ai-worker', 'console', 'console-https', 'opa', 'identity', 'gateway',
         'object-store', 'database', 'local-model', 'messaging', 'telemetry', 'tempo', 'loki',
         'prometheus', 'quality-verifier')


class DeliveryManifestTest(unittest.TestCase):
    def fixture(self):
        revision = '1' * 40
        images = {n: f'ghcr.io/automaster5013/agenttrust-{n}@sha256:' + '2' * 64 for n in NAMES}
        ids = {n: 'sha256:' + '3' * 64 for n in NAMES}
        profile = {'schemaVersion': 1, 'profile': 'https-review',
                   'applicationOrigin': 'https://console.example.com',
                   'publicIssuer': 'https://identity.example.com/realms/agenttrust',
                   'revision': revision, 'reference': images['console-https'],
                   'imageId': ids['console-https'], 'fixtureSummarySha256': '4' * 64,
                   'runtimeDependencies': {n: ids[n] for n in DEPENDENCIES},
                   'nativeBrowserLogins': 4, 'federatedBrowserLogins': 4,
                   **{n: True for n in TRUE_FIELDS}, **{n: False for n in FALSE_FIELDS}}
        raw = json.dumps(profile).encode()
        identity = {'revision': revision, 'images': copy.deepcopy(images), 'imageIds': ids,
                    'runtimeImageIdentityVerified': True, 'identityProvider': 'keycloak',
                    'httpsConsoleProfileRuntimeVerified': True,
                    'httpsConsoleProfileEvidence': EVIDENCE_FILE,
                    'httpsConsoleProfileEvidenceSha256': hashlib.sha256(raw).hexdigest()}
        return revision, images, raw, identity

    def invoke(self, mutate=None):
        revision, images, raw, identity = self.fixture()
        if mutate:
            mutate(images, identity)
        base = ROOT / '.local'
        base.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='manifest-unit-', dir=base) as scratch:
            directory = pathlib.Path(scratch) / 'stack-delivery'
            directory.mkdir()
            (directory / 'revision.txt').write_text(revision, encoding='utf-8')
            for name, reference in images.items():
                (directory / (name + '.txt')).write_text(reference, encoding='utf-8')
            (directory / EVIDENCE_FILE).write_bytes(raw)
            (directory / 'runtime-identity.json').write_text(json.dumps(identity), encoding='utf-8')
            optimized = ['-O'] if sys.flags.optimize else []
            result = subprocess.run([sys.executable, *optimized, str(ROOT / 'scripts/stack-delivery-manifest.py')],
                                    cwd=scratch, capture_output=True, timeout=15)
            return result.returncode, (directory / 'manifest.json').exists()

    def test_consistent_synthetic_metadata_creates_manifest(self):
        self.assertEqual(self.invoke(), (0, True))

    def test_revision_mismatch_is_refused(self):
        self.assertNotEqual(self.invoke(lambda images, identity: identity.update(revision='5' * 40))[0], 0)

    def test_image_map_mismatch_is_refused(self):
        self.assertEqual(self.invoke(lambda images, identity: identity['images'].update(console='foreign')), (1, False))

    def test_unverified_runtime_is_refused(self):
        self.assertEqual(self.invoke(lambda images, identity: identity.update(runtimeImageIdentityVerified=False)), (1, False))

    def test_profile_hash_mismatch_is_refused(self):
        self.assertEqual(self.invoke(lambda images, identity: identity.update(httpsConsoleProfileEvidenceSha256='0' * 64)), (1, False))

    def test_mutable_reference_is_refused(self):
        def mutate(images, identity):
            images['console'] = 'ghcr.io/automaster5013/agenttrust-console:latest'
            identity['images'] = copy.deepcopy(images)
        self.assertEqual(self.invoke(mutate), (1, False))


if __name__ == '__main__':
    unittest.main()
