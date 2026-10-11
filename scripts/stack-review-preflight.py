"""Read existing original-stack review data; never create an evaluation or approval."""
import argparse
import datetime
import hashlib
import json
import pathlib
import re
import uuid

from stack_campaign_evidence import bounded_json, identifier, verify_child, verify_parent
from stack_test_client import StackClient

ROOT = pathlib.Path(__file__).resolve().parent.parent


def audit_scope(page, owner):
    if not isinstance(page, dict) or set(page) != {
        'organizationId', 'projectId', 'entries', 'nextCursor', 'limit',
        'ordering', 'deploymentAuthority',
    }:
        raise ValueError('Invalid audit response')
    if (page['organizationId'], page['projectId']) != (
        owner['organizationId'], owner['projectId'],
    ) or page['deploymentAuthority'] is not False or page['limit'] != 25 \
            or page['ordering'] != 'created-at-id-desc':
        raise ValueError('Invalid audit scope')
    rows = page['entries']
    if not isinstance(rows, list) or len(rows) > 25:
        raise ValueError('Unbounded audit response')
    seen = set()
    for row in rows:
        if not isinstance(row, dict) or set(row) != {
            'id', 'actorId', 'action', 'resourceId', 'createdAt',
        }:
            raise ValueError('Invalid audit entry')
        for field in ['id', 'actorId', 'resourceId']:
            identifier(row[field])
        if row['id'] in seen or not isinstance(row['action'], str) \
                or not re.fullmatch('[a-z][a-z0-9.-]{0,59}', row['action']) \
                or not isinstance(row['createdAt'], str) \
                or not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z', row['createdAt']):
            raise ValueError('Invalid audit entry')
        seen.add(row['id'])
    cursor = page['nextCursor']
    if cursor is not None and (not isinstance(cursor, str)
                              or not re.fullmatch('[A-Za-z0-9_-]{80}', cursor)
                              or len(rows) != 25):
        raise ValueError('Invalid audit navigation')
    return len(rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--username', choices=['demo-admin', 'demo-editor', 'demo-viewer', 'other-admin'],
                        default='demo-viewer')
    parser.add_argument('--campaign', help='Canonical UUID of an existing campaign in this account scope')
    args = parser.parse_args()
    report = {
        'completed': False, 'businessDataWrites': False, 'paidApiCalls': False,
        'deploymentAuthority': False, 'productionReady': False,
        'imageSecurityVerified': False, 'signatureVerified': False,
        'checks': [], 'credentialsRecorded': False,
        'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }
    client = None
    stage = 'configuration'
    try:
        campaign = identifier(args.campaign) if args.campaign else None
        credentials = bounded_json(ROOT / '.local/stack/demo-credentials.json', 65536)
        if not isinstance(credentials, list) or not 1 <= len(credentials) <= 16:
            raise ValueError('Invalid local account configuration')
        client = StackClient('http://127.0.0.1:4320', credentials, report)
        stage = 'authentication'
        owner = client.login(args.username)
        if owner['identityProvider'] != 'keycloak' or owner['role'] not in ['admin', 'editor', 'viewer']:
            raise ValueError('Original identity unavailable')
        for field in ['organizationId', 'projectId', 'actorId']:
            identifier(owner[field])
        report['role'] = owner['role']
        report['scopeSha256'] = hashlib.sha256(
            (owner['organizationId'] + '/' + owner['projectId']).encode('ascii')).hexdigest()
        report['checks'].append('real Keycloak OIDC/PKCE login matches this account scope')
        stage = 'audit-read'
        report['auditEntriesRead'] = audit_scope(client.request('audit'), owner)
        report['checks'].append('bounded read-only audit response matches the authenticated scope')
        if campaign:
            stage = 'existing-campaign'
            record = client.request('campaigns/' + campaign)
            if record.get('id') != campaign or record.get('organization_id') != owner['organizationId'] \
                    or record.get('project_id') != owner['projectId']:
                raise ValueError('Invalid campaign scope')
            stage = 'archived-bytes'
            proof = client.request('campaigns/' + campaign + '/evidence')
            references = verify_parent(proof, owner, record)
            for case, reference in zip(record['cases'], references):
                child = client.request('runs/' + case['runId'])
                if child['scenario'] != case['scenario'] or child['provider'] != case['provider'] \
                        or child['result']['state'] != case['state'] \
                        or child['result']['decision'] != case['decision']:
                    raise ValueError('Child result disagrees with campaign case')
                verify_child(client.request('runs/' + case['runId'] + '/evidence'), owner, child, reference)
            report['childArchivesVerified'] = len(references)
            report['parentContentSha256'] = proof['contentSha256']
            report['checks'].append('existing parent and pinned child archive bytes and immutable versions agree')
            stage = 'current-gate'
            gate = client.request('campaigns/' + campaign + '/gate')
            if gate.get('policyEngine') != 'opa-rego' or gate.get('policyStatus') != 'evaluated' \
                    or type(gate.get('deploymentAllowed')) is not bool or gate.get('signed') is not False:
                raise ValueError('Current policy unavailable')
            report['currentGateAllowedAtRead'] = gate['deploymentAllowed']
            report['checks'].append('current OPA observation is separate from historical byte integrity')
        report['completed'] = True
    except Exception as error:
        report.update(failedStage=stage, errorType=type(error).__name__, code='STACK_REVIEW_PREFLIGHT_UNVERIFIED')
    finally:
        closed = True
        if client is not None:
            try:
                client.logout()
            except Exception:
                closed = False
        report['ownSessionLoggedOut'] = closed
        if not closed:
            report['completed'] = False
        code = report.get('responseCode')
        if code is not None and (not isinstance(code, str) or not re.fullmatch('[A-Z_]{1,64}', code)):
            report.pop('responseCode', None)
        phase = report.get('loginPhase')
        if phase is not None and (not isinstance(phase, str) or not re.fullmatch('[a-z-]{1,48}', phase)):
            report.pop('loginPhase', None)
        permitted = {
            'completed', 'businessDataWrites', 'paidApiCalls', 'deploymentAuthority',
            'productionReady', 'imageSecurityVerified', 'signatureVerified', 'checks',
            'credentialsRecorded', 'startedAt', 'role', 'scopeSha256', 'auditEntriesRead',
            'childArchivesVerified', 'parentContentSha256', 'currentGateAllowedAtRead',
            'failedStage', 'errorType', 'code', 'ownSessionLoggedOut', 'loginPhase',
            'oidcAuthorizationCodePkceVerified', 'ownIdentityProviderSessionClosed',
            'unexpectedHttpStatus', 'expectedHttpStatus', 'responseCode',
        }
        report = {key: value for key, value in report.items() if key in permitted}
        report['finishedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        directory = ROOT / '.local'
        directory.mkdir(exist_ok=True)
        path = directory / ('stack-review-preflight-' + str(uuid.uuid4()) + '.json')
        path.open('x', encoding='utf-8').write(json.dumps(report, indent=2) + '\n')
        # Status codes and fixed stage names are safe; response bodies and credentials are omitted.
        print(json.dumps({**report, 'reportPath': str(path)}))
    return 0 if report['completed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
