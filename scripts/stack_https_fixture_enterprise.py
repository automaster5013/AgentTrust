"""Draft synthetic federation target; actual broker execution remains unverified.

The primary target is for bounded post-startup administrative configuration,
not a replacement realm import: built-in flows must already exist before adding
the deny-only first-login flow, provider, and exact prelinked identities.
"""
import copy
import re
import secrets
import uuid

IDENTITY = 'https://identity.example.com'
ENTERPRISE = 'https://enterprise.example.net'
EXTERNAL_ISSUER = ENTERPRISE + '/realms/enterprise-synthetic'
CALLBACK = IDENTITY + '/realms/agenttrust/broker/enterprise/endpoint'
LOGOUT_CALLBACK = CALLBACK + '/logout_response'
FLOW = 'synthetic-prelinked-only'


def require(value):
    if not value:
        raise ValueError('SYNTHETIC_ENTERPRISE_FIXTURE_REFUSED')


def canonical(value):
    require(isinstance(value, str) and str(uuid.UUID(value)) == value and uuid.UUID(value).int != 0)
    return value


def build(primary, accounts):
    require(primary.get('realm') == 'agenttrust' and primary.get('registrationAllowed') is False)
    require(not primary.get('identityProviders') and not primary.get('identityProviderMappers'))
    require(not primary.get('authenticationFlows'))
    require(isinstance(accounts, list) and len(accounts) == 4)
    require({a['username'] for a in accounts} == {'demo-admin', 'demo-editor', 'demo-viewer', 'other-admin'})
    result = copy.deepcopy(primary)
    users = {u['id']: u for u in result['users']}
    require(set(users) == {canonical(a['actorId']) for a in accounts})
    bridge_secret = secrets.token_hex(32)
    external_users = []
    link_manifest = []
    for account in accounts:
        canonical(account['organizationId']); canonical(account['projectId'])
        native = users[account['actorId']]
        require(native['username'] == account['username'] and native['realmRoles'] == [account['role']])
        require(not native.get('federatedIdentities'))
        other = next(a for a in accounts if a['organizationId'] != account['organizationId'])
        subject = str(uuid.uuid4())
        username = 'enterprise-' + account['username']
        password = secrets.token_hex(24)
        native['federatedIdentities'] = [{'identityProvider': 'enterprise', 'userId': subject, 'userName': username}]
        external_users.append({'id': subject, 'username': username, 'enabled': True, 'requiredActions': [],
            'email': username + '@enterprise.invalid', 'emailVerified': True,
            'firstName': 'Synthetic', 'lastName': 'Enterprise', 'realmRoles': ['admin'],
            'attributes': {'agenttrust_organization': [other['organizationId']], 'agenttrust_project': [other['projectId']]},
            'credentials': [{'type': 'password', 'value': password, 'temporary': False}]})
        link_manifest.append({'nativeUsername': account['username'], 'nativeActorId': account['actorId'],
            'enterpriseUsername': username, 'enterpriseActorId': subject, 'enterprisePassword': password,
            'expectedNativeRole': account['role'], 'expectedNativeOrganization': account['organizationId'],
            'configuredUntrustedEnterpriseRole': 'admin', 'configuredUntrustedEnterpriseOrganization': other['organizationId']})
    unknown = {'id': str(uuid.uuid4()), 'username': 'unlinked-enterprise-user', 'enabled': True, 'requiredActions': [],
        'email': next(u['email'] for u in result['users'] if u['username'] == 'demo-admin'),
        'emailVerified': True, 'firstName': 'Synthetic', 'lastName': 'Unlinked', 'realmRoles': ['admin'],
        'credentials': [{'type': 'password', 'value': secrets.token_hex(24), 'temporary': False}]}
    external_users.append(unknown)
    result['authenticationFlows'] = [{'alias': FLOW, 'description': 'Deny every unlinked first broker login',
        'providerId': 'basic-flow', 'topLevel': True, 'builtIn': False,
        'authenticationExecutions': [{'authenticator': 'deny-access-authenticator', 'requirement': 'REQUIRED',
            'priority': 10, 'authenticatorFlow': False, 'userSetupAllowed': False}]}]
    result['identityProviders'] = [{'alias': 'enterprise', 'providerId': 'oidc', 'enabled': True,
        'trustEmail': False, 'storeToken': False, 'addReadTokenRoleOnCreate': False,
        'authenticateByDefault': False, 'firstBrokerLoginFlowAlias': FLOW,
        'config': {'authorizationUrl': EXTERNAL_ISSUER + '/protocol/openid-connect/auth',
            'tokenUrl': EXTERNAL_ISSUER + '/protocol/openid-connect/token',
            'userInfoUrl': EXTERNAL_ISSUER + '/protocol/openid-connect/userinfo',
            'jwksUrl': EXTERNAL_ISSUER + '/protocol/openid-connect/certs',
            'logoutUrl': EXTERNAL_ISSUER + '/protocol/openid-connect/logout',
            'issuer': EXTERNAL_ISSUER, 'clientId': 'agenttrust-enterprise-bridge',
            'clientSecret': bridge_secret, 'clientAuthMethod': 'client_secret_basic',
            'defaultScope': 'openid profile email', 'validateSignature': 'true', 'useJwksUrl': 'true',
            'pkceEnabled': 'true', 'pkceMethod': 'S256', 'syncMode': 'IMPORT',
            'backchannelSupported': 'false', 'sendIdTokenOnLogout': 'true', 'sendClientIdOnLogout': 'true'}}]
    result['identityProviderMappers'] = []  # No external scope, role, username or email auto-link mapper.
    external = {'realm': 'enterprise-synthetic', 'enabled': True, 'registrationAllowed': False,
        'resetPasswordAllowed': False, 'rememberMe': False, 'loginWithEmailAllowed': False, 'sslRequired': 'all',
        'roles': {'realm': [{'name': 'admin'}]}, 'users': external_users,
        'clients': [{'clientId': 'agenttrust-enterprise-bridge', 'enabled': True, 'protocol': 'openid-connect',
            'publicClient': False, 'secret': bridge_secret, 'standardFlowEnabled': True,
            'directAccessGrantsEnabled': False, 'serviceAccountsEnabled': False,
            'implicitFlowEnabled': False, 'redirectUris': [CALLBACK], 'webOrigins': [IDENTITY],
            'attributes': {'pkce.code.challenge.method': 'S256', 'post.logout.redirect.uris': LOGOUT_CALLBACK},
            'protocolMappers': copy.deepcopy(result['clients'][0]['protocolMappers'])}]}
    manifest = {'linkedAccounts': link_manifest, 'unlinkedAccount': {'actorId': unknown['id'],
        'username': unknown['username'], 'password': unknown['credentials'][0]['value'],
        'collidingNativeEmailIsNotAnAccountLink': True}}
    validate(result, external, manifest)
    return result, external, manifest


def validate(primary, external, manifest):
    require(primary.get('realm') == 'agenttrust' and primary.get('registrationAllowed') is False)
    require(primary.get('sslRequired') == external.get('sslRequired') == 'all')
    require(external.get('realm') == 'enterprise-synthetic' and external.get('registrationAllowed') is False)
    providers = primary.get('identityProviders')
    require(isinstance(providers, list) and len(providers) == 1)
    provider = providers[0]
    require(provider.get('alias') == 'enterprise' and provider.get('providerId') == 'oidc'
        and provider.get('enabled') is True and provider.get('trustEmail') is False
        and provider.get('storeToken') is False and provider.get('addReadTokenRoleOnCreate') is False
        and provider.get('firstBrokerLoginFlowAlias') == FLOW and primary.get('identityProviderMappers') == [])
    config = provider.get('config', {})
    for key, suffix in [('authorizationUrl', 'auth'), ('tokenUrl', 'token'), ('userInfoUrl', 'userinfo'),
                        ('jwksUrl', 'certs'), ('logoutUrl', 'logout')]:
        require(config.get(key) == EXTERNAL_ISSUER + '/protocol/openid-connect/' + suffix)
    require(config.get('issuer') == EXTERNAL_ISSUER and config.get('validateSignature') == 'true'
        and config.get('useJwksUrl') == 'true' and config.get('pkceEnabled') == 'true'
        and config.get('pkceMethod') == 'S256' and config.get('syncMode') == 'IMPORT'
        and config.get('clientAuthMethod') == 'client_secret_basic' and config.get('backchannelSupported') == 'false'
        and config.get('sendIdTokenOnLogout') == config.get('sendClientIdOnLogout') == 'true')
    flows = primary.get('authenticationFlows')
    require(isinstance(flows, list) and len(flows) == 1 and flows[0].get('alias') == FLOW
        and flows[0].get('providerId') == 'basic-flow' and flows[0].get('topLevel') is True
        and flows[0].get('authenticationExecutions') == [{'authenticator': 'deny-access-authenticator',
            'requirement': 'REQUIRED', 'priority': 10, 'authenticatorFlow': False, 'userSetupAllowed': False}])
    require(len(external.get('clients', [])) == 1)
    client = external['clients'][0]
    require(client.get('clientId') == config.get('clientId') == 'agenttrust-enterprise-bridge'
        and client.get('secret') == config.get('clientSecret') and re.fullmatch('[a-f0-9]{64}', client['secret'])
        and client.get('publicClient') is False and client.get('standardFlowEnabled') is True
        and client.get('directAccessGrantsEnabled') is False and client.get('serviceAccountsEnabled') is False
        and client.get('implicitFlowEnabled') is False and client.get('redirectUris') == [CALLBACK]
        and client.get('attributes') == {'pkce.code.challenge.method': 'S256', 'post.logout.redirect.uris': LOGOUT_CALLBACK})
    require(len(primary.get('users', [])) == len(manifest.get('linkedAccounts', [])) == 4
        and len(external.get('users', [])) == 5)
    native = {canonical(u['id']): u for u in primary['users']}
    remote = {canonical(u['id']): u for u in external['users']}
    for link in manifest['linkedAccounts']:
        user = native[canonical(link['nativeActorId'])]
        other = remote[canonical(link['enterpriseActorId'])]
        require(user['username'] == link['nativeUsername'] and user['realmRoles'] == [link['expectedNativeRole']])
        require(user['federatedIdentities'] == [{'identityProvider': 'enterprise', 'userId': other['id'], 'userName': other['username']}])
        require(other['realmRoles'] == ['admin'] and other['attributes']['agenttrust_organization'] != user['attributes']['agenttrust_organization'])
    unknown = canonical(manifest['unlinkedAccount']['actorId'])
    require(unknown in remote and all(f['userId'] != unknown for u in native.values() for f in u['federatedIdentities']))
    return {'completed': True, 'syntheticBrokerConfigurationReviewed': True,
        'prelinkedNativeAccounts': 4, 'unlinkedEnterpriseWitnesses': 1,
        'unlinkedFirstLoginFlowDeniesAccess': True, 'externalScopeAndRoleMappersInstalled': False,
        'tlsCertificateVerificationDisabled': False, 'actualBrokerFlowVerified': False,
        'separateEnterpriseTlsOriginRequired': True, 'separateProviderProcessRequired': True,
        'productionEnterpriseIdpVerified': False, 'privateValuesPrinted': False}
