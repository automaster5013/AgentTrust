"""Bounded operator-driven workspace identities; no self-service or existing-user edits."""
import copy
import hashlib
import json
import re
import secrets
import urllib.parse
import uuid

ROLES = frozenset(('admin', 'editor', 'viewer'))


class OnboardingRefused(ValueError):
    def __init__(self, code='WORKSPACE_ONBOARDING_REFUSED'):
        self.code = code
        super().__init__(code)


def require(condition, code='WORKSPACE_ONBOARDING_REFUSED'):
    if not condition:
        raise OnboardingRefused(code)


def canonical_uuid(value):
    require(isinstance(value, str) and re.fullmatch(r'[a-f0-9-]{36}', value) is not None)
    try:
        parsed = uuid.UUID(value)
    except ValueError:
        raise OnboardingRefused() from None
    require(str(parsed) == value and parsed.int != 0)
    return value


def parse_manifest(raw):
    require(isinstance(raw, bytes) and 0 < len(raw) <= 32768)

    def pairs(rows):
        value = {}
        for key, item in rows:
            require(key not in value)
            value[key] = item
        return value

    try:
        body = json.loads(raw.decode('utf-8'), object_pairs_hook=pairs,
                          parse_constant=lambda _: (_ for _ in ()).throw(OnboardingRefused()))
    except (UnicodeError, json.JSONDecodeError, RecursionError):
        raise OnboardingRefused() from None
    require(isinstance(body, dict) and set(body) == {'schemaVersion', 'organizationId', 'projectId', 'members'})
    require(type(body['schemaVersion']) is int and body['schemaVersion'] == 1)
    canonical_uuid(body['organizationId'])
    canonical_uuid(body['projectId'])
    require(isinstance(body['members'], list) and 1 <= len(body['members']) <= 20)
    names = set()
    for member in body['members']:
        require(isinstance(member, dict) and set(member) == {'username', 'role'})
        name, role = member['username'], member['role']
        require(isinstance(name, str) and re.fullmatch(r'[a-z][a-z0-9-]{2,40}', name) is not None)
        require(name not in names and name not in {'demo-admin', 'demo-editor', 'demo-viewer', 'other-admin'})
        require(isinstance(role, str) and role in ROLES)
        names.add(name)
    require(any(row['role'] == 'admin' for row in body['members']), 'WORKSPACE_ADMIN_REQUIRED')
    return body


def manifest_digest(manifest):
    return hashlib.sha256(json.dumps(manifest, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def effective_realm_management_roles(api, identifier):
    canonical_uuid(identifier)
    clients = api.read('/clients?clientId=realm-management')
    require(isinstance(clients, list) and len(clients) == 1
            and isinstance(clients[0], dict) and clients[0].get('clientId') == 'realm-management',
            'WORKSPACE_MANAGEMENT_CLIENT_UNVERIFIED')
    client = canonical_uuid(clients[0].get('id'))
    roles = api.read('/users/' + identifier + '/role-mappings/clients/' + client + '/composite')
    require(isinstance(roles, list) and len(roles) <= 100 and all(isinstance(row, dict) for row in roles),
            'WORKSPACE_MANAGEMENT_ROLES_UNVERIFIED')
    return roles


class Provisioner:
    """Transport must return the authenticated create Location id, never a search substitute.

    Every user is created disabled. Passwords, actor ids and progress are saved by the
    caller's private journal callback before activation. A failed request is never
    retried here. Any uncertainty prevents completion; existing users are never adopted.
    """
    def __init__(self, api, checkpoint):
        self.api = api
        self.checkpoint = checkpoint

    def preflight(self, manifest):
        # Re-validate in case an in-memory caller bypassed parse_manifest.
        manifest = parse_manifest(json.dumps(manifest).encode())
        for member in manifest['members']:
            query = urllib.parse.urlencode({'username': member['username'], 'exact': 'true', 'max': '2'})
            require(self.api.read('/users?' + query) == [], 'WORKSPACE_ACCOUNT_ALREADY_EXISTS')
        return manifest

    def verify_user(self, identifier, manifest, member, enabled):
        canonical_uuid(identifier)
        user = self.api.read('/users/' + identifier)
        require(isinstance(user, dict) and user.get('id') == identifier
                and user.get('username') == member['username'] and user.get('enabled') is enabled
                and user.get('attributes', {}).get('agenttrust_organization') == [manifest['organizationId']]
                and user.get('attributes', {}).get('agenttrust_project') == [manifest['projectId']]
                and not user.get('federatedIdentities') and not user.get('requiredActions'),
                'WORKSPACE_IDENTITY_SCOPE_UNVERIFIED')
        return user

    def verify_role(self, identifier, role):
        rows = self.api.read('/users/' + identifier + '/role-mappings/realm/composite')
        require(isinstance(rows, list) and len(rows) <= 100)
        recognized = [row.get('name') for row in rows if isinstance(row, dict) and row.get('name') in ROLES]
        require(recognized == [role], 'WORKSPACE_IDENTITY_ROLE_UNVERIFIED')
        require(not effective_realm_management_roles(self.api, identifier),
                'WORKSPACE_INHERITED_ADMINISTRATION_REFUSED')
        # Workspace identities must never gain realm/client administration access.
        mappings = self.api.read('/users/' + identifier + '/role-mappings')
        require(isinstance(mappings, dict) and not mappings.get('clientMappings'),
                'WORKSPACE_IDENTITY_ADMINISTRATION_REFUSED')

    def execute(self, manifest):
        manifest = self.preflight(manifest)
        state = {'schemaVersion': 1, 'completed': False, 'manifestSha256': manifest_digest(manifest),
                 'organizationId': manifest['organizationId'], 'projectId': manifest['projectId'],
                 'stage': 'prepared', 'members': [], 'createResponseUncertain': False,
                 'allKnownUsersDisabledAfterFailure': None}
        self.checkpoint(copy.deepcopy(state))
        try:
            for member in manifest['members']:
                row = {**member, 'password': secrets.token_hex(24), 'actorId': None}
                state['members'].append(row)
                state.update(stage='creating-disabled-user', createResponseUncertain=True)
                self.checkpoint(copy.deepcopy(state))
                representation = {'username': row['username'], 'enabled': False,
                    'email': row['username'] + '@agenttrust.invalid', 'emailVerified': True,
                    'firstName': 'Synthetic', 'lastName': 'Workspace', 'requiredActions': [],
                    'attributes': {'agenttrust_organization': [manifest['organizationId']],
                                   'agenttrust_project': [manifest['projectId']]},
                    'credentials': [{'type': 'password', 'value': row['password'], 'temporary': False}]}
                identifier = self.api.create_user(representation)
                row['actorId'] = canonical_uuid(identifier)
                state['createResponseUncertain'] = False
                self.checkpoint(copy.deepcopy(state))
                self.verify_user(identifier, manifest, row, False)
                choices = self.api.read('/users/' + identifier + '/role-mappings/realm/available')
                require(isinstance(choices, list) and len(choices) <= 100)
                chosen = [r for r in choices if isinstance(r, dict) and r.get('name') == row['role']]
                require(len(chosen) == 1 and chosen[0].get('composite') is False
                        and chosen[0].get('clientRole') is False, 'WORKSPACE_ROLE_CONFIGURATION_REFUSED')
                canonical_uuid(chosen[0].get('id'))
                self.api.write('/users/' + identifier + '/role-mappings/realm', 'POST', chosen)
                self.verify_role(identifier, row['role'])
            # Recheck the entire disabled cohort immediately before any activation.
            state['stage'] = 'verifying-disabled-cohort'
            self.checkpoint(copy.deepcopy(state))
            for row in state['members']:
                self.verify_user(row['actorId'], manifest, row, False)
                self.verify_role(row['actorId'], row['role'])
            state['stage'] = 'activating-verified-cohort'
            self.checkpoint(copy.deepcopy(state))
            for row in state['members']:
                user = self.verify_user(row['actorId'], manifest, row, False)
                self.api.write('/users/' + row['actorId'], 'PUT', {**user, 'enabled': True})
                self.verify_user(row['actorId'], manifest, row, True)
                self.verify_role(row['actorId'], row['role'])
            state.update(completed=True, stage='completed')
            self.checkpoint(copy.deepcopy(state))
            return state
        except Exception:
            # Keep failed users disabled and retain the journal. Never delete, adopt,
            # replay create/password requests or claim unknown creations were rolled back.
            disabled = True
            for row in state['members']:
                if not row['actorId']:
                    continue
                try:
                    user = self.api.read('/users/' + row['actorId'])
                    require(user.get('id') == row['actorId'] and user.get('username') == row['username'])
                    self.api.write('/users/' + row['actorId'], 'PUT', {**user, 'enabled': False})
                    require(self.api.read('/users/' + row['actorId']).get('enabled') is False)
                except Exception:
                    disabled = False
            state.update(completed=False, stage='operator-reconciliation-required',
                         allKnownUsersDisabledAfterFailure=disabled)
            self.checkpoint(copy.deepcopy(state))
            raise
