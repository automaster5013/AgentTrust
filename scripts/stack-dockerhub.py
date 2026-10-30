"""Mirror security-verified stack images; never start services or rebuild images."""
import argparse
import importlib.util
import json
import os
import pathlib
import re
import subprocess
import sys

_spec = importlib.util.spec_from_file_location('stack_delivery_verify', pathlib.Path(__file__).with_name('stack-delivery-verify.py'))
verification = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(verification)
NAMES = frozenset(verification.IMAGES + ('telemetry', 'tempo', 'loki', 'prometheus', 'quality-verifier', 'console-https'))


def plan(records, namespace, revision):
    if not re.fullmatch(r'[a-z0-9][a-z0-9_-]{1,38}', namespace):
        raise ValueError('Invalid namespace')
    if not re.fullmatch(r'[a-f0-9]{40}', revision) or {row['name'] for row in records} != NAMES or len(records) != len(NAMES):
        raise ValueError('Incomplete release')
    rows = []
    for row in sorted(records, key=lambda item: item['name']):
        source = row['reference']
        if not re.fullmatch(r'ghcr\.io/[a-z0-9-]+/agenttrust-' + re.escape(row['name']) + r'@sha256:[a-f0-9]{64}', source):
            raise ValueError('Invalid source')
        digest = source.split('@')[1]
        target = 'docker.io/' + namespace + '/agenttrust-' + row['name']
        rows.append({'name': row['name'], 'source': source, 'tag': target + ':' + revision, 'reference': target + '@' + digest})
    return rows


def command(args):
    result = subprocess.run(['docker', *args], capture_output=True, text=True, timeout=900)
    if result.returncode:
        raise RuntimeError('Registry operation failed')
    return result.stdout


def publish(rows, run=command):
    # A partial push is possible. No receipt is emitted until every digest readback passes.
    for row in rows:
        run(['pull', row['source']])
        run(['tag', row['source'], row['tag']])
        run(['push', row['tag']])
        run(['pull', row['reference']])
        refs = json.loads(run(['image', 'inspect', row['tag'], '--format', '{{json .RepoDigests}}']))
        if row['reference'] not in refs:
            raise ValueError('Destination digest mismatch')


def publication_run(env, revision, repository):
    expected = repository + '/.github/workflows/original-stack.yml@refs/heads/main'
    if (env.get('GITHUB_ACTIONS') != 'true' or env.get('GITHUB_REF') != 'refs/heads/main'
        or env.get('GITHUB_SHA') != revision or env.get('GITHUB_REPOSITORY') != repository
        or env.get('GITHUB_EVENT_NAME') not in ('push', 'workflow_dispatch')
        or env.get('GITHUB_WORKFLOW_REF') != expected):
        raise ValueError('Trusted main execution required')
    for name in ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT']:
        if not re.fullmatch('[1-9][0-9]{0,19}', env.get(name, '')):
            raise ValueError('Publication run identity required')
    return {'repository': repository, 'workflow': '.github/workflows/original-stack.yml',
            'runId': int(env['GITHUB_RUN_ID']), 'runAttempt': int(env['GITHUB_RUN_ATTEMPT'])}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', type=pathlib.Path, required=True)
    parser.add_argument('--expected-revision', required=True)
    parser.add_argument('--expected-checksums-sha256', required=True)
    parser.add_argument('--repository', required=True)
    parser.add_argument('--namespace', required=True)
    parser.add_argument('--publish', action='store_true')
    parser.add_argument('--output', type=pathlib.Path, required=True)
    args = parser.parse_args()
    try:
        if args.output.exists():
            raise ValueError('Output exists')
        directory, identity, records = verification.validate(args.bundle, args.expected_revision, args.expected_checksums_sha256, args.repository)
        rows = plan(records, args.namespace, args.expected_revision)
        provenance = None
        if args.publish:
            provenance = publication_run(os.environ, args.expected_revision, args.repository)
            verification.Verifier(directory, True, None).verify(records, identity, args.repository, args.expected_revision)
            if verification.validate(directory, args.expected_revision, args.expected_checksums_sha256, args.repository) != (directory, identity, records):
                raise ValueError('Bundle changed')
            publish(rows)
        receipt = {'schemaVersion': 2, 'publicationRun': provenance, 'revision': args.expected_revision, 'sourceChecksumsSha256': args.expected_checksums_sha256,
                   'images': rows, 'published': args.publish, 'destinationDigestsVerified': args.publish,
                   'sourceSignaturesVerifiedHere': args.publish, 'destinationRuntimeExecuted': False, 'serverDeployed': False}
        with args.output.open('x', encoding='utf-8') as output:
            output.write(json.dumps(receipt, indent=2) + '\n')
        print(json.dumps({'completed': True, 'images': len(rows), 'published': args.publish, 'serverDeployed': False}))
        return 0
    except Exception:
        print(json.dumps({'completed': False, 'code': 'DOCKERHUB_DELIVERY_FAILED', 'partialPublicationPossible': args.publish, 'serverDeployed': False}))
        return 1


if __name__ == '__main__':
    sys.exit(main())
