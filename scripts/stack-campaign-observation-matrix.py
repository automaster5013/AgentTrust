"""Actual synthetic decision/approval matrix with independently verified archived observations."""
import base64
import concurrent.futures
import datetime
import json
import pathlib
import subprocess
import time
import traceback
import uuid
from stack_test_client import StackClient

root = pathlib.Path(__file__).resolve().parent.parent
directory = root / '.local' / ('stack-campaign-observation-matrix-' + str(uuid.uuid4()))
directory.mkdir()
clients = []
report = {'completed': False, 'checks': [], 'credentialsRecorded': False,
          'privateKeyExported': False, 'paidApiCalls': False,
          'actualDeploymentPerformed': False, 'currentDeploymentAuthority': False,
          'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()}
stage = 'login'

def terminal(client, record):
    until = time.monotonic() + 35
    while record['state'] == 'queued' and time.monotonic() < until:
        time.sleep(.4)
        record = client.request('campaigns/' + record['id'])
    assert record['state'] != 'queued'
    return record

def archived(client, campaign):
    until = time.monotonic() + 45
    while time.monotonic() < until:
        try:
            return client.request('campaigns/' + campaign + '/evidence')
        except AssertionError:
            if report.get('unexpectedHttpStatus') not in [409, 503]:
                raise
            time.sleep(.5)
    raise AssertionError('Archive deadline')

def issue(client, campaign, key):
    return client.request('campaigns/' + campaign + '/receipts', 'POST',
                          {'note': 'Bounded synthetic decision matrix'},
                          {'Idempotency-Key': key})

try:
    credentials = json.loads((root / '.local/stack/demo-credentials.json').read_text(encoding='utf-8'))
    admin = StackClient('http://127.0.0.1:4320', credentials, report, clients)
    owner = admin.login('demo-admin')
    suffix = uuid.uuid4().hex[:12]
    agent = admin.request('versions/agents', 'POST', {
        'key': 'observation-matrix-agent-' + suffix, 'version': 1,
        'provider': 'synthetic', 'description': 'Immutable observation decision matrix'})
    matrix = [
        ('required-block', [{'id': 'required', 'scenario': 'block', 'required': True}], True, 'succeeded', 'block', False),
        ('required-missing', [{'id': 'required', 'scenario': 'missing_evidence', 'required': True}], True, 'succeeded', 'inconclusive', False),
        ('required-error', [{'id': 'required', 'scenario': 'error', 'required': True}], True, 'failed', 'inconclusive', False),
        ('optional-error', [{'id': 'required', 'scenario': 'pass', 'required': True}, {'id': 'optional', 'scenario': 'error', 'required': False}], True, 'failed', 'inconclusive', False),
        ('optional-missing', [{'id': 'required', 'scenario': 'pass', 'required': True}, {'id': 'optional', 'scenario': 'missing_evidence', 'required': False}], True, 'succeeded', 'pass', False),
        ('no-review-required', [{'id': 'required', 'scenario': 'pass', 'required': True}], False, 'succeeded', 'pass', True),
    ]
    records = []
    for index, (label, cases, approval, state, decision, allowed) in enumerate(matrix, 1):
        stage = label
        data = admin.request('versions/datasets', 'POST', {
            'key': 'observation-matrix-data-' + suffix, 'version': index, 'cases': cases})
        record = terminal(admin, admin.request('campaigns', 'POST', {
            'agentVersionId': agent['id'], 'datasetVersionId': data['id'],
            'requiresApproval': approval}, {'Idempotency-Key': str(uuid.uuid4())}))
        assert record['state'] == state and record['decision'] == decision
        archived(admin, record['id'])
        receipt = issue(admin, record['id'], str(uuid.uuid4()))
        payload = json.loads(base64.b64decode(receipt['payloadBase64'], validate=True))
        assert receipt['signatureVerified'] and payload['evaluationState'] == state
        assert payload['evaluationDecision'] == decision
        assert payload['observedGate']['deploymentAllowed'] is allowed
        assert payload['currentDeploymentAuthority'] is False and payload['latestReview'] is None
        if decision != 'pass':
            admin.request('campaigns/' + record['id'] + '/reviews', 'POST',
                          {'decision': 'approved', 'reason': 'Must refuse nonpassing evidence'}, expected=409)
        bundle = admin.request('campaigns/' + record['id'] + '/receipts/' + receipt['receiptId'] + '/bundle')
        path = directory / (label + '.json')
        path.open('x', encoding='utf-8').write(json.dumps(bundle, separators=(',', ':')))
        verified = subprocess.run([
            'node', '--experimental-strip-types', 'scripts/stack-verify-campaign-receipt.ts',
            '--bundle', str(path), '--trusted-public-key', str(root / '.local/stack/gate-keys/public-key.pem'),
            '--organization', owner['organizationId'], '--project', owner['projectId'],
            '--campaign', record['id']], cwd=root, capture_output=True, text=True, timeout=30)
        assert verified.returncode == 0
        proof = json.loads(verified.stdout)
        assert proof['signatureVerified'] and proof['childBytesVerified']
        assert not proof['currentDeploymentAuthority'] and not proof['networkUsed']
        records.append({'campaignId': record['id'], 'receiptId': receipt['receiptId'],
                        'state': state, 'decision': decision, 'observedDeploymentAllowed': allowed})
        report['checks'].append(label + ': actual signature and complete archived bytes verified; no current deployment authority')
    stage = 'parallel-idempotency'
    # Distinct authenticated sessions avoid sharing a mutable cookie jar across threads.
    peer = StackClient('http://127.0.0.1:4320', credentials, report, clients)
    peer.login('demo-admin')
    key = str(uuid.uuid4())
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(issue, client, records[-1]['campaignId'], key) for client in [admin, peer]]
        concurrent_receipts = [future.result(timeout=30) for future in futures]
    assert concurrent_receipts[0] == concurrent_receipts[1]
    assert len([row for row in admin.request('campaigns/' + records[-1]['campaignId'] + '/receipts')
                if row['id'] == concurrent_receipts[0]['receiptId']]) == 1
    report['checks'].append('concurrent same-key issuance returns one exact immutable signed observation')
    report.update(completed=True, observations=records)
except Exception as error:
    report.update(code='OBSERVATION_MATRIX_UNVERIFIED', failedStage=stage,
                  errorType=type(error).__name__, failureLocations=[
                      {'file': pathlib.Path(item.filename).name, 'line': item.lineno}
                      for item in traceback.extract_tb(error.__traceback__)])
finally:
    closed = True
    for client in reversed(clients):
        try:
            client.logout()
        except Exception:
            closed = False
    report.update(ownSessionsLoggedOut=closed, finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
    path = directory / 'summary.json'
    path.open('x', encoding='utf-8').write(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'completed': report['completed'], 'checks': len(report['checks']),
                      'ownSessionsLoggedOut': closed, 'failedStage': report.get('failedStage'), 'reportPath': str(path)}))
    if not report['completed'] or not closed:
        raise SystemExit(1)
