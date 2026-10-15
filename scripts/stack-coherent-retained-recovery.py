"""Exercise retained development key custody and fresh-process verification.

--execute briefly quiesces transition services using the existing coherent drill.
Only this wrapper's newly generated fixture keys are deleted. No operator key is
accepted by this wrapper; use stack-coherent-recovery.py for operator-owned keys.
"""
import argparse
import datetime
import hashlib
import json
import os
import pathlib
import secrets
import subprocess
import sys
import uuid
from stack_backup_custody import retained_key, key_unchanged

ROOT = pathlib.Path(__file__).resolve().parent.parent


def command(args, timeout=120):
    return subprocess.run(args, cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=timeout)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--exercise-key-rotation', action='store_true')
    parser.add_argument('--exercise-load', action='store_true')
    args = parser.parse_args()
    if not args.execute:
        result = command([sys.executable, 'scripts/stack-coherent-recovery.py'])
        print(result.stdout.strip())
        return result.returncode
    identifier = str(uuid.uuid4())
    key_directory = ROOT / '.local' / ('retained-key-fixture-' + identifier)
    output = ROOT / '.local' / ('stack-coherent-retained-custody-' + identifier + '.json')
    if key_directory.exists() or output.exists():
        raise ValueError('Fixture ownership collision')
    keys = []
    report = {'completed': False, 'fixtureId': identifier,
              'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'operatorProvidedKeysUsed': False, 'originalKeysModifiedOrDeleted': False,
              'operationalBackupVerified': False, 'offsiteBackupVerified': False,
              'productionKmsVerified': False, 'productionDeploymentPerformed': False,
              'rawSecretsPrinted': False}
    try:
        key_directory.mkdir(mode=0o777 if os.name == 'nt' else 0o700)
        if os.name == 'nt':
            owner = command(['whoami']).stdout.strip()
            result = command(['icacls', str(key_directory), '/inheritance:r', '/grant:r', owner + ':(OI)(CI)F', 'SYSTEM:(OI)(CI)F'])
            if result.returncode:
                raise ValueError('Fixture key directory protection refused')
        for name in ('retained-development-key.bin', 'wrong-development-key.bin'):
            path = key_directory / name
            with path.open('xb') as stream:
                stream.write(secrets.token_bytes(32))
            keys.append(path)
            if os.name != 'nt':
                path.chmod(0o600)
        key, wrong_key = (retained_key(ROOT, path) for path in keys)
        request = [sys.executable, 'scripts/stack-coherent-recovery.py', '--execute', '--retained-key-file', str(key[0])]
        if args.exercise_key_rotation:
            request.append('--exercise-key-rotation')
        if args.exercise_load:
            request.append('--exercise-load')
        # The child owns source restoration in finally; do not kill it at an
        # arbitrary wrapper timeout while it may be restoring source services.
        result = command(request, None)
        recovery = json.loads(result.stdout)
        report['recoveryProof'] = recovery.get('reportPath')
        if result.returncode or not recovery.get('completed') or not recovery.get('operatorRetainedKeyBytesUnchanged') or not recovery.get('ownFixtureAndTemporarySecretsCleaned'):
            raise ValueError('Retained-key coherent recovery unverified')
        directory = pathlib.Path(recovery['reportPath']).resolve().parent
        if directory.parent != (ROOT / '.local').resolve():
            raise ValueError('Recovered snapshot ownership refused')
        report.update(revision=recovery['sourceRevision'], snapshotId=recovery['fixtureId'],
                      encryptedManifestSha256=recovery['encryptedManifestSha256'])
        before = {p.name: hashlib.sha256(p.read_bytes()).digest() for p in directory.glob('*.aesgcm')}
        if len(before) != 7:
            raise ValueError('Snapshot component coverage refused')
        common = [sys.executable, 'scripts/stack-coherent-snapshot-verify.py', '--snapshot', str(directory),
                  '--expected-snapshot-id', report['snapshotId'], '--expected-revision', report['revision'],
                  '--expected-manifest-sha256', report['encryptedManifestSha256']]
        result = command(common + ['--retained-key-file', str(key[0])], 300)
        frame = json.loads(result.stdout)
        report['freshProcessVerificationProof'] = frame.get('reportPath')
        if result.returncode or not frame.get('completed'):
            raise ValueError('Fresh process retained-key verification unverified')
        verified = json.loads(pathlib.Path(frame['reportPath']).read_text(encoding='utf-8'))
        if verified['authenticatedEncryptedComponents'] != 6 or verified['imageIdsBound'] != 11 or verified['statefulArchivesVerified'] != 5:
            raise ValueError('Fresh process snapshot coverage unverified')
        result = command(common + ['--retained-key-file', str(wrong_key[0])], 120)
        frame = json.loads(result.stdout)
        report['wrongKeyVerificationProof'] = frame.get('reportPath')
        if result.returncode != 1 or frame.get('completed') is not False:
            raise ValueError('Wrong-key negative control unverified')
        negative = json.loads(pathlib.Path(frame['reportPath']).read_text(encoding='utf-8'))
        if negative.get('errorType') != 'RuntimeError':
            raise ValueError('Wrong key was not refused by the cryptographic stream helper')
        if before != {p.name: hashlib.sha256(p.read_bytes()).digest() for p in directory.glob('*.aesgcm')} or not all(key_unchanged(*item) for item in (key, wrong_key)):
            raise ValueError('Snapshot or provided fixture key changed')
        report.update(completed=True, coherentRecoveryVerified=True, freshProcessSnapshotVerified=True,
                      wrongKeyCryptographicallyRejected=True, snapshotCiphertextUnchanged=True,
                      providedKeyBytesPreservedByRecoveryAndVerifier=True,
                      sourceBusinessRowsUnchanged=recovery['sourceBusinessRowsUnchanged'],
                      sourceContainerIdsAndImagesUnchanged=recovery['sourceContainerIdsAndImagesUnchanged'])
    except Exception as error:
        report.update(completed=False, code='RETAINED_CUSTODY_REHEARSAL_UNVERIFIED', errorType=type(error).__name__)
    finally:
        cleaned = True
        for path in keys:
            try:
                if key_directory.resolve().parent != (ROOT / '.local').resolve() or key_directory.is_symlink() or path.is_symlink() or path.resolve().parent != key_directory.resolve() or path.name not in ('retained-development-key.bin', 'wrong-development-key.bin'):
                    raise ValueError('Fixture key cleanup ownership refused')
                if path.exists():
                    path.chmod(0o600)
                    path.unlink()
            except Exception:
                cleaned = False
        try:
            if key_directory.exists():
                if key_directory.resolve().parent != (ROOT / '.local').resolve() or key_directory.is_symlink():
                    raise ValueError('Fixture key directory cleanup ownership refused')
                key_directory.rmdir()
        except Exception:
            cleaned = False
        report['ownedFixtureKeysDeletedAfterAssertions'] = cleaned
        if not cleaned:
            report['completed'] = False
        report['finishedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        with output.open('x', encoding='utf-8') as stream:
            stream.write(json.dumps(report, indent=2) + '\n')
        print(json.dumps({'completed': report['completed'], 'reportPath': str(output)}))
    return 0 if report['completed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
