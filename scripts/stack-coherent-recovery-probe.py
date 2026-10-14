"""Acceptance probe run only within the owned portless recovery network.

Its one new synthetic admission and review affect only restored disposable data.
The orchestrator must compare the source business fingerprints independently.
"""
import base64
import hashlib
import json
import pathlib
import secrets
import time
import uuid
from cryptography.hazmat.primitives.serialization import load_der_public_key
from stack_campaign_evidence import document, verify_parent, verify_child
from stack_recovery_transport import fixture_opener
from stack_test_client import StackClient, FixedRedirects


def require(condition):
    if not condition:
        raise ValueError('RESTORED_ACCEPTANCE_REFUSED')


def signed_payload(frame, anchor):
    require(frame['keyId'] == anchor['keyId'] and frame['signatureAlgorithm'] == 'Ed25519'
            and frame['currentDeploymentAuthority'] is False
            and frame['trustDomain'] == 'agenttrust-local-development')
    raw = base64.b64decode(frame['payloadBase64'], validate=True)
    require(len(raw) == frame['payloadBytes'] and hashlib.sha256(raw).hexdigest() == frame['payloadSha256'])
    public = base64.b64decode(anchor['publicKeySpkiBase64'], validate=True)
    require(len(public) == 44 and hashlib.sha256(public).hexdigest() == anchor['keyId'])
    key = load_der_public_key(public)
    key.verify(base64.b64decode(frame['signatureBase64'], validate=True), raw)
    require(json.loads(raw)['currentDeploymentAuthority'] is False
            and json.loads(raw)['trustDomain'] == 'agenttrust-local-development')
    return json.loads(raw)


def evidence_read(client, path):
    until = time.monotonic()+20
    while True:
        try:return client.request(path)
        except AssertionError:
            if client.report.get('unexpectedHttpStatus') not in (409, 503) or time.monotonic() >= until:
                raise
            time.sleep(.5)


def main():
    report = {'completed': False, 'checks': [], 'paidProviderCallsPerformed': False,
              'fixtureBusinessWritesPerformed': False, 'sourceNetworkAccessed': False,
              'productionDeploymentPerformed': False, 'credentialsRecorded': False}
    clients = []
    credentials = json.loads(pathlib.Path('/credentials.json').read_bytes())
    anchor = json.loads(pathlib.Path('/probe-anchor.json').read_bytes())

    def client(username):
        value = StackClient('http://127.0.0.1:4320', credentials, {}, clients)
        value.opener = fixture_opener(value.jar, FixedRedirects())
        identity = value.login(username)
        require(value.report.get('oidcAuthorizationCodePkceVerified') is True)
        return value, identity

    try:
        report['stage'] = 'restored-viewer-login-and-existing-archive'
        viewer, identity = client('demo-viewer')
        campaign = viewer.request('campaigns/'+anchor['campaignId'])
        evidence = evidence_read(viewer, 'campaigns/'+anchor['campaignId']+'/evidence')
        children = verify_parent(evidence, identity, campaign)
        for reference in children:
            record = viewer.request('runs/'+reference['runId'])
            proof = evidence_read(viewer, 'runs/'+reference['runId']+'/evidence')
            verify_child(proof, identity, record, reference)
        report['checks'].append('restored OIDC code/PKCE viewer reads exact pre-snapshot parent and every pinned child MinIO version with verified immutable hashes')
        report['stage'] = 'historical-and-current-signatures'
        trust = viewer.request('gate-trust')
        require(trust['keyId'] == anchor['keyId'] and trust['publicKeySpkiBase64'] == anchor['publicKeySpkiBase64']
                and trust['productionKey'] is False)
        receipt = viewer.request('campaigns/'+anchor['campaignId']+'/receipts/'+anchor['receiptId'])
        payload = signed_payload(receipt, anchor)
        require(payload['campaignId'] == anchor['campaignId'] and payload['receiptId'] == anchor['receiptId']
                and payload['organizationId'] == identity['organizationId'] and payload['projectId'] == identity['projectId'])
        challenge = secrets.token_hex(32)
        frame = viewer.request('campaigns/'+anchor['campaignId']+'/gate-check/'+challenge)
        current = signed_payload(frame, anchor)
        require(current['challenge'] == challenge and current['campaignId'] == anchor['campaignId']
                and current['organizationId'] == identity['organizationId'] and current['projectId'] == identity['projectId']
                and current['actorId'] == identity['actorId'] and current['expiresAtEpochMillis'] > time.time()*1000)
        report['checks'].append('historical receipt and fresh challenged Java Ed25519 signature verify against the separately anchored pre-snapshot public key')
        report['stage'] = 'restored-authorization-boundaries'
        viewer.request('runs', 'POST', {'scenario': 'pass', 'requiresApproval': True}, {'Idempotency-Key': str(uuid.uuid4())}, expected=403)
        foreign, _ = client('other-admin')
        foreign.request('campaigns/'+anchor['campaignId'], expected=404)
        foreign.request('campaigns/'+anchor['campaignId']+'/evidence', expected=404)
        foreign.request('campaigns/'+anchor['campaignId']+'/receipts/'+anchor['receiptId'], expected=404)
        report['checks'].append('restored viewer write refusal and foreign organization boundaries remain enforced through console, gateway, Java and RLS')
        report['stage'] = 'new-isolated-evaluation-and-approval'
        admin, _ = client('demo-admin')
        key = str(uuid.uuid4())
        body = {'scenario': 'pass', 'requiresApproval': True}
        record = admin.request('runs', 'POST', body, {'Idempotency-Key': key})
        report['fixtureBusinessWritesPerformed'] = True
        until = time.monotonic()+40
        while record['state'] == 'queued' and time.monotonic() < until:
            time.sleep(.5);record = admin.request('runs/'+record['id'])
        require(record['state'] == 'succeeded' and record['decision'] == 'pass'
                and record['result']['executionEngine'] == 'python-synthetic')
        require(admin.request('runs/'+record['id']+'/gate')['deploymentAllowed'] is False)
        admin.request('runs/'+record['id']+'/reviews', 'POST', {'decision': 'approved', 'reason': 'isolated cold recovery acceptance', 'expectedReviewSequence': 0})
        gate = admin.request('runs/'+record['id']+'/gate')
        require(gate['deploymentAllowed'] is True and gate['policyStatus'] == 'evaluated')
        require(admin.request('runs', 'POST', body, {'Idempotency-Key': key})['id'] == record['id'])
        archived = evidence_read(admin, 'runs/'+record['id']+'/evidence')
        document(archived)
        report['checks'].append('fresh isolated synthetic admission completes through recovered JetStream/Python/Java, requires manual review, reuses its idempotency key and archives verified bytes')
        report['completed'] = True
    except Exception as error:
        report.update(errorType=type(error).__name__, code='RESTORED_APPLICATION_ACCEPTANCE_UNVERIFIED')
    finally:
        closed = True
        for value in reversed(clients):
            try:value.logout()
            except Exception:closed = False
        report['ownSessionsClosed'] = closed and all(not value.logged for value in clients)
    print(json.dumps(report))
    return 0 if report['completed'] and report['ownSessionsClosed'] else 1


if __name__ == '__main__':raise SystemExit(main())
