"""Bounded post-browser SSO and native identity checks on the two owned realms."""
import hashlib
import json
import pathlib
import re
import traceback
from stack_https_fixture_admin import FixtureAdmin
from stack_https_fixture_enterprise import canonical, require

PRIMARY = '/admin/realms/agenttrust/'
EXTERNAL = '/admin/realms/enterprise-synthetic/'


def primary_snapshot(admin, accounts):
    require(admin.host == 'tls-identity' and admin.realm == 'agenttrust' and len(accounts) == 4)
    identifiers = {canonical(a['actorId']) for a in accounts}
    require(len(identifiers) == 4)
    users, _ = admin.wire(PRIMARY + 'users?first=0&max=100&briefRepresentation=false')
    require(isinstance(users, list) and {u['id'] for u in users} == identifiers)
    result = {u['id']: {'user': u} for u in users}
    for uid in identifiers:
        roles, _ = admin.wire(PRIMARY + 'users/' + uid + '/role-mappings/realm')
        links, _ = admin.wire(PRIMARY + 'users/' + uid + '/federated-identity')
        attributes, _ = admin.wire(PRIMARY + 'users/' + uid + '/unmanagedAttributes')
        result[uid].update(roles={r['id']: r for r in roles}, links=links, unmanagedAttributes=attributes)
    return result


def state_sha256(snapshot):
    return hashlib.sha256(json.dumps(snapshot, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def require_provider_sessions_closed(primary, external, accounts, target):
    require(primary.host == 'tls-identity' and primary.realm == 'agenttrust'
        and external.host == 'tls-enterprise' and external.realm == 'enterprise-synthetic')
    primary_ids = {canonical(a['actorId']) for a in accounts}
    external_ids = {canonical(u['id']) for u in target['external']['users']}
    require(len(primary_ids) == 4 and len(external_ids) == 5)
    for admin, base, identifiers in ((primary, PRIMARY, primary_ids), (external, EXTERNAL, external_ids)):
        for uid in identifiers:
            sessions, _ = admin.wire(base + 'users/' + uid + '/sessions')
            require(sessions == [])


def main():
    directory = pathlib.Path('/fixture')
    target = json.loads((directory / 'enterprise-configuration.json').read_text(encoding='utf-8'))
    accounts = json.loads((directory / 'accounts.json').read_text(encoding='utf-8'))
    passwords = json.loads((directory / 'administrator.json').read_text(encoding='utf-8'))
    expected = json.loads((directory / 'browser-state-expected.json').read_text(encoding='utf-8'))
    require(set(expected) == {'nativeAdminStateSha256'} and re.fullmatch('[a-f0-9]{64}', expected['nativeAdminStateSha256']))
    with FixtureAdmin(passwords['password']) as primary, FixtureAdmin(passwords['enterprisePassword'], 'enterprise') as external:
        require_provider_sessions_closed(primary, external, accounts, target)
        require(state_sha256(primary_snapshot(primary, accounts)) == expected['nativeAdminStateSha256'])
    print(json.dumps({'completed': True, 'allPrimaryAndExternalProviderSessionsClosed': True,
        'nativeAdminVisibleProfilesRolesAndLinksMatchBeforeBrowser': True,
        'rawIdentityRowsExported': False, 'originalRealmContacted': False}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'completed': False, 'code': 'SYNTHETIC_HTTPS_PROTOCOL_UNVERIFIED',
            'errorType': type(error).__name__, 'httpObservation': getattr(error, 'observation', None),
            'failureLocations': [{'file': pathlib.Path(frame.filename).name, 'line': frame.lineno}
                for frame in traceback.extract_tb(error.__traceback__)[-12:]]}))
        raise SystemExit(1)
