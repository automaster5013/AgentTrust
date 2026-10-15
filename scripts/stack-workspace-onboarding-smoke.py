"""Create owned synthetic workspace identities, prove OIDC/RLS, then remove only them."""
import argparse
import hashlib
import json
import pathlib
import secrets
import subprocess
import sys
import time
import traceback
import urllib.error
import uuid
from stack_identity_admin import IdentityAdmin
from stack_test_client import StackClient
from stack_workspace_onboarding import require

ROOT = pathlib.Path(__file__).resolve().parent.parent


def account_fingerprints(admin):
    rows = admin.request('/users?first=0&max=101')
    require(isinstance(rows, list) and len(rows) <= 100)
    return {r['id']: hashlib.sha256(json.dumps({
                'identity': admin.request('/users/' + r['id']),
                'roles': admin.request('/users/' + r['id'] + '/role-mappings')},
                sort_keys=True, separators=(',', ':')).encode()).hexdigest() for r in rows}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--allow-owned-evaluations', action='store_true',
                        help='Run owned synthetic evaluations only on a disposable acceptance environment.')
    args = parser.parse_args()
    report = {'completed': False, 'checks': [], 'rawCredentialsPrinted': False,
              'productionIdentityConfigured': False, 'existingUsersModified': False,
              'businessWritesRequested': args.allow_owned_evaluations}
    clients, owned, journals = [], [], []
    fixture = ROOT / '.local' / ('workspace-onboarding-probe-' + str(uuid.uuid4()))
    fixture.mkdir(mode=0o700)
    original = None
    try:
        report['stage']='preserve-original-identity'
        with IdentityAdmin(ROOT) as admin:
            original = account_fingerprints(admin)
        org, project, second_project, foreign_org, foreign_project = [str(uuid.uuid4()) for _ in range(5)]
        prefix = 'ws-' + secrets.token_hex(6)
        manifests = [
            {'schemaVersion': 1, 'organizationId': org, 'projectId': project,
             'members': [{'username': prefix + '-' + role, 'role': role} for role in ['admin', 'editor', 'viewer']]},
            {'schemaVersion': 1, 'organizationId': org, 'projectId': second_project,
             'members': [{'username': prefix + '-project', 'role': 'admin'}]},
            {'schemaVersion': 1, 'organizationId': foreign_org, 'projectId': foreign_project,
             'members': [{'username': prefix + '-foreign', 'role': 'admin'}]}]
        configured = json.loads((ROOT / '.local/stack/demo-credentials.json').read_text(encoding='utf-8'))
        seeded = {(row['organizationId'], row['projectId']) for row in configured}
        require(all((manifest['organizationId'], manifest['projectId']) not in seeded for manifest in manifests))
        report['nonSeededWorkspaceScopesVerified'] = True
        report['fixtureOrganizations'] = 2
        report['fixtureProjects'] = 3
        credentials = []
        report['stage']='provision-owned-cohorts'
        for index, manifest in enumerate(manifests):
            path = fixture / ('manifest-' + str(index) + '.json')
            path.open('x', encoding='utf-8').write(json.dumps(manifest))
            plan = subprocess.run([sys.executable, 'scripts/stack-workspace-onboarding.py',
                '--manifest', str(path)], cwd=ROOT, capture_output=True, text=True, timeout=30)
            require(plan.returncode == 0 and json.loads(plan.stdout)['executed'] is False)
            result = subprocess.run([sys.executable, 'scripts/stack-workspace-onboarding.py',
                '--manifest', str(path), '--execute'], cwd=ROOT, capture_output=True, text=True, timeout=180)
            safe = json.loads(result.stdout)
            if safe.get('privateJournalDirectory'):
                directory = pathlib.Path(safe['privateJournalDirectory'])
                require(directory.parent == ROOT / '.local' and directory.name.startswith('workspace-onboarding-'))
                journals.append(directory)
                journal = json.loads((directory / 'journal.json').read_text(encoding='utf-8'))
                # Even failed cohorts retain known identities for exact owned cleanup.
                for row in journal['members']:
                    if row['actorId']:
                        owned.append({**row, 'organizationId': manifest['organizationId'], 'projectId': manifest['projectId']})
                report['uncertainCreationObserved'] = report.get('uncertainCreationObserved', False) or journal['createResponseUncertain']
            require(result.returncode == 0 and safe['completed'], 'WORKSPACE_PROBE_PROVISIONING_UNVERIFIED')
            credentials.extend(owned[-len(manifest['members']):])
        report['checks'].append('default CLI plan has no provider contact; five non-seeded identities provisioned in three workspace scopes')
        by_name = {}
        report['stage']='verify-new-identity-and-role'
        for row in credentials:
            client = StackClient('http://127.0.0.1:4320', credentials, {}, clients)
            client.login(row['username'])
            require(client.request('runs') == [] and client.request('campaigns') == [])
            by_name[row['username']] = client
        report['checks'].append('actual authorization-code PKCE login binds every generated actor and scope; every fresh workspace starts empty')
        administrator, editor, viewer = [by_name[prefix + '-' + role] for role in ['admin', 'editor', 'viewer']]
        viewer.request('runs', 'POST', {'scenario': 'pass', 'requiresApproval': True},
                       headers={'Idempotency-Key': str(uuid.uuid4())}, expected=403)
        report['checks'].append('new viewer cannot create evaluations; refusal creates no business record')
        if args.allow_owned_evaluations:
            report['stage']='admit-new-workspace-evaluation'
            created = editor.request('runs', 'POST', {'scenario': 'pass', 'requiresApproval': True},
                                     headers={'Idempotency-Key': str(uuid.uuid4())})
            identifier = created['id']
            report['stage']='await-new-workspace-worker-completion'
            deadline = time.monotonic() + 35
            while True:
                record = administrator.request('runs/' + identifier)
                report['lastObservedRunState']=record.get('state') if record.get('state') in ['queued','succeeded','failed'] else 'invalid'
                report['lastObservedRunDecision']=record.get('decision') if record.get('decision') in ['pass','block','inconclusive'] else 'invalid'
                if record['state'] != 'queued':
                    break
                require(time.monotonic() < deadline, 'WORKSPACE_DISPATCH_TIMEOUT')
                time.sleep(.5)
            require(record['state'] == 'succeeded' and record['decision'] == 'pass')
            report['stage']='verify-new-workspace-review-and-cross-scope-boundaries'
            require(viewer.request('runs/' + identifier)['id'] == identifier)
            editor.request('runs/' + identifier + '/reviews', 'POST',
                           {'decision': 'approved', 'reason': 'Owned workspace role refusal', 'expectedReviewSequence': 0}, expected=403)
            viewer.request('runs/' + identifier + '/reviews', 'POST',
                           {'decision': 'approved', 'reason': 'Owned workspace role refusal', 'expectedReviewSequence': 0}, expected=403)
            administrator.request('runs/' + identifier + '/reviews', 'POST',
                                  {'decision': 'rejected', 'reason': 'Owned workspace acceptance remains blocked', 'expectedReviewSequence': 0})
            gate = administrator.request('runs/' + identifier + '/gate')
            require(gate['deploymentAllowed'] is False)
            for name in [prefix + '-project', prefix + '-foreign']:
                other = by_name[name]
                other.request('runs/' + identifier, expected=404)
                require(other.request('runs') == [])
            report['checks'].append('new editor actual Python evaluation, viewer read, admin-only rejection and blocked gate work; same-organization other-project and foreign-organization access return404')
        # Retain active application sessions while the operator suspends exactly
        # the first cohort, so provider emptiness alone cannot pass this check.
        report['stage']='suspend-owned-cohort'
        suspended = subprocess.run([sys.executable, 'scripts/stack-workspace-onboarding.py',
            '--suspend-journal', str(journals[0] / 'journal.json'), '--execute'],
            cwd=ROOT, capture_output=True, text=True, timeout=180)
        suspension = json.loads(suspended.stdout)
        require(suspended.returncode == 0 and suspension['completed']
                and suspension['disabledUsers'] == 3 and suspension['providerSessionRevocationVerified']
                and suspension['applicationSessionRevocationVerifiedHere'] is False,
                'WORKSPACE_SUSPENSION_UNVERIFIED')
        for client in [administrator, editor, viewer]:
            deadline = time.monotonic() + 15
            while True:
                try:
                    client.request('me', expected=401)
                    client.logged = False
                    break
                except AssertionError:
                    require(time.monotonic() < deadline)
                    time.sleep(.25)
        for name in [prefix + '-project', prefix + '-foreign']:
            by_name[name].request('me')
        denied = StackClient('http://127.0.0.1:4320', credentials, {}, clients)
        try:
            denied.login(prefix + '-viewer')
        except AssertionError:
            denied.request('me', expected=401)
        else:
            require(False, 'SUSPENDED_WORKSPACE_LOGIN_ACCEPTED')
        report['applicationSessionRevocationVerified'] = True
        report['suspendedAccountCannotLogin'] = True
        report['foreignWorkspaceSessionsPreserved'] = True
        report['checks'].append('operator suspension disables exactly its cohort; real signed logout revokes three existing Core sessions and future login fails while other workspaces remain authenticated')
        for client in reversed(clients):
            client.logout()
        report['checks'].append('all owned application and provider sessions closed')
        report.update(completed=True,stage='completed')
    except Exception as error:
        report.update(completed=False, errorType=type(error).__name__,
                      code=getattr(error, 'code', 'WORKSPACE_ONBOARDING_PROBE_UNVERIFIED'),
                      failureLocations=[{'file':pathlib.Path(t.filename).name,'line':t.lineno}
                                        for t in traceback.extract_tb(error.__traceback__)])
    finally:
        closed = True
        for client in reversed(clients):
            try:
                client.logout()
            except Exception:
                closed = False
        cleaned = original is not None
        try:
            with IdentityAdmin(ROOT) as admin:
                for row in reversed(owned):
                    require(row['actorId'] not in original)
                    actual = admin.request('/users/' + row['actorId'])
                    require(actual['username'] == row['username']
                            and actual['attributes']['agenttrust_organization'] == [row['organizationId']]
                            and actual['attributes']['agenttrust_project'] == [row['projectId']])
                    admin.request('/users/' + row['actorId'], 'DELETE')
                require(account_fingerprints(admin) == original)
        except Exception as error:
            cleaned = False
            report['cleanupErrorType'] = type(error).__name__
        report.update(ownSessionsLoggedOut=closed and all(not c.logged for c in clients),
                      ownedIdentitiesDeletedAndOriginalAccountsUnchanged=cleaned,
                      privateJournalsRetainedForAudit=True,
                      privateJournalCount=len(journals))
        report['completed'] = report['completed'] and cleaned and report['ownSessionsLoggedOut']
        target = ROOT / '.local' / ('stack-workspace-onboarding-' + str(uuid.uuid4()) + '.json')
        target.open('x', encoding='utf-8').write(json.dumps(report, indent=2) + '\n')
        print(json.dumps({'completed': report['completed'], 'checks': len(report['checks']),
                          'reportPath': str(target), 'businessWritesRequested': args.allow_owned_evaluations}))
    return 0 if report['completed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
