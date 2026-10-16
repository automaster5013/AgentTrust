"""Offline consumer crypto controls over public release bytes only."""
import base64
import contextlib
import hashlib
import importlib.util
import io
import json
import os
import pathlib
import shutil
import sys


def require(value):
    if not value: raise ValueError('OFFLINE_DELIVERY_UNVERIFIED')


def verify(bundle, trust, revision, anchor, repository):
    source = pathlib.Path(__file__).with_name('stack-delivery-verify.py')
    spec = importlib.util.spec_from_file_location('delivery', source)
    delivery = importlib.util.module_from_spec(spec); spec.loader.exec_module(delivery)
    directory, identity, records = delivery.validate(bundle, revision, anchor, repository)
    require(len(records) == 16)
    before = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in directory.iterdir()}
    require(len(before) == 70 and before['checksums.json'] == anchor)
    verifier = delivery.Verifier(directory, False, trust)
    verifier.verify(records, identity, repository, revision)
    fixture = pathlib.Path('/tmp/tampered-delivery')
    require(not fixture.exists()); shutil.copytree(directory, fixture)
    path = fixture / 'console-https.signature.bundle.json'
    value = delivery.json_bytes(path.read_bytes())
    certificate = bytearray(base64.b64decode(value['verificationMaterial']['certificate']['rawBytes'], validate=True))
    require(len(certificate) > 512)
    certificate[-1] ^= 1
    value['verificationMaterial']['certificate']['rawBytes'] = base64.b64encode(certificate).decode()
    path.write_text(json.dumps(value, separators=(',', ':')), encoding='utf-8')
    checksums = delivery.json_bytes((fixture / 'checksums.json').read_bytes())
    checksums[path.name] = hashlib.sha256(path.read_bytes()).hexdigest()
    (fixture / 'checksums.json').write_text(json.dumps(checksums, sort_keys=True, separators=(',', ':')), encoding='utf-8')
    changed_anchor = hashlib.sha256((fixture / 'checksums.json').read_bytes()).hexdigest()
    require(changed_anchor != anchor)
    delivery.validate(fixture, revision, changed_anchor, repository)
    argv = sys.argv
    try:
        sys.argv = ['verifier', '--bundle', str(fixture), '--expected-revision', revision,
            '--expected-checksums-sha256', changed_anchor, '--repository', repository, '--trusted-root', str(trust)]
        output = io.StringIO()
        with contextlib.redirect_stdout(output): status = delivery.main()
        result = json.loads(output.getvalue())
    finally:
        sys.argv = argv
    require(status == 1 and result['completed'] is False and result['failedStage'] == 'cryptographic-verification')
    require(before == {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in directory.iterdir()})
    return {'completed': True, 'revision': revision, 'images': 16, 'positiveOfflineImageAndSbomSignatures': 32,
        'tamperedHttpsCertificateRejected': True, 'recomputedChecksumAcceptedBeforeCryptography': True,
        'rejectionStage': 'cryptographic-verification', 'originalBundleBytesUnchanged': True,
        'fixtureMemoryOnly': True, 'productionDeploymentPerformed': False}


if __name__ == '__main__':
    try:
        print(json.dumps(verify(pathlib.Path('/bundle'), pathlib.Path('/trusted-root.json'),
            os.environ['DELIVERY_REVISION'], os.environ['DELIVERY_CHECKSUMS_SHA256'], 'automaster5013/AgentTrust')))
    except Exception as error:
        print(json.dumps({'completed': False, 'code': 'OFFLINE_DELIVERY_UNVERIFIED', 'errorType': type(error).__name__}))
        raise SystemExit(1)
