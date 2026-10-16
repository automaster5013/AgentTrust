"""Actual synthetic federation controls using only the two newly owned realms."""
import json
import pathlib
from stack_https_fixture_admin import FixtureAdmin
from stack_https_fixture_enterprise import require
from stack_https_fixture_enterprise_admin import install
from stack_https_fixture_broker_client import BrokerIdentityClient
from stack_https_identity_client import CONSOLE

PRIMARY = '/admin/realms/agenttrust/'
EXTERNAL = '/admin/realms/enterprise-synthetic/'


def configure_enterprise():
    target = json.loads(pathlib.Path('/fixture/enterprise-configuration.json').read_text(encoding='utf-8'))
    passwords = json.loads(pathlib.Path('/fixture/administrator.json').read_text(encoding='utf-8'))
    with FixtureAdmin(passwords['password']) as admin:
        proof = install(admin, target['primary'], target['external'], target['manifest'])
    return target, proof


def verify_broker_controls(ca_file, accounts, target):
    passwords = json.loads(pathlib.Path('/fixture/administrator.json').read_text(encoding='utf-8'))
    primary_ids = {a['actorId'] for a in accounts}
    external_ids = {u['id'] for u in target['external']['users']}
    with FixtureAdmin(passwords['password']) as primary, FixtureAdmin(passwords['enterprisePassword'], 'enterprise') as external:
        def snapshot():
            users, _ = primary.wire(PRIMARY + 'users?first=0&max=100&briefRepresentation=false')
            require({u['id'] for u in users} == primary_ids)
            result = {u['id']: {'user': u} for u in users}
            for uid in primary_ids:
                roles, _ = primary.wire(PRIMARY + 'users/' + uid + '/role-mappings/realm')
                links, _ = primary.wire(PRIMARY + 'users/' + uid + '/federated-identity')
                result[uid].update(roles={r['id']: r for r in roles}, links=links)
            return result

        def sessions(admin, base, uid):
            value, _ = admin.wire(base + 'users/' + uid + '/sessions')
            require(isinstance(value, list) and len(value) <= 16)
            return value

        def all_closed():
            require(all(not sessions(primary, PRIMARY, uid) for uid in primary_ids)
                and all(not sessions(external, EXTERNAL, uid) for uid in external_ids))

        all_closed(); before = snapshot(); checked = []
        for account in accounts:
            link = next(v for v in target['manifest']['linkedAccounts'] if v['nativeActorId'] == account['actorId'])
            remote = {'username': link['enterpriseUsername'], 'password': link['enterprisePassword']}
            client = BrokerIdentityClient(ca_file, account, remote)
            protocol_failed = True
            try:
                client.login()
                require(client.authorization_verified and client.enterprise_authorization_verified)
                require(len(sessions(primary, PRIMARY, account['actorId'])) == 1
                    and len(sessions(external, EXTERNAL, link['enterpriseActorId'])) == 1)
                own = client.api('runs/' + account['ownedRunId'])
                require(own['id'] == account['ownedRunId'] and own['organization_id'] == account['organizationId'])
                foreign = next(a for a in accounts if a['organizationId'] != account['organizationId'])
                client.api('runs/' + foreign['ownedRunId'], expected=404)
                if account['role'] == 'viewer':
                    client.wire(CONSOLE + '/backend/runs', 'POST', json.dumps({'scenario': 'pass', 'requiresApproval': True,
                        'provider': 'synthetic'}).encode(), 'application/json', expected=403,
                        request_key='synthetic-enterprise-viewer-refusal-0001')
                require(snapshot() == before)
                client.logout()
                # This check occurs before fallback or administrator cleanup.
                require(not sessions(primary, PRIMARY, account['actorId'])
                    and not sessions(external, EXTERNAL, link['enterpriseActorId']))
                require(not client.logged and not client.provider_session_owned)
                client.external_session_owned = False
                protocol_failed = False
                checked.append(account['role'])
            finally:
                if protocol_failed:
                    for cleanup in (client.logout, client.cleanup_external):
                        try:
                            cleanup()
                        except Exception:
                            pass
        require(len(checked) == 4 and set(checked) == {'admin', 'editor', 'viewer'})
        all_closed()
        unknown = target['manifest']['unlinkedAccount']
        client = BrokerIdentityClient(ca_file, accounts[0], unknown)
        try:
            result = client.login(expect_unlinked_refusal=True)
            require(result['unlinkedBrokerAuthenticationRefused'] and result['protectedIdentityUnavailable'])
            # Prove the external credential actually authenticated while the
            # deny-only primary flow created neither account nor primary SSO.
            require(len(sessions(external, EXTERNAL, unknown['actorId'])) == 1)
            require(all(not sessions(primary, PRIMARY, uid) for uid in primary_ids))
            require(snapshot() == before)
        finally:
            for cleanup in (client.logout, client.cleanup_external):
                try:
                    cleanup()
                except Exception:
                    pass
        all_closed(); require(snapshot() == before)
    return {'completed': True, 'actualSyntheticEnterpriseBrokerVerified': True,
        'linkedActualLogins': 4, 'nativeAdministratorEditorViewerRolesPreserved': True,
        'untrustedExternalAdministratorAndForeignScopeNotImported': True,
        'unlinkedExternalLoginWithCollidingNativeEmailRefused': True,
        'primaryUserCountUnchanged': 4, 'nativeAttributesRolesAndLinksUnchanged': True,
        'applicationPrimaryAndExternalSessionsClosed': True,
        'linkedExternalSessionsClosedByActualBrokerLogoutBeforeFallback': True,
        'productionEnterpriseIdpVerified': False, 'originalRealmContacted': False,
        'privateValuesPrinted': False, 'chromiumVerified': False}
