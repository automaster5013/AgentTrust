"""Failure and boundary controls for operator workspace provisioning."""
import copy
import importlib.util
import json
import os
import pathlib
import tempfile
import unittest
import uuid
from unittest.mock import patch
from stack_workspace_onboarding import OnboardingRefused, Provisioner, parse_manifest
from stack_workspace_identity import LocalWorkspaceIdentity
from stack_workspace_suspension import cohort_from_journal, suspend

SPEC = importlib.util.spec_from_file_location('onboarding_cli', pathlib.Path(__file__).with_name('stack-workspace-onboarding.py'))
CLI = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CLI)


def sample():
    return {'schemaVersion': 1, 'organizationId': str(uuid.uuid4()), 'projectId': str(uuid.uuid4()),
            'members': [{'username': 'workspace-admin', 'role': 'admin'},
                        {'username': 'workspace-viewer', 'role': 'viewer'}]}


class Provider:
    def __init__(self):
        self.users, self.roles, self.calls = {}, {}, []
        self.available = {name: {'id': str(uuid.uuid4()), 'name': name, 'composite': False,
                                 'clientRole': False} for name in ['admin', 'editor', 'viewer']}
        self.fail_create = self.fail_enable = self.fail_disable = False
        self.unknown_create = False
        self.wrong_scope = self.extra_role = self.client_admin = False

    def read(self, path):
        self.calls.append(('GET', path))
        if path.startswith('/users?'):
            name = path.split('username=')[1].split('&')[0]
            return [copy.deepcopy(v) for v in self.users.values() if v['username'] == name]
        identifier = path.split('/')[2]
        if path.endswith('/available'):
            return list(copy.deepcopy(self.available).values())
        if path.endswith('/composite'):
            roles = [copy.deepcopy(self.available[r]) for r in self.roles[identifier]]
            if self.extra_role:
                roles.append(copy.deepcopy(self.available['editor']))
            return roles
        if path.endswith('/role-mappings'):
            return {'clientMappings': {'realm-management': {}}} if self.client_admin else {}
        user = copy.deepcopy(self.users[identifier])
        if self.wrong_scope:
            user['attributes']['agenttrust_project'] = [str(uuid.uuid4())]
        return user

    def create_user(self, body):
        self.calls.append(('POST', '/users'))
        if self.fail_create:
            raise OSError('SENSITIVE_PROVIDER_MESSAGE_MUST_NOT_BE_EXPOSED')
        identifier = str(uuid.uuid4())
        self.users[identifier] = {**copy.deepcopy(body), 'id': identifier}
        self.roles[identifier] = []
        if self.unknown_create:
            raise TimeoutError('created but response was lost')
        return identifier

    def write(self, path, method, value):
        self.calls.append((method, path))
        identifier = path.split('/')[2]
        if path.endswith('/realm'):
            self.roles[identifier] = [row['name'] for row in value]
            return
        if value['enabled'] and self.fail_enable and any(u['enabled'] for u in self.users.values()):
            raise TimeoutError('second activation did not complete')
        if not value['enabled'] and self.fail_disable:
            raise OSError('provider unavailable for containment')
        self.users[identifier] = copy.deepcopy(value)


class ManifestTests(unittest.TestCase):
    def test_valid_dynamic_scope(self):
        body = sample()
        self.assertEqual(parse_manifest(json.dumps(body).encode()), body)

    def test_ambiguous_malformed_and_unbounded_json_refused(self):
        for raw in [b'', b' ' * 32769, b'\xff', b'{"schemaVersion":1,"schemaVersion":1}',
                    b'{"schemaVersion":NaN}', b'[' * 1500]:
            with self.subTest(rawLength=len(raw)), self.assertRaises(OnboardingRefused):
                parse_manifest(raw)

    def test_foreign_fields_roles_and_scope_refused(self):
        mutations = [lambda b: b.update(schemaVersion=True),
                     lambda b: b.update(organizationId=str(uuid.UUID(int=0))),
                     lambda b: b.update(projectId=b['projectId'].upper()),
                     lambda b: b.update(password='secret'),
                     lambda b: b['members'][0].update(role=['admin']),
                     lambda b: b['members'][0].update(role='realm-admin'),
                     lambda b: b['members'][0].update(username='demo-admin'),
                     lambda b: b['members'][0].update(username='../admin'),
                     lambda b: b['members'][0].update(actorId=str(uuid.uuid4())),
                     lambda b: b['members'][1].update(username=b['members'][0]['username']),
                     lambda b: b.update(members=b['members'] * 11),
                     lambda b: b.update(members=[{'username': 'workspace-viewer', 'role': 'viewer'}])]
        for mutation in mutations:
            body = sample()
            mutation(body)
            with self.subTest(body=body), self.assertRaises(OnboardingRefused):
                parse_manifest(json.dumps(body).encode())


class ProvisioningTests(unittest.TestCase):
    def run_provisioner(self, api, body=None):
        states = []
        state = Provisioner(api, states.append).execute(sample() if body is None else body)
        return state, states

    def test_every_user_disabled_until_complete_cohort_is_verified(self):
        api = Provider()
        state, states = self.run_provisioner(api)
        self.assertTrue(state['completed'])
        self.assertEqual(len(api.users), 2)
        self.assertTrue(all(u['enabled'] for u in api.users.values()))
        self.assertTrue(all(s['completed'] is False for s in states[:-1]))
        activation = next(i for i, s in enumerate(states) if s['stage'] == 'activating-verified-cohort')
        self.assertEqual(len(states[activation]['members']), 2)
        self.assertTrue(all(r['actorId'] for r in states[activation]['members']))
        self.assertEqual(len({r['password'] for r in state['members']}), 2)
        self.assertTrue(all(len(r['password']) == 48 for r in state['members']))

    def test_existing_account_collision_prevents_all_mutation(self):
        api, body = Provider(), sample()
        existing = str(uuid.uuid4())
        api.users[existing] = {'username': body['members'][1]['username'], 'enabled': True}
        before = copy.deepcopy(api.users)
        with self.assertRaises(OnboardingRefused):
            self.run_provisioner(api, body)
        self.assertEqual(api.users, before)
        self.assertTrue(all(method == 'GET' for method, _ in api.calls))

    def test_unknown_create_is_never_retried_adopted_or_claimed_rolled_back(self):
        api, states = Provider(), []
        api.unknown_create = True
        with self.assertRaises(TimeoutError):
            Provisioner(api, states.append).execute(sample())
        self.assertEqual(api.calls.count(('POST', '/users')), 1)
        self.assertEqual(len(api.users), 1)
        self.assertFalse(next(iter(api.users.values()))['enabled'])
        self.assertTrue(states[-1]['createResponseUncertain'])
        self.assertIsNone(states[-1]['members'][0]['actorId'])
        self.assertFalse(states[-1]['completed'])

    def test_failed_second_activation_disables_all_known_users(self):
        api, states = Provider(), []
        api.fail_enable = True
        with self.assertRaises(TimeoutError):
            Provisioner(api, states.append).execute(sample())
        self.assertFalse(any(u['enabled'] for u in api.users.values()))
        self.assertTrue(states[-1]['allKnownUsersDisabledAfterFailure'])
        self.assertEqual(states[-1]['stage'], 'operator-reconciliation-required')


class TransportAndCustodyTests(unittest.TestCase):
    def test_location_must_be_exact_local_realm_and_canonical_actor(self):
        identifier = str(uuid.uuid4())
        for location in ['https://attacker.invalid/' + identifier,
                         'http://127.0.0.1:4322/admin/realms/other/users/' + identifier,
                         'http://127.0.0.1:4322/admin/realms/agenttrust/users/' + identifier + '?x=1',
                         'http://127.0.0.1:4322/admin/realms/agenttrust/users/' + str(uuid.UUID(int=0))]:
            api = LocalWorkspaceIdentity(CLI.ROOT)
            with self.subTest(location=location), patch.object(api, 'wire', return_value=(b'', location)):
                with self.assertRaises(OnboardingRefused):
                    api.create_user({})
                self.assertEqual(api.created, set())

    def test_mutation_of_non_created_identity_is_refused_before_network(self):
        api = LocalWorkspaceIdentity(CLI.ROOT)
        with patch.object(api, 'wire') as wire:
            with self.assertRaises(OnboardingRefused):
                api.write('/users/' + str(uuid.uuid4()), 'PUT', {'enabled': True})
            wire.assert_not_called()

    def test_non_allowlisted_read_is_refused_before_network(self):
        api = LocalWorkspaceIdentity(CLI.ROOT)
        with patch.object(api, 'wire') as wire:
            for path in ['/users/../../master', '/users?username=admin&exact=false',
                         '/clients/foreign', '/roles/realm-admin', '//attacker.invalid']:
                with self.subTest(path=path), self.assertRaises(OnboardingRefused):
                    api.read(path)
            wire.assert_not_called()

    def test_actual_private_journal_permissions_and_atomic_replacement(self):
        with tempfile.TemporaryDirectory(prefix='onboarding-custody-', dir=CLI.ROOT / '.local') as outer:
            directory = pathlib.Path(outer) / 'owned'
            CLI.private_directory(directory)
            first = {'password': 'synthetic-secret', 'stage': 'prepared'}
            CLI.private_checkpoint(directory, first)
            self.assertEqual(json.loads((directory / 'journal.json').read_text()), first)
            second = {'password': 'synthetic-secret', 'stage': 'completed'}
            CLI.private_checkpoint(directory, second)
            self.assertEqual(json.loads((directory / 'journal.json').read_text()), second)
            self.assertFalse((directory / 'journal.next.json').exists())
            if os.name == 'nt':
                CLI.windows_owner_only((directory, directory / 'journal.json'))
            else:
                self.assertEqual(directory.stat().st_mode & 0o077, 0)
                self.assertEqual((directory / 'journal.json').stat().st_mode & 0o077, 0)
    def test_containment_failure_is_recorded_and_not_reported_successful(self):
        api, states = Provider(), []
        api.fail_enable = api.fail_disable = True
        with self.assertRaises(TimeoutError):
            Provisioner(api, states.append).execute(sample())
        self.assertFalse(states[-1]['allKnownUsersDisabledAfterFailure'])
        self.assertFalse(states[-1]['completed'])

    def test_wrong_scope_extra_role_client_admin_and_composite_role_never_activate(self):
        for failure in ['wrong_scope', 'extra_role', 'client_admin', 'composite']:
            api, states = Provider(), []
            if failure == 'composite':
                api.available['admin']['composite'] = True
            else:
                setattr(api, failure, True)
            with self.subTest(failure=failure), self.assertRaises(OnboardingRefused):
                Provisioner(api, states.append).execute(sample())
            self.assertFalse(any(u['enabled'] for u in api.users.values()))
            self.assertFalse(states[-1]['completed'])

    def test_journal_failure_before_creation_prevents_provider_mutation(self):
        api = Provider()
        def unavailable(_):
            raise OSError('journal storage unavailable')
        with self.assertRaises(OSError):
            Provisioner(api, unavailable).execute(sample())
        self.assertTrue(all(method == 'GET' for method, _ in api.calls))

    def test_journal_failure_after_create_disables_user_without_deleting_it(self):
        api, states = Provider(), []
        def checkpoint(state):
            states.append(state)
            if state['members'] and state['members'][0]['actorId'] and state['stage'] != 'operator-reconciliation-required':
                raise OSError('journal flush failed')
        with self.assertRaises(OSError):
            Provisioner(api, checkpoint).execute(sample())
        self.assertEqual(len(api.users), 1)
        self.assertFalse(next(iter(api.users.values()))['enabled'])
        self.assertTrue(states[-1]['allKnownUsersDisabledAfterFailure'])


class SuspensionProvider(Provider):
    def __init__(self):
        super().__init__()
        self.suspensions = []
        self.fail_logout = self.keep_sessions = False

    def read(self, path):
        if path.endswith('/sessions'):
            return [{'id': 'synthetic-session'}] if self.keep_sessions else []
        return super().read(path)

    def suspend_user(self, identifier, user):
        self.suspensions.append(identifier)
        self.users[identifier] = {**copy.deepcopy(user), 'enabled': False}
        if self.fail_logout:
            raise TimeoutError('provider logout response unknown')


class SuspensionTests(unittest.TestCase):
    def prepared(self):
        api, states = SuspensionProvider(), []
        state = Provisioner(api, states.append).execute(sample())
        cohort = cohort_from_journal(json.dumps(state).encode())
        return api, state, cohort

    def test_completed_exact_journal_suspends_every_member_without_deleting_accounts(self):
        api, _, cohort = self.prepared()
        states = []
        result = suspend(api, cohort, states.append)
        self.assertTrue(result['completed'])
        self.assertEqual(result['verifiedDisabledMembers'], 2)
        self.assertTrue(result['providerSessionRevocationVerified'])
        self.assertFalse(result['applicationSessionRevocationVerifiedHere'])
        self.assertFalse(result['accountsDeleted'])
        self.assertEqual(len(api.users), 2)
        self.assertFalse(any(u['enabled'] for u in api.users.values()))
        self.assertNotIn('password', json.dumps(result))

    def test_changed_scope_or_role_refuses_entire_cohort_before_any_disable(self):
        for change in ['project', 'organization', 'role', 'username']:
            api, _, cohort = self.prepared()
            identifier = cohort['members'][1]['actorId']
            if change == 'role':
                api.roles[identifier] = ['admin']
            elif change == 'username':
                api.users[identifier]['username'] = 'changed-identity'
            else:
                api.users[identifier]['attributes']['agenttrust_' + change] = [str(uuid.uuid4())]
            with self.subTest(change=change), self.assertRaises(OnboardingRefused):
                suspend(api, cohort, lambda _: None)
            self.assertEqual(api.suspensions, [])
            self.assertTrue(all(u['enabled'] for u in api.users.values()))

    def test_unknown_logout_is_not_retried_or_counted_as_completed(self):
        api, _, cohort = self.prepared()
        api.fail_logout = True
        states = []
        with self.assertRaises(TimeoutError):
            suspend(api, cohort, states.append)
        self.assertEqual(len(api.suspensions), 1)
        self.assertFalse(states[-1]['completed'])
        self.assertEqual(states[-1]['verifiedDisabledMembers'], 0)
        self.assertFalse(states[-1]['providerSessionRevocationVerified'])

    def test_remaining_provider_sessions_prevent_completion(self):
        api, _, cohort = self.prepared()
        api.keep_sessions = True
        states = []
        with self.assertRaises(OnboardingRefused):
            suspend(api, cohort, states.append)
        self.assertFalse(states[-1]['completed'])
        self.assertFalse(states[-1]['providerSessionRevocationVerified'])

    def test_partial_unknown_duplicate_or_substituted_journal_refused(self):
        _, original, _ = self.prepared()
        changes = [lambda s: s.update(completed=False), lambda s: s.update(createResponseUncertain=True),
                   lambda s: s.update(schemaVersion=True), lambda s: s.update(manifestSha256='0' * 64),
                   lambda s: s['members'][1].update(actorId=s['members'][0]['actorId']),
                   lambda s: s['members'][1].update(username='demo-viewer'),
                   lambda s: s.update(extraField='unexpected')]
        for change in changes:
            state = copy.deepcopy(original)
            change(state)
            with self.subTest(change=change), self.assertRaises(OnboardingRefused):
                cohort_from_journal(json.dumps(state).encode())
        with self.assertRaises(OnboardingRefused):
            cohort_from_journal(b'{"completed":true,"completed":true}')


if __name__ == '__main__':
    unittest.main()
