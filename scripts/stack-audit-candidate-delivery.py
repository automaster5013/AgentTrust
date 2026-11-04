"""Build an audit-only registry cohort and verify its digest-bound evidence."""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

REPOSITORY = 'automaster5013/AgentTrust'
REF = 'refs/heads/codex/audit-release-integration-20261104'
IDENTITY = f'https://github.com/{REPOSITORY}/.github/workflows/original-stack.yml@{REF}'
CONTEXTS = {'core-api': 'services/core-api', 'gateway': 'services/gateway', 'console': 'apps/console'}
ROOT = Path(__file__).resolve().parent.parent
BUNDLE = ROOT / 'audit-delivery'


def run(*args, **kwargs):
    return subprocess.check_output(args, cwd=ROOT, timeout=1800, **kwargs).decode().strip()


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def cosign(args, signer=False):
    cmd = ['docker', 'run', '--rm', '--user', f'{os.getuid()}:{os.getgid()}', '--read-only',
           '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
           '--tmpfs', '/tmp:size=128m,mode=1777', '--memory', '512m', '--pids-limit', '128',
           '-e', 'HOME=/tmp', '--mount', f'type=bind,source={BUNDLE},target=/bundle'+('' if signer else ',readonly')]
    if signer:
        cmd += ['-e', 'ACTIONS_ID_TOKEN_REQUEST_URL', '-e', 'ACTIONS_ID_TOKEN_REQUEST_TOKEN',
                '-e', 'GITHUB_ACTIONS=true', '-e', 'DOCKER_CONFIG=/credentials',
                '--mount', f'type=bind,source={ROOT}/.local/stack-signing-credentials,target=/credentials,readonly']
    return run(*cmd, 'agenttrust-security:local', 'cosign', *args)


def verify(revision):
    checksums = json.loads((BUNDLE/'checksums.json').read_bytes())
    manifest = json.loads((BUNDLE/'manifest.json').read_bytes())
    assert manifest['revision'] == revision and manifest['ref'] == REF and set(manifest['images']) == set(CONTEXTS)
    expected = {'manifest.json'}
    for name, reference in manifest['images'].items():
        assert re.fullmatch(fr'ghcr\.io/automaster5013/agenttrust-{name}@sha256:[a-f0-9]{{64}}', reference)
        digest = reference.split('@sha256:')[1]
        for suffix, kind in [('signature', 'https://sigstore.dev/cosign/sign/v1'), ('sbom', 'cyclonedx')]:
            filename = f'{name}.{suffix}.bundle.json'
            expected.add(filename)
            cosign(['verify-blob-attestation', '--bundle', '/bundle/'+filename,
                    '--digest', digest, '--digestAlg', 'sha256', '--type', kind,
                    '--certificate-identity', IDENTITY, '--certificate-oidc-issuer', 'https://token.actions.githubusercontent.com',
                    '--certificate-github-workflow-repository', REPOSITORY,
                    '--certificate-github-workflow-ref', REF, '--certificate-github-workflow-sha', revision])
            statement = json.loads(base64.b64decode(json.loads((BUNDLE/filename).read_bytes())['dsseEnvelope']['payload'], validate=True))
            assert any(row['digest'].get('sha256') == digest for row in statement['subject'])
            if suffix == 'sbom':
                assert statement['predicate'] == json.loads((BUNDLE/f'{name}.cdx.json').read_bytes())
        expected.update({f'{name}.cdx.json', f'{name}.trivy.json'})
        scan = json.loads((BUNDLE/f'{name}.trivy.json').read_bytes())
        assert scan['SchemaVersion'] == 2 and all(not row.get('Vulnerabilities') for row in scan['Results'])
    assert set(checksums) == expected and {p.name for p in BUNDLE.iterdir()} == expected | {'checksums.json'}
    assert all(sha(BUNDLE/name) == digest for name, digest in checksums.items())
    print(json.dumps({'revision': revision, 'verifiedImages': manifest['images'],
                      'checksumsSha256': sha(BUNDLE/'checksums.json'), 'deployed': False}))


def publish(revision):
    BUNDLE.mkdir()
    images = {}
    env = dict(os.environ, AGENTTRUST_AUDIT_IMAGE_SCOPE='1')
    for name, context in CONTEXTS.items():
        tag = f'ghcr.io/automaster5013/agenttrust-{name}:audit-{revision}'
        run('docker', 'build', '--platform', 'linux/amd64', '--label', f'org.opencontainers.image.revision={revision}', '-t', tag, context)
        run('docker', 'push', tag)
        refs = json.loads(run('docker', 'inspect', '--format', '{{json .RepoDigests}}', tag))
        matches = [ref for ref in refs if ref.startswith(tag.rsplit(':', 1)[0]+'@sha256:')]
        assert len(matches) == 1
        images[name] = matches[0]
        env['STACK_'+name.upper().replace('-', '_').replace('CORE_API','CORE')+'_IMAGE'] = matches[0]
    subprocess.run([sys.executable, 'scripts/stack-security-images.py'], cwd=ROOT, env=env, check=True, timeout=1800)
    reports = list((ROOT/'.local').glob('stack-security-images-*/summary.json'))
    assert len(reports) == 1
    scan = json.loads(reports[0].read_bytes())
    assert scan['completed'] and scan['revision'] == revision and set(scan['images']) == set(CONTEXTS)
    for name, reference in images.items():
        assert scan['images'][name]['reference'] == reference
        for suffix in ('cdx.json','trivy.json'):
            filename = f'{name}.{suffix}'
            (BUNDLE/filename).write_bytes((reports[0].parent/'reports'/filename).read_bytes())
        cosign(['sign', '--yes', '--bundle', f'/bundle/{name}.signature.bundle.json', reference], signer=True)
        cosign(['attest', '--yes', '--type', 'cyclonedx', '--predicate', f'/bundle/{name}.cdx.json',
                '--bundle', f'/bundle/{name}.sbom.bundle.json', reference], signer=True)
    (BUNDLE/'manifest.json').write_text(json.dumps({'revision': revision,'ref': REF,'images': images}, indent=2))
    (BUNDLE/'checksums.json').write_text(json.dumps({p.name: sha(p) for p in sorted(BUNDLE.iterdir())}, indent=2))


if __name__ == '__main__':
    assert os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('GITHUB_REPOSITORY') == REPOSITORY
    assert os.environ.get('GITHUB_REF') == REF and os.environ.get('GITHUB_EVENT_NAME') == 'workflow_dispatch'
    revision = os.environ['GITHUB_SHA']
    assert re.fullmatch('[a-f0-9]{40}',revision) and run('git','rev-parse','HEAD') == revision
    assert len(sys.argv) == 2 and sys.argv[1] in ('publish','verify')
    (publish if sys.argv[1]=='publish' else verify)(revision)
