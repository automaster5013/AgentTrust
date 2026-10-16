"""Explicit disposable-CI-only offline release verification and certificate tampering control."""
import argparse
import datetime
import hashlib
import json
import os
import pathlib
import re
import shutil
import subprocess
import uuid

ROOT = pathlib.Path(__file__).resolve().parent.parent


def require(value):
    if not value: raise ValueError('OFFLINE_DELIVERY_FIXTURE_REFUSED')


def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('--execute', action='store_true')
    args = parser.parse_args()
    if not args.execute:
        print(json.dumps({'completed': True, 'executed': False, 'productionDeploymentPerformed': False})); return 0
    require(os.environ.get('CI') == 'true' and os.environ.get('GITHUB_ACTIONS') == 'true'
        and os.environ.get('GITHUB_REPOSITORY') == 'automaster5013/AgentTrust'
        and os.environ.get('GITHUB_REF') == 'refs/heads/main' and os.name == 'posix' and os.getuid() > 0)
    require(shutil.disk_usage(ROOT).free >= 22 * 1024 ** 3 + 256 * 1024 ** 2)
    revision = os.environ['GITHUB_SHA']; require(re.fullmatch('[a-f0-9]{40}', revision))
    bundle = ROOT / 'stack-security-delivery'
    anchor = hashlib.sha256((bundle / 'checksums.json').read_bytes()).hexdigest()
    identifier = str(uuid.uuid4()); directory = ROOT / '.local' / ('stack-delivery-offline-' + identifier)
    directory.mkdir(mode=0o700); trust = directory / 'trust'; trust.mkdir(mode=0o700)
    report = {'completed': False, 'revision': revision, 'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'productionDeploymentPerformed': False, 'registryCredentialsMounted': False}
    names = []
    def command(args, timeout=90):
        result = subprocess.run(args, cwd=ROOT, capture_output=True, timeout=timeout)
        require(result.returncode == 0 and len(result.stdout) <= 16384)
        return result.stdout
    try:
        image = json.loads(command(['docker', 'image', 'inspect', 'agenttrust-security:local']))[0]['Id']
        require(re.fullmatch('sha256:[a-f0-9]{64}', image))
        def run(kind, network, mounts, environment, arguments, timeout):
            name = 'agenttrust-delivery-' + identifier + '-' + kind; names.append(name)
            base = ['docker', 'run', '--pull', 'never', '--name', name, '--label', 'agenttrust.fixture=' + identifier,
                '--user', str(os.getuid()) + ':' + str(os.getgid()), '--network', network, '--log-driver', 'none',
                '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
                '--tmpfs', '/tmp:size=192m,mode=1777', '--memory', '1g', '--cpus', '2', '--pids-limit', '128']
            for key, value in environment.items(): base += ['-e', key + '=' + value]
            for source, target, readonly in mounts:
                base += ['--mount', 'type=bind,source=' + str(source) + ',target=' + target + (',readonly' if readonly else '')]
            output = command(base + [image, *arguments], timeout)
            state = json.loads(command(['docker', 'inspect', name]))[0]
            require(state['Config']['Labels']['agenttrust.fixture'] == identifier and state['State']['ExitCode'] == 0
                and not state['State']['OOMKilled'] and state['HostConfig']['NetworkMode'] == network
                and state['HostConfig']['ReadonlyRootfs'] and state['HostConfig']['LogConfig']['Type'] == 'none')
            return output
        run('trust', 'bridge', [(trust, '/trust', False)], {'HOME': '/trust', 'XDG_CACHE_HOME': '/trust/cache'},
            ['cosign', 'initialize'], 120)
        root = trust / '.sigstore/root/tuf-repo-cdn.sigstore.dev/targets/trusted_root.json'
        require(root.is_file() and not root.is_symlink() and 0 < root.stat().st_size <= 1048576)
        report['trustedRootSha256'] = hashlib.sha256(root.read_bytes()).hexdigest()
        value = json.loads(run('offline', 'none', [(bundle, '/bundle', True), (root, '/trusted-root.json', True),
            (ROOT / 'scripts', '/scripts', True)], {'HOME': '/tmp', 'XDG_CACHE_HOME': '/tmp/cache',
            'DELIVERY_REVISION': revision, 'DELIVERY_CHECKSUMS_SHA256': anchor},
            ['python', '/scripts/stack_delivery_offline_controls.py'], 600))
        require(value['completed'] is True and value['positiveOfflineImageAndSbomSignatures'] == 32
            and value['tamperedHttpsCertificateRejected'] is True and value['originalBundleBytesUnchanged'] is True)
        report.update(value, networkDisabledDuringAllCryptoControls=True,
            trustBootstrappedSeparatelyFromEmbeddedCosignTufRoot=True, checksumsSha256=anchor)
    except Exception as error:
        report.update(completed=False, errorType=type(error).__name__, code='OFFLINE_DELIVERY_FIXTURE_UNVERIFIED')
    finally:
        cleaned = True
        for name in reversed(names):
            try:
                state = json.loads(command(['docker', 'inspect', name]))[0]
                require(state['Config']['Labels']['agenttrust.fixture'] == identifier)
                command(['docker', 'rm', '-f', name])
            except Exception: cleaned = False
        if cleaned:
            try:
                require(trust.resolve().parent == directory.resolve() and directory.resolve().parent == (ROOT / '.local').resolve()
                    and not trust.is_symlink())
                shutil.rmtree(trust)
            except Exception: cleaned = False
        report['ownedResourcesRemoved'] = cleaned
        report['completed'] = report['completed'] and cleaned
        report['finishedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        (directory / 'summary.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report)); return 0 if report['completed'] else 1


if __name__ == '__main__':
    try: raise SystemExit(main())
    except Exception as error:
        print(json.dumps({'completed': False, 'code': 'OFFLINE_DELIVERY_FIXTURE_REFUSED', 'errorType': type(error).__name__}))
        raise SystemExit(1)
