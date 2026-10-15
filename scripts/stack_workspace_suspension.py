"""Suspend only an exact operator-provisioned development cohort; no account deletion."""
import copy
import json
import re
from stack_workspace_onboarding import ROLES, canonical_uuid, parse_manifest, require, effective_realm_management_roles


def cohort_from_journal(raw):
    require(isinstance(raw, bytes) and 0 < len(raw) <= 32768)
    def pairs(values):
        out = {}
        for key, value in values:
            require(key not in out)
            out[key] = value
        return out
    try:
        body = json.loads(raw.decode('utf-8'), object_pairs_hook=pairs)
    except (UnicodeError, json.JSONDecodeError, RecursionError):
        require(False)
    require(isinstance(body, dict) and set(body) == {'schemaVersion', 'completed', 'manifestSha256',
            'organizationId', 'projectId', 'stage', 'members', 'createResponseUncertain',
            'allKnownUsersDisabledAfterFailure'} and body.get('completed') is True and body.get('stage') == 'completed'
            and body.get('createResponseUncertain') is False and type(body.get('schemaVersion')) is int
            and body['schemaVersion'] == 1)
    rows = body.get('members')
    require(isinstance(rows, list) and 1 <= len(rows) <= 20)
    members, actors = [], set()
    for row in rows:
        require(isinstance(row, dict) and set(row) == {'username', 'role', 'password', 'actorId'}
                and isinstance(row['password'], str) and re.fullmatch('[a-f0-9]{48}', row['password']))
        identifier = canonical_uuid(row.get('actorId'))
        require(identifier not in actors)
        actors.add(identifier)
        members.append({'actorId': identifier, 'username': row.get('username'), 'role': row.get('role')})
    manifest = {'schemaVersion': 1, 'organizationId': body.get('organizationId'),
                'projectId': body.get('projectId'),
                'members': [{'username': r['username'], 'role': r['role']} for r in members]}
    parse_manifest(json.dumps(manifest).encode())
    require(isinstance(body.get('manifestSha256'), str) and re.fullmatch('[a-f0-9]{64}', body['manifestSha256']))
    from stack_workspace_onboarding import manifest_digest
    require(manifest_digest(manifest) == body['manifestSha256'], 'WORKSPACE_JOURNAL_MANIFEST_MISMATCH')
    return {'organizationId': manifest['organizationId'], 'projectId': manifest['projectId'],
            'members': members, 'manifestSha256': body['manifestSha256']}


def verified_member(api, cohort, member):
    user = api.read('/users/' + member['actorId'])
    require(isinstance(user, dict) and user.get('id') == member['actorId']
            and user.get('username') == member['username']
            and user.get('attributes', {}).get('agenttrust_organization') == [cohort['organizationId']]
            and user.get('attributes', {}).get('agenttrust_project') == [cohort['projectId']],
            'WORKSPACE_SUSPENSION_SCOPE_UNVERIFIED')
    roles = api.read('/users/' + member['actorId'] + '/role-mappings/realm/composite')
    require(isinstance(roles, list) and len(roles) <= 100)
    require([r.get('name') for r in roles if isinstance(r, dict) and r.get('name') in ROLES] == [member['role']],
            'WORKSPACE_SUSPENSION_ROLE_UNVERIFIED')
    mappings = api.read('/users/' + member['actorId'] + '/role-mappings')
    require(isinstance(mappings, dict) and not mappings.get('clientMappings'))
    require(not effective_realm_management_roles(api, member['actorId']),
            'WORKSPACE_INHERITED_ADMINISTRATION_REFUSED')
    return user


def suspend(api, cohort, checkpoint):
    # Preflight every record before any provider mutation. Never accept a username
    # search substitute or a newly reassigned organization/project as ownership.
    for member in cohort['members']:
        verified_member(api, cohort, member)
    state = {'completed': False, 'stage': 'suspending', 'manifestSha256': cohort['manifestSha256'],
             'memberCount': len(cohort['members']), 'verifiedDisabledMembers': 0,
             'providerSessionRevocationVerified': False,
             'applicationSessionRevocationVerifiedHere': False, 'accountsDeleted': False}
    checkpoint(copy.deepcopy(state))
    try:
        for member in cohort['members']:
            user = verified_member(api, cohort, member)
            api.suspend_user(member['actorId'], user)
            disabled = verified_member(api, cohort, member)
            require(disabled.get('enabled') is False)
            require(api.read('/users/' + member['actorId'] + '/sessions') == [],
                    'WORKSPACE_PROVIDER_SESSIONS_REMAIN')
            state['verifiedDisabledMembers'] += 1
            checkpoint(copy.deepcopy(state))
        # One final cohort read prevents counting a partial disable as completion.
        for member in cohort['members']:
            require(verified_member(api, cohort, member).get('enabled') is False)
            require(api.read('/users/' + member['actorId'] + '/sessions') == [])
        state.update(completed=True, stage='suspended', providerSessionRevocationVerified=True)
        checkpoint(copy.deepcopy(state))
        return state
    except Exception:
        state.update(completed=False, stage='suspension-reconciliation-required')
        checkpoint(copy.deepcopy(state))
        raise
