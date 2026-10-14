"""Host-only adversarial structure tests; never touch Docker or private bytes."""
import copy
import hashlib
import io
import tarfile
import unittest
from unittest.mock import patch
from stack_coherent_archive import SERVICES, STATEFUL, archive_fingerprints, validate_manifest, verify_component
from stack_business_fingerprint import sql


def tar(entries):
    out = io.BytesIO()
    with tarfile.open(fileobj=out, mode='w:gz') as archive:
        for name, kind, content, mode in entries:
            entry = tarfile.TarInfo(name)
            entry.type, entry.mode, entry.size = kind, mode, len(content)
            if kind in (tarfile.SYMTYPE, tarfile.LNKTYPE):
                entry.linkname = '/outside'
            archive.addfile(entry, io.BytesIO(content))
    return out.getvalue()


class ColdArchiveTests(unittest.TestCase):
    def test_real_file_bytes_and_directory_sticky_permission(self):
        data = tar([('.', tarfile.DIRTYPE, b'', 0o1777), ('base/file', tarfile.REGTYPE, b'evidence', 0o600)])
        self.assertEqual(archive_fingerprints(data), {'base/file': {'bytes': 8, 'sha256': hashlib.sha256(b'evidence').hexdigest(), 'mode': 0o600}})

    def test_traversal_absolute_windows_and_colon_paths_refused(self):
        for path in ('../file', '/file', 'base/../../file', 'C:/file', 'base\\file'):
            with self.subTest(path=path), self.assertRaises(ValueError):
                archive_fingerprints(tar([(path, tarfile.REGTYPE, b'x', 0o600)]))

    def test_symlinks_hardlinks_devices_fifo_refused(self):
        for kind in (tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.CHRTYPE, tarfile.BLKTYPE, tarfile.FIFOTYPE):
            with self.subTest(kind=kind), self.assertRaises(ValueError):
                archive_fingerprints(tar([('file', kind, b'', 0o600)]))

    def test_duplicate_normalized_paths_refused(self):
        with self.assertRaises(ValueError):
            archive_fingerprints(tar([('base/file', tarfile.REGTYPE, b'a', 0o600), ('./base/file', tarfile.REGTYPE, b'b', 0o600)]))

    def test_privileged_and_file_sticky_permissions_refused(self):
        for mode in (0o4600, 0o2600, 0o1600):
            with self.subTest(mode=mode), self.assertRaises(ValueError):
                archive_fingerprints(tar([('file', tarfile.REGTYPE, b'x', mode)]))

    def test_empty_archive_and_bad_compression_refused(self):
        for data in (b'', b'not-gzip', tar([])):
            with self.subTest(data=data[:8]), self.assertRaises((ValueError, tarfile.ReadError)):
                archive_fingerprints(data)

    def test_valid_empty_state_directory_preserved(self):
        self.assertEqual(archive_fingerprints(tar([('.', tarfile.DIRTYPE, b'', 0o700)])), {})

    def test_truncated_compressed_payload_refused(self):
        data = tar([('file', tarfile.REGTYPE, b'x' * 20000, 0o600)])
        with self.assertRaises((EOFError, tarfile.ReadError, ValueError)):
            archive_fingerprints(data[:len(data)//2])


class ManifestTests(unittest.TestCase):
    def setUp(self):
        self.id, self.revision = '11111111-1111-4111-8111-111111111111', 'a' * 40
        self.value = {'schema': 1, 'snapshotId': self.id, 'revision': self.revision,
                      'services': {s: {'imageId': 'sha256:' + 'b'*64, 'containerId': 'c'*64} for s in SERVICES},
                      'components': {s: {'bytes': 1, 'sha256': hashlib.sha256(b'x').hexdigest()} for s in (*STATEFUL, 'configuration')},
                      'quiescence': {'allWritersStopped': True, 'allStatefulServicesStopped': True, 'pendingEvaluations': 0}}

    def test_exact_service_component_runtime_and_consistency_binding(self):
        self.assertIs(validate_manifest(self.value, self.id, self.revision), self.value)
        self.assertEqual(verify_component(b'x', self.value['components']['configuration']), b'x')

    def test_different_snapshot_revision_or_missing_component_refused(self):
        for field, value in [('snapshotId', '22222222-2222-4222-8222-222222222222'), ('revision', 'd'*40), ('components', {})]:
            row = copy.deepcopy(self.value);row[field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                validate_manifest(row, self.id, self.revision)

    def test_pending_or_live_writer_refused(self):
        for field, value in [('pendingEvaluations', 1), ('pendingEvaluations', False), ('allWritersStopped', False), ('allWritersStopped', 1), ('allStatefulServicesStopped', False)]:
            row = copy.deepcopy(self.value);row['quiescence'][field] = value
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                validate_manifest(row, self.id, self.revision)

    def test_scalar_coercion_extra_service_and_extra_field_refused(self):
        rows = []
        row = copy.deepcopy(self.value);row['schema'] = True;rows.append(row)
        row = copy.deepcopy(self.value);row['components']['configuration']['bytes'] = True;rows.append(row)
        row = copy.deepcopy(self.value);row['services']['foreign'] = row['services']['stack-db'];rows.append(row)
        row = copy.deepcopy(self.value);row['approved'] = True;rows.append(row)
        for row in rows:
            with self.assertRaises(ValueError):validate_manifest(row, self.id, self.revision)

    def test_component_substitution_even_at_equal_size_refused(self):
        for data in (b'y', b'xx'):
            with self.assertRaises(ValueError):verify_component(data, self.value['components']['configuration'])


class DatabaseTargetTests(unittest.TestCase):
    def test_foreign_and_arbitrary_fingerprint_targets_refused_before_docker(self):
        with patch('stack_business_fingerprint.subprocess.run') as command:
            for target in ('logitrack-db-1', 'agenttrust-db-1', 'agenttrust-stack-db-1;bad', 'unowned-fixture'):
                with self.subTest(target=target), self.assertRaises(ValueError):sql('SELECT 1;', target)
            command.assert_not_called()

    def test_original_and_owned_fixture_targets_remain_read_only_call_targets(self):
        with patch('stack_business_fingerprint.subprocess.run') as command:
            command.return_value.returncode=0;command.return_value.stdout='1\n'
            for target in ('agenttrust-stack-db-1', 'agenttrust-stack-coldrestore-11111111-1111-4111-8111-111111111111-stack-db'):
                self.assertEqual(sql('BEGIN READ ONLY;SELECT 1;ROLLBACK;',target),'1')
                self.assertEqual(command.call_args.args[0][3],target)
                self.assertEqual(command.call_args.kwargs['input'],'BEGIN READ ONLY;SELECT 1;ROLLBACK;')


if __name__ == '__main__':unittest.main()
