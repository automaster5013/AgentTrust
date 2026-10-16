"""Owned-realm broker installation; never invoke against an original realm."""
import copy
from stack_https_fixture_enterprise import FLOW, canonical, require, validate

BASE = '/admin/realms/agenttrust/'


def install(admin, target, external, manifest):
    # Validate the complete intended contract before issuing even a read.
    validate(target, external, manifest)
    users, _ = admin.wire(BASE + 'users?first=0&max=100&briefRepresentation=false')
    expected = {canonical(u['id']): u for u in target['users']}
    require(isinstance(users, list) and {u['id'] for u in users} == set(expected))
    before_users = {u['id']: copy.deepcopy(u) for u in users}
    profile_before, _ = admin.wire(BASE + 'users/profile')
    require(profile_before.get('unmanagedAttributePolicy', 'DISABLED') == 'DISABLED')
    before_roles = {}
    before_attributes = {}
    for uid, user in before_users.items():
        require(user['username'] == expected[uid]['username'])
        # The default user-profile policy omits unmanaged scope attributes
        # from ordinary user representations. Read them through the dedicated
        # read-only endpoint without enabling user-editable attributes.
        attributes, _ = admin.wire(BASE + 'users/' + uid + '/unmanagedAttributes')
        require(isinstance(attributes, dict))
        before_attributes[uid] = attributes
        links, _ = admin.wire(BASE + 'users/' + uid + '/federated-identity')
        require(links == [])
        roles, _ = admin.wire(BASE + 'users/' + uid + '/role-mappings/realm')
        before_roles[uid] = {r['id']: r for r in roles}
        require({r['name'] for r in roles} & {'admin', 'editor', 'viewer'} == set(expected[uid]['realmRoles']))
    providers, _ = admin.wire(BASE + 'identity-provider/instances')
    require(providers == [])
    flows, _ = admin.wire(BASE + 'authentication/flows')
    require(isinstance(flows, list) and any(f['alias'] == 'browser' and f['builtIn'] is True for f in flows)
        and all(f['alias'] != FLOW for f in flows))
    before_flows = {f['id']: copy.deepcopy(f) for f in flows}
    builtins = {}
    for flow in flows:
        if flow['builtIn']:
            rows, _ = admin.wire(BASE + 'authentication/flows/' + flow['alias'].replace(' ', '%20') + '/executions')
            builtins[flow['alias']] = rows

    admin.wire(BASE + 'authentication/flows', 'POST',
        {'alias': FLOW, 'description': 'Deny every unlinked first broker login',
         'providerId': 'basic-flow', 'topLevel': True, 'builtIn': False}, expected=201)
    executions = BASE + 'authentication/flows/' + FLOW + '/executions'
    admin.wire(executions + '/execution', 'POST', {'provider': 'deny-access-authenticator'}, expected=201)
    rows, _ = admin.wire(executions)
    require(len(rows) == 1 and rows[0]['providerId'] == 'deny-access-authenticator'
        and rows[0].get('authenticationFlow') is False)
    execution = copy.deepcopy(rows[0]); execution['requirement'] = 'REQUIRED'
    admin.wire(executions, 'PUT', execution, expected=204)
    rows, _ = admin.wire(executions)
    require(len(rows) == 1 and rows[0]['providerId'] == 'deny-access-authenticator'
        and rows[0]['requirement'] == 'REQUIRED')
    provider = target['identityProviders'][0]
    admin.wire(BASE + 'identity-provider/instances', 'POST', provider, expected=201)
    observed, _ = admin.wire(BASE + 'identity-provider/instances/enterprise')
    for key in ('alias', 'providerId', 'enabled', 'trustEmail', 'storeToken', 'addReadTokenRoleOnCreate', 'firstBrokerLoginFlowAlias'):
        require(observed.get(key) == provider.get(key))
    for key, value in provider['config'].items():
        if key != 'clientSecret':
            require(observed['config'].get(key) == value)
    mappers, _ = admin.wire(BASE + 'identity-provider/instances/enterprise/mappers')
    require(mappers == [])
    for uid, user in expected.items():
        link = user['federatedIdentities'][0]
        admin.wire(BASE + 'users/' + uid + '/federated-identity/enterprise', 'POST', link, expected=204)
        links, _ = admin.wire(BASE + 'users/' + uid + '/federated-identity')
        require(links == [link])

    after, _ = admin.wire(BASE + 'users?first=0&max=100&briefRepresentation=false')
    require({u['id']: u for u in after} == before_users)
    for uid, original in before_roles.items():
        roles, _ = admin.wire(BASE + 'users/' + uid + '/role-mappings/realm')
        require({v['id']: v for v in roles} == original)
        attributes, _ = admin.wire(BASE + 'users/' + uid + '/unmanagedAttributes')
        require(attributes == before_attributes[uid])
    flows, _ = admin.wire(BASE + 'authentication/flows')
    require(len(flows) == len(before_flows) + 1
        and {f['id']: f for f in flows if f['id'] in before_flows} == before_flows)
    for alias, original in builtins.items():
        rows, _ = admin.wire(BASE + 'authentication/flows/' + alias.replace(' ', '%20') + '/executions')
        require(rows == original)
    profile_after, _ = admin.wire(BASE + 'users/profile')
    require(profile_after == profile_before)
    return {'completed': True, 'prelinkedAccounts': 4, 'builtinAuthenticationFlowsUnchanged': True,
        'nativeAdminVisibleAccountRepresentationsAndRolesUnchanged': True,
        'defaultUserProfilePolicyUnchanged': True, 'hiddenAttributesRequireIndependentFixtureDatabaseReadback': True,
        'unlinkedFirstLoginExecutionRequired': True,
        'externalIdentityMappers': 0, 'actualBrokerFlowVerified': False, 'originalRealmContacted': False}
