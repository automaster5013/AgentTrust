"""Actual federated evaluation/review pilot in the newly owned HTTPS fixture."""
import json
import pathlib
import re
import sys
import time
import uuid
from stack_https_fixture_broker_client import BrokerIdentityClient
from stack_https_fixture_enterprise import require
from stack_https_identity_client import CONSOLE

TRUE_FLAGS = ('completed', 'allRequiredDecisionStatesVerified', 'sameRequestIdempotencyVerified',
    'viewerWritesAndNonAdminReviewsRefused', 'foreignReadsAndReviewsRefused',
    'administratorApprovalThenRevocationVerified', 'nonpassApprovalRefused', 'actualOpaGateVerified',
    'allApplicationSessionsLoggedOut', 'fixtureBusinessWritesOnly')
FALSE_FLAGS = ('paidProviderCallsPerformed', 'productionDeploymentPerformed', 'customerPilotVerified')


def validate_result(value):
    require(isinstance(value, dict) and set(value) == {*TRUE_FLAGS, *FALSE_FLAGS,
        'actualFederatedLogins', 'actualPythonEvaluations'})
    require(all(value[k] is True for k in TRUE_FLAGS) and all(value[k] is False for k in FALSE_FLAGS))
    require(all(type(value[k]) is int and value[k] == 4 for k in ('actualFederatedLogins', 'actualPythonEvaluations')))
    return value


def request(client, path, method='GET', body=None, expected=200, key=None):
    require(re.fullmatch(r'runs(?:/[a-f0-9-]{36}(?:/(?:gate|reviews))?)?', path) is not None)
    raw, _, _ = client.wire(CONSOLE + '/backend/' + path, method,
        json.dumps(body).encode() if body is not None else None,
        'application/json' if body is not None else None, expected=expected, request_key=key)
    return json.loads(raw) if raw else None


def verify(ca_file, accounts, target):
    primary = next(a for a in accounts if a['role'] == 'editor')
    local = {a['role']: a for a in accounts if a['organizationId'] == primary['organizationId']
        and a['projectId'] == primary['projectId']}
    foreign = next(a for a in accounts if a['organizationId'] != primary['organizationId'])
    require(set(local) == {'admin', 'editor', 'viewer'})
    clients = []
    try:
        for account in [local['admin'], local['editor'], local['viewer'], foreign]:
            link = next(v for v in target['manifest']['linkedAccounts'] if v['nativeActorId'] == account['actorId'])
            client = BrokerIdentityClient(ca_file, account,
                {'username': link['enterpriseUsername'], 'password': link['enterprisePassword']})
            clients.append(client); client.login()
            require(client.authorization_verified and client.enterprise_authorization_verified)
        admin, editor, viewer, other = clients
        created = []
        for scenario, decision, state in [('pass', 'pass', 'succeeded'), ('block', 'block', 'succeeded'),
                ('missing_evidence', 'inconclusive', 'succeeded'), ('error', 'inconclusive', 'failed')]:
            key = str(uuid.uuid4()); body = {'scenario': scenario, 'requiresApproval': True, 'provider': 'synthetic'}
            record = request(editor, 'runs', 'POST', body, key=key)
            identifier = record['id']; require(str(uuid.UUID(identifier)) == identifier)
            require(request(editor, 'runs', 'POST', body, key=key)['id'] == identifier)
            deadline = time.monotonic() + 35
            while True:
                record = request(admin, 'runs/' + identifier)
                if record['state'] != 'queued': break
                require(time.monotonic() < deadline); time.sleep(.25)
            require(record['state'] == state and record['decision'] == decision
                and record['result']['executionEngine'] == 'python-synthetic')
            require(request(viewer, 'runs/' + identifier)['id'] == identifier)
            request(other, 'runs/' + identifier, expected=404)
            gate = request(admin, 'runs/' + identifier + '/gate')
            require(gate['deploymentAllowed'] is False and gate['policyEngine'] == 'opa-rego'
                and gate['policyStatus'] == 'evaluated' and gate['signed'] is False)
            review = {'decision': 'approved', 'reason': 'Owned synthetic enterprise pilot', 'expectedReviewSequence': 0}
            request(editor, 'runs/' + identifier + '/reviews', 'POST', review, expected=403)
            request(viewer, 'runs/' + identifier + '/reviews', 'POST', review, expected=403)
            request(other, 'runs/' + identifier + '/reviews', 'POST', review, expected=404)
            if scenario == 'pass':
                request(admin, 'runs/' + identifier + '/reviews', 'POST', review)
                require(request(admin, 'runs/' + identifier + '/gate')['deploymentAllowed'] is True)
                request(admin, 'runs/' + identifier + '/reviews', 'POST',
                    {'decision': 'rejected', 'reason': 'Owned pilot approval revocation', 'expectedReviewSequence': 1})
                require(request(admin, 'runs/' + identifier + '/gate')['deploymentAllowed'] is False)
                history = request(admin, 'runs/' + identifier + '/reviews')
                require(len(history) == 2 and [row['decision'] for row in history] == ['rejected', 'approved'])
            else:
                request(admin, 'runs/' + identifier + '/reviews', 'POST', review, expected=409)
                require(request(admin, 'runs/' + identifier + '/gate')['deploymentAllowed'] is False)
            created.append(identifier)
        request(viewer, 'runs', 'POST', {'scenario': 'pass', 'requiresApproval': True},
            expected=403, key=str(uuid.uuid4()))
        require(len(created) == len(set(created)) == 4)
        require(not any(row['id'] in created for row in request(other, 'runs')))
    finally:
        original_error = sys.exc_info()[0] is not None
        failed = False
        for client in clients:
            try: client.logout()
            except Exception: failed = True
        if not original_error:
            require(not failed and all(not c.logged and not c.provider_session_owned for c in clients))
    return validate_result({'completed': True, 'actualFederatedLogins': 4, 'actualPythonEvaluations': 4,
        'allRequiredDecisionStatesVerified': True, 'sameRequestIdempotencyVerified': True,
        'viewerWritesAndNonAdminReviewsRefused': True, 'foreignReadsAndReviewsRefused': True,
        'administratorApprovalThenRevocationVerified': True, 'nonpassApprovalRefused': True,
        'actualOpaGateVerified': True, 'allApplicationSessionsLoggedOut': True,
        'fixtureBusinessWritesOnly': True, 'paidProviderCallsPerformed': False,
        'productionDeploymentPerformed': False, 'customerPilotVerified': False})


if __name__ == '__main__':
    import traceback
    try:
        accounts = json.loads(pathlib.Path('/fixture/accounts.json').read_text())
        target = json.loads(pathlib.Path('/fixture/enterprise-configuration.json').read_text())
        print(json.dumps(verify('/fixture/certificates/ca.crt', accounts, target)))
    except Exception as error:
        print(json.dumps({'completed': False, 'code': 'SYNTHETIC_HTTPS_PROTOCOL_UNVERIFIED',
            'errorType': type(error).__name__, 'httpObservation': getattr(error, 'observation', None),
            'failureLocations': [{'file': pathlib.Path(frame.filename).name, 'line': frame.lineno}
                for frame in traceback.extract_tb(error.__traceback__)[-12:]]}))
        raise SystemExit(1)
