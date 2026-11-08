"""Rehearse candidate, rollback and return using immutable images on an owned hosted fixture."""
import datetime
import json
import os
from pathlib import Path
import re
import subprocess

from stack_business_fingerprint import fingerprint
from stack_test_client import StackClient

REF = 'refs/heads/codex/audit-release-integration-20261104'
ROOT = Path(__file__).resolve().parent.parent
PRIOR = {
    'core-api': '2100eb9b961af09a37810db1e93017cb4e4bd76606d8229acb1934dc7834fac2',
    'gateway': '2e9110fa78e8a1a3b33e748e03b5cfbeb41c1564d31e7dc66bb7995acfd7c726',
    'console': 'b659d5c5af0c3b23298df3af39f3a8393f01561febab08f47e99c0484cfc8e5a',
}
CURRENT = {
    'core-api': '0be294ddbe084504339c1270509226fe6947ebf9bd3a7dd9630e33c0e2bb750a',
    'gateway': '11fc20a1660a57882aaf8aa8825a93158d1ab6f11ad2152271c72962d004b3fa',
    'console': '1e0adff87d002087be7e74b68f1fa757b5d46c3e026285809770b7ccf4886ece',
}
FILTER_ACTIONS = ('workspace.project.updated', 'access-key.created', 'access-key.revoked')


def references(digests):
    return {name: f'ghcr.io/automaster5013/agenttrust-{name}@sha256:{digest}' for name, digest in digests.items()}


def recovery_phases(images):
    return (
        ('candidate', images, True, True),
        ('current-b2c17be-rollback', references(CURRENT), True, False),
        ('candidate-return', images, True, True),
        ('historical-rollback', references(PRIOR), False, False),
        ('candidate-return-from-historical', images, True, True),
    )


COMPOSE = ['docker', 'compose', '--env-file', '.local/stack/stack.env', '--env-file', '.local/stack/identity.env']
for suffix in ('', '.identity', '.gateway', '.object', '.observability', '.signing'):
    COMPOSE += ['-f', f'compose.stack{suffix}.yaml']
COMPOSE += ['-f', '.local/audit-synthetic.yaml']
OVERLAY = ROOT/'.local/audit-recovery-images.json'


def run(*args):
    return subprocess.check_output(args,cwd=ROOT,timeout=360).decode().strip()


def set_images(images, initial=False):
    services = {'stack-'+name:{'image': image} for name,image in images.items()}
    services['stack-migrate'] = {'image': images['core-api']}
    OVERLAY.write_text(json.dumps({'services': services}),encoding='utf-8')
    if initial:
        run(*COMPOSE,'-f',str(OVERLAY),'up','-d','--no-build','--wait','stack-console')
    else:
        for name in ('core-api','gateway','console'):
            run(*COMPOSE,'-f',str(OVERLAY),'up','-d','--no-build','--no-deps','--wait','stack-'+name)
    for name,ref in images.items():
        expected_id = run('docker', 'image', 'inspect', '--format', '{{.Id}}', ref)
        assert re.fullmatch(r'sha256:[a-f0-9]{64}', expected_id), 'Expected exact local image ID'
        result = run('docker','inspect','--format','{{.Config.Image}} {{.Image}} {{.State.Health.Status}}','agenttrust-stack-'+name+'-1')
        assert result == ref+' '+expected_id+' healthy', 'Running image identity or health mismatch'


def verify_read_authority(value, user, export=False):
    assert value['organizationId'] == user['organizationId']
    assert value['projectId'] == user['projectId']
    if export:
        assert value['signed'] is False and value['currentDeploymentAuthority'] is False
        document = json.loads(value['contentJson'])
        assert document['organizationId'] == user['organizationId']
        assert document['projectId'] == user['projectId']
        assert document['signed'] is False and document['currentDeploymentAuthority'] is False
    else:
        assert value['deploymentAuthority'] is False


def probe(supported, filters_supported):
    credentials = json.loads((ROOT/'.local/stack/demo-credentials.json').read_bytes())
    client = StackClient('http://127.0.0.1:4320',credentials)
    try:
        user = client.login('demo-viewer')
        verify_read_authority(client.request('audit-search/all/all'), user)
        today = datetime.datetime.now(datetime.timezone.utc).date().isoformat()
        routes = [
            f'audit-period-search/{today}/{today}/all/all/all',
            f'audit-period-export/{today}/{today}/all/all/all',
            'audit-actor-search/'+user['actorId']+'/all/all',
        ]
        for route in routes:
            if supported:
                verify_read_authority(client.request(route), user, export=route.startswith('audit-period-export/'))
            else:
                assert client.request(route, expected=502)['code'] == 'REQUEST_UNAVAILABLE'
        for action in FILTER_ACTIONS:
            route = 'audit-search/'+action+'/all'
            if filters_supported:
                verify_read_authority(client.request(route), user)
            else:
                client.request(route, expected=400)
    finally:
        client.logout()


def main():
    assert os.getenv('GITHUB_ACTIONS') == 'true' and os.getenv('GITHUB_REPOSITORY') == 'automaster5013/AgentTrust'
    assert os.getenv('GITHUB_REF') == REF and os.getenv('GITHUB_EVENT_NAME') == 'workflow_dispatch'
    services = run('docker', 'ps', '-a', '--filter', 'label=com.docker.compose.project=agenttrust',
                   '--format', '{{.Label "com.docker.compose.service"}}').splitlines()
    assert services == ['stack-db'], 'Expected only the PostgreSQL fixture created during setup'
    manifest = json.loads((ROOT/'audit-delivery/manifest.json').read_bytes())
    assert manifest['revision'] == os.environ['GITHUB_SHA'] and manifest['ref'] == REF
    images = manifest['images']
    assert images.keys() == PRIOR.keys() == CURRENT.keys()
    for refs in (images, references(CURRENT), references(PRIOR)):
        for name,ref in refs.items():
            assert re.fullmatch(fr'ghcr\.io/automaster5013/agenttrust-{name}@sha256:[a-f0-9]{{64}}',ref)
            run('docker','pull',ref)
    report = {'revision': manifest['revision'],'operatingDeployment':False,'phases':[]}
    try:
        set_images(images, initial=True)
        before = fingerprint()
        assert len(before) == 18
        for phase,cohort,supported,filters_supported in recovery_phases(images):
            if phase != 'candidate':
                set_images(cohort)
            probe(supported, filters_supported)
            assert fingerprint() == before
            report['phases'].append({'phase':phase,'images':cohort,'businessDataUnchanged':True,'auditRoutesSupported':supported,'workspaceAuditFiltersSupported':filters_supported})
        report['completed'] = True
    finally:
        (ROOT/'.local/audit-recovery-result.json').write_text(json.dumps(report,indent=2),encoding='utf-8')


if __name__ == '__main__':
    main()
