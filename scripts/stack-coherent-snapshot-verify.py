"""Authenticate a retained development snapshot without stopping or restoring services.

Requires a separately recorded manifest digest, snapshot UUID, source revision and
an existing owner-protected key. Plaintext stays in bounded process memory; no
archive is extracted. This is not operational backup, offsite custody or KMS proof.
"""
import argparse
import datetime
import hashlib
import json
import pathlib
import re
import uuid
from stack_backup_custody import retained_key, key_unchanged
from stack_backup_tools import crypt
from stack_coherent_archive import SERVICES, STATEFUL, archive_fingerprints, validate_manifest, verify_component

ROOT = pathlib.Path(__file__).resolve().parent.parent


def unique_object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError('Duplicate snapshot field refused')
        value[key] = item
    return value


def document(raw):
    def refuse(_):
        raise ValueError('Nonfinite snapshot field refused')
    return json.loads(raw.decode('utf-8', errors='strict'), object_pairs_hook=unique_object, parse_constant=refuse)


def bounded_file(path, limit):
    if path.is_symlink() or not path.is_file() or not 0 < path.stat().st_size <= limit:
        raise ValueError('Snapshot component file refused')
    with path.open('rb') as stream:
        raw = stream.read(limit + 1)
    if not 0 < len(raw) <= limit:
        raise ValueError('Snapshot component bound refused')
    return raw


def verify(root, directory, key_file, snapshot_id, revision, manifest_sha256, decrypt=None):
    root = pathlib.Path(root).resolve()
    directory = pathlib.Path(directory)
    if not directory.is_absolute():
        directory = root / directory
    if directory.is_symlink():
        raise ValueError('Linked snapshot refused')
    directory = directory.resolve(strict=True)
    if directory.parent != (root / '.local').resolve() or not directory.is_dir():
        raise ValueError('Snapshot location refused')
    if str(uuid.UUID(snapshot_id)) != snapshot_id or not re.fullmatch('[a-f0-9]{40}', revision) or not re.fullmatch('[a-f0-9]{64}', manifest_sha256):
        raise ValueError('Independent snapshot anchors refused')
    key, key_fingerprint = retained_key(root, key_file)
    if key.parent == directory:
        raise ValueError('Snapshot and retained key must be separate')
    manifest_raw = bounded_file(directory / 'manifest.aesgcm', 1024 * 1024)
    if hashlib.sha256(manifest_raw).hexdigest() != manifest_sha256:
        raise ValueError('Independent manifest digest differs')
    container_decryption = decrypt is None
    decrypt = decrypt or (lambda value: crypt(root, key, 'decrypt', value))
    manifest = validate_manifest(document(decrypt(manifest_raw)), snapshot_id, revision)
    encrypted_digests = {'manifest.aesgcm': manifest_sha256}
    archives, configuration = [], None
    for component, expected in manifest['components'].items():
        name = component + '.aesgcm'
        raw = verify_component(bounded_file(directory / name, 64 * 1024 * 1024), expected)
        encrypted_digests[name] = hashlib.sha256(raw).hexdigest()
        plaintext = decrypt(raw)
        if component == 'configuration':
            configuration = document(plaintext)
        else:
            files = archive_fingerprints(plaintext)
            archives.append({'service': component, 'verifiedFileCount': len(files)})
        del plaintext
    if not isinstance(configuration, dict) or set(configuration) != set(SERVICES):
        raise ValueError('Snapshot configuration service set differs')
    if any(not isinstance(configuration[s], dict) or configuration[s].get('imageId') != manifest['services'][s]['imageId'] for s in SERVICES):
        raise ValueError('Snapshot configuration image binding differs')
    if len(archives) != len(STATEFUL) or {a['service'] for a in archives} != set(STATEFUL):
        raise ValueError('Snapshot archive coverage differs')
    if any(hashlib.sha256(bounded_file(directory / name, 64 * 1024 * 1024)).hexdigest() != digest for name, digest in encrypted_digests.items()) or not key_unchanged(key, key_fingerprint):
        raise ValueError('Snapshot or retained key changed during verification')
    return {'completed': True, 'revision': revision, 'snapshotId': snapshot_id,
            'encryptedManifestSha256': manifest_sha256, 'authenticatedEncryptedComponents': 6,
            'imageIdsBound': len(SERVICES), 'statefulArchivesVerified': len(archives),
            'archiveFilesVerified': sum(a['verifiedFileCount'] for a in archives),
            'snapshotCiphertextUnchanged': True, 'operatorRetainedKeyBytesUnchanged': True,
            'plaintextWrittenToHostDisk': False, 'sourceServicesStopped': False,
            'fixtureContainersOrVolumesCreated': False,
            'transientDecryptionContainersUsed': 7 if container_decryption else 0,
            'actualRecoveryPerformed': False,
            'offsiteBackupVerified': False, 'productionKmsVerified': False,
            'operationalBackupVerified': False, 'productionDeploymentPerformed': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot', type=pathlib.Path, required=True)
    parser.add_argument('--retained-key-file', type=pathlib.Path, required=True)
    parser.add_argument('--expected-snapshot-id', required=True)
    parser.add_argument('--expected-revision', required=True)
    parser.add_argument('--expected-manifest-sha256', required=True)
    args = parser.parse_args()
    report = {'completed': False, 'code': 'RETAINED_SNAPSHOT_UNVERIFIED', 'sourceServicesStopped': False,
              'plaintextWrittenToHostDisk': False, 'productionDeploymentPerformed': False,
              'revision': args.expected_revision if re.fullmatch('[a-f0-9]{40}', args.expected_revision) else None,
              'snapshotId': args.expected_snapshot_id if re.fullmatch('[a-f0-9-]{36}', args.expected_snapshot_id) else None,
              'encryptedManifestSha256': args.expected_manifest_sha256 if re.fullmatch('[a-f0-9]{64}', args.expected_manifest_sha256) else None}
    try:
        report = verify(ROOT, args.snapshot, args.retained_key_file, args.expected_snapshot_id, args.expected_revision, args.expected_manifest_sha256)
    except Exception as error:
        report['errorType'] = type(error).__name__
    report['checkedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    output = ROOT / '.local' / ('stack-coherent-snapshot-verification-' + str(uuid.uuid4()) + '.json')
    with output.open('x', encoding='utf-8') as stream:
        stream.write(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'completed': report['completed'], 'reportPath': str(output)}))
    return 0 if report['completed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
