"""Adversarial retained-key and fresh-process snapshot contracts; no Docker calls."""
import base64
import hashlib
import importlib.util
import io
import json
import os
import pathlib
import subprocess
import tarfile
import tempfile
import types
import unittest
import uuid
from unittest.mock import Mock, patch
from stack_backup_custody import retained_key, key_unchanged
from stack_coherent_archive import SERVICES, STATEFUL
import stack_backup_tools as backup_tools

ROOT = pathlib.Path(__file__).resolve().parent.parent


def module(name, file):
    spec = importlib.util.spec_from_file_location(name, pathlib.Path(__file__).with_name(file))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


verifier = module('snapshot_verifier_contract', 'stack-coherent-snapshot-verify.py')
envelope = module('snapshot_envelope_contract', 'stack-backup-crypt.py')


class SnapshotCustodyTests(unittest.TestCase):
    def setUp(self):
        (ROOT / '.local').mkdir(exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(prefix='backup-custody-contract-', dir=ROOT / '.local')
        self.addCleanup(self.temporary.cleanup)
        self.root = pathlib.Path(self.temporary.name)
        self.snapshot_id, self.revision = str(uuid.uuid4()), 'a' * 40
        self.snapshot = self.root / '.local' / ('snapshot-' + self.snapshot_id)
        self.snapshot.mkdir(parents=True)
        self.key_directory = self.root / '.local' / 'separate-keys'
        self.key_directory.mkdir(mode=0o777 if os.name == 'nt' else 0o700)
        self.key = self.key_directory / 'contract-only.bin'
        self.secret = bytes(range(32))
        self.key.write_bytes(self.secret)
        if os.name == 'nt':
            owner = subprocess.check_output(['whoami'], text=True).strip()
            for item in (self.key_directory, self.key):
                subprocess.run(['icacls', str(item), '/inheritance:r', '/grant:r', owner + ':F', 'SYSTEM:F'], capture_output=True, check=True)
        else:
            self.key.chmod(0o600)
        archive = io.BytesIO()
        with tarfile.open(fileobj=archive, mode='w:gz') as stream:
            entry = tarfile.TarInfo('data/evidence')
            entry.size, entry.mode = 7, 0o600
            stream.addfile(entry, io.BytesIO(b'fixture'))
        self.plaintext = {s: archive.getvalue() for s in STATEFUL}
        self.configuration = {s: {'imageId': 'sha256:' + 'b' * 64} for s in SERVICES}
        self.write_snapshot()

    def write_snapshot(self):
        self.plaintext['configuration'] = json.dumps(self.configuration).encode()
        components = {}
        for component, raw in self.plaintext.items():
            cipher = envelope.transform('encrypt', self.secret, raw)
            (self.snapshot / (component + '.aesgcm')).write_bytes(cipher)
            components[component] = {'bytes': len(cipher), 'sha256': hashlib.sha256(cipher).hexdigest()}
        self.manifest = {'schema': 1, 'snapshotId': self.snapshot_id, 'revision': self.revision,
                         'services': {s: {'imageId': 'sha256:' + 'b' * 64, 'containerId': 'c' * 64} for s in SERVICES},
                         'components': components,
                         'quiescence': {'allWritersStopped': True, 'allStatefulServicesStopped': True, 'pendingEvaluations': 0}}
        self.write_manifest()

    def write_manifest(self):
        cipher = envelope.transform('encrypt', self.secret, json.dumps(self.manifest).encode())
        (self.snapshot / 'manifest.aesgcm').write_bytes(cipher)
        self.anchor = hashlib.sha256(cipher).hexdigest()

    def verify(self, **overrides):
        args = dict(root=self.root, directory=self.snapshot, key_file=self.key, snapshot_id=self.snapshot_id,
                    revision=self.revision, manifest_sha256=self.anchor,
                    decrypt=lambda raw: envelope.transform('decrypt', self.secret, raw))
        args.update(overrides)
        return verifier.verify(**args)

    def test_real_authenticated_archives_verify_without_disk_plaintext_or_runtime_creation(self):
        before = {p.name: p.read_bytes() for p in self.snapshot.iterdir()}
        value = self.verify()
        self.assertTrue(value['completed'])
        self.assertEqual((value['authenticatedEncryptedComponents'], value['statefulArchivesVerified'], value['imageIdsBound']), (6, 5, 11))
        self.assertFalse(value['actualRecoveryPerformed'])
        self.assertFalse(value['operationalBackupVerified'])
        self.assertFalse(value['plaintextWrittenToHostDisk'])
        self.assertEqual(before, {p.name: p.read_bytes() for p in self.snapshot.iterdir()})
        self.assertEqual(self.key.read_bytes(), self.secret)

    def test_wrong_independent_digest_rejects_before_decryption(self):
        decrypt = Mock()
        with self.assertRaises(ValueError):
            self.verify(manifest_sha256='f' * 64, decrypt=decrypt)
        decrypt.assert_not_called()

    def test_recomputed_checksum_cannot_authenticate_modified_manifest(self):
        path = self.snapshot / 'manifest.aesgcm'
        raw = bytearray(path.read_bytes());raw[-1] ^= 1;path.write_bytes(raw)
        with self.assertRaises(Exception):
            self.verify(manifest_sha256=hashlib.sha256(raw).hexdigest())

    def test_wrong_key_rejects_authenticated_manifest(self):
        with self.assertRaises(Exception):
            self.verify(decrypt=lambda raw: envelope.transform('decrypt', bytes(reversed(range(32))), raw))

    def test_snapshot_and_revision_cannot_be_substituted(self):
        for change in ({'snapshot_id': str(uuid.uuid4())}, {'revision': 'd' * 40}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.verify(**change)

    def test_modified_component_rejected_before_extraction(self):
        path = self.snapshot / 'stack-db.aesgcm'
        raw = bytearray(path.read_bytes());raw[-1] ^= 1;path.write_bytes(raw)
        with self.assertRaises(ValueError):
            self.verify()

    def test_even_authenticated_foreign_configuration_image_is_refused(self):
        self.configuration['stack-core-api']['imageId'] = 'sha256:' + 'e' * 64
        self.write_snapshot()
        with self.assertRaises(ValueError):
            self.verify()

    def test_duplicate_or_nonfinite_manifest_json_is_refused(self):
        for raw in (b'{"schema":1,"schema":1}', b'{"schema":NaN}'):
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                verifier.document(raw)

    def test_key_size_and_location_are_refused_without_changing_bytes(self):
        self.key.write_bytes(b'bad')
        with self.assertRaises(ValueError):
            retained_key(self.root, self.key)
        self.assertEqual(self.key.read_bytes(), b'bad')
        self.key.write_bytes(self.secret)
        outside = self.root / 'outside.bin';outside.write_bytes(self.secret)
        with self.assertRaises(ValueError):
            retained_key(self.root, outside)

    def test_snapshot_and_key_cannot_share_a_directory(self):
        shared = self.snapshot / 'retained.bin';shared.write_bytes(self.secret)
        with patch.object(verifier, 'retained_key', return_value=(shared, hashlib.sha256(self.secret).digest())):
            with self.assertRaises(ValueError):
                self.verify(key_file=shared)

    def test_key_change_is_detected_and_not_repaired_or_deleted(self):
        path, fingerprint = retained_key(self.root, self.key)
        self.key.write_bytes(b'x' * 32)
        self.assertFalse(key_unchanged(path, fingerprint))
        self.assertEqual(self.key.read_bytes(), b'x' * 32)

    def test_broad_key_access_is_refused(self):
        if os.name == 'nt':
            subprocess.run(['icacls', str(self.key), '/grant', '*S-1-1-0:R'], capture_output=True, check=True)
        else:
            self.key.chmod(0o644)
        with self.assertRaises(ValueError):
            retained_key(self.root, self.key)

    def test_only_specific_invalid_tag_is_a_crypto_authentication_rejection(self):
        inspection = types.SimpleNamespace(stdout=json.dumps([{'Id': 'sha256:' + 'd' * 64}]).encode())
        refused = types.SimpleNamespace(returncode=1, stderr=b'BACKUP_STREAM_REFUSED InvalidTag\n', stdout=b'')
        with patch.object(backup_tools, 'run', side_effect=[inspection, refused]), patch.object(backup_tools.os, 'getuid', return_value=1001, create=True):
            with self.assertRaises(backup_tools.BackupAuthenticationError):
                backup_tools.crypt(self.root, self.key, 'decrypt', b'encrypted-manifest')

    def test_engine_outage_and_other_helper_errors_cannot_pass_wrong_key_control(self):
        inspection = types.SimpleNamespace(stdout=json.dumps([{'Id': 'sha256:' + 'd' * 64}]).encode())
        for code, stderr in ((125, b'Docker unavailable'), (1, b'BACKUP_STREAM_REFUSED ValueError\n'), (125, b'BACKUP_STREAM_REFUSED InvalidTag\n')):
            refused = types.SimpleNamespace(returncode=code, stderr=stderr, stdout=b'')
            with self.subTest(code=code, stderr=stderr), patch.object(backup_tools, 'run', side_effect=[inspection, refused]), patch.object(backup_tools.os, 'getuid', return_value=1001, create=True):
                with self.assertRaises(RuntimeError):
                    backup_tools.crypt(self.root, self.key, 'decrypt', b'encrypted-manifest')

    def test_successful_crypto_stream_keeps_exact_bytes_and_original_key(self):
        inspection = types.SimpleNamespace(stdout=json.dumps([{'Id': 'sha256:' + 'd' * 64}]).encode())
        accepted = types.SimpleNamespace(returncode=0, stderr=b'', stdout=b'authenticated-bytes')
        with patch.object(backup_tools, 'run', side_effect=[inspection, accepted]), patch.object(backup_tools.os, 'getuid', return_value=1001, create=True):
            self.assertEqual(backup_tools.crypt(self.root, self.key, 'decrypt', b'encrypted-manifest'), b'authenticated-bytes')
        self.assertEqual(self.key.read_bytes(), self.secret)


if __name__ == '__main__':
    unittest.main()
