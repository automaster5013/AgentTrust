"""Protocol-level real TLS, Keycloak, PKCE and session checks inside the fixture.

This is not a Chromium rendering test or an external enterprise IdP acceptance.
Only a bounded public result is printed; private inputs and exceptions are not.
"""
import json
import pathlib
import socket
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from stack_https_identity_client import CONSOLE, IDENTITY, ISSUER, HttpsIdentityClient, require
from stack_https_fixture_claim_controls import verify_claim_controls


def main():
    directory = pathlib.Path('/fixture')
    ca_file = directory / 'certificates/ca.crt'
    accounts = json.loads((directory / 'accounts.json').read_text(encoding='utf-8'))
    require(isinstance(accounts, list) and len(accounts) == 4)
    context = ssl.create_default_context(cafile=str(ca_file))
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPSHandler(context=context))

    def get(url):
        with opener.open(url, timeout=10) as response:
            raw = response.read(65537)
            require(response.status == 200 and len(raw) <= 65536)
            return json.loads(raw)

    until = time.monotonic() + 30
    while True:
        try:
            require(get(CONSOLE + '/backend/auth-info')['identityProvider'] == 'keycloak')
            break
        except (OSError, ValueError):
            require(time.monotonic() < until)
            time.sleep(1)
    counts_before = get(CONSOLE + '/fixture/observations')
    for tls_context, hostname in [(ssl.create_default_context(), 'identity.example.com'), (context, 'tls-edge')]:
        try:
            with socket.create_connection(('tls-edge', 443), timeout=5) as connection:
                with tls_context.wrap_socket(connection, server_hostname=hostname):
                    pass
        except ssl.SSLCertVerificationError:
            pass
        else:
            raise ValueError('EXPECTED_REAL_TLS_CERTIFICATE_REFUSAL_MISSING')
    counts_after = get(CONSOLE + '/fixture/observations')
    require(counts_before == counts_after)
    discovery = get(ISSUER + '/.well-known/openid-configuration')
    require(discovery['issuer'] == ISSUER)
    for field, suffix in [('authorization_endpoint', 'auth'), ('token_endpoint', 'token'),
                          ('userinfo_endpoint', 'userinfo'), ('jwks_uri', 'certs')]:
        require(discovery[field] == ISSUER + '/protocol/openid-connect/' + suffix)
    checks = ['actual untrusted chain and wrong hostname refused before HTTP',
              'actual TLS discovery advertises only the pinned HTTPS issuer and endpoints']
    clients = []
    try:
        for name in ['demo-admin', 'demo-viewer', 'other-admin']:
            account = next(row for row in accounts if row['username'] == name)
            client = HttpsIdentityClient(ca_file, account)
            clients.append(client)
            client.login()
            require(client.authorization_verified)
            own = client.api('runs/' + account['ownedRunId'])
            require(own['id'] == account['ownedRunId'] and own['organization_id'] == account['organizationId'])
            foreign = next(row for row in accounts if row['organizationId'] != account['organizationId'])
            client.api('runs/' + foreign['ownedRunId'], expected=404)
        checks += ['three real authorization-code PKCE S256 logins through HTTPS Next BFF and Java',
                   'actual signed identities preserve administrator/viewer and two organization scopes',
                   'each scope reads its seeded witness and foreign organization witness is 404']
        viewer = clients[1]
        viewer.wire(CONSOLE + '/backend/runs', 'POST', json.dumps({'scenario': 'pass', 'requiresApproval': True, 'provider': 'synthetic'}).encode(),
                    'application/json', expected=403, request_key='synthetic-https-viewer-refusal-0001')
        checks.append('authenticated viewer with valid CSRF cannot admit an evaluation')
        malformed = HttpsIdentityClient(ca_file, accounts[0])
        malformed.wire(CONSOLE + '/backend/login/oauth2/code/keycloak?code=invalid-code&state=invalid-state', expected=401)
        malformed.api('me', expected=401)
        checks.append('unsolicited real HTTPS callback cannot create authenticated identity')
        claim_controls = verify_claim_controls(ca_file, accounts, clients)
        require(claim_controls['completed'])
        checks.append('actual signed nil scopes and contradictory UserInfo fail login and restored mappings recover')
    finally:
        for client in clients:
            client.logout()
    require(all(not client.logged and not client.provider_session_owned for client in clients))
    checks.append('all three application and actual provider sessions log out over HTTPS')
    counts = get(CONSOLE + '/fixture/observations')
    require(counts['token'] >= 3 and counts['userinfo'] >= 3 and counts['jwks'] >= 1
            and counts['authorization'] >= 3 and counts['callback'] >= 3 and counts['providerLogout'] >= 3)
    print(json.dumps({'completed': True, 'checks': checks, 'actualTlsProtocolLoginVerified': True,
        'actualKeycloakTokenJwkUserinfoRequestsObserved': True, 'publicEndpointRequestCounts': counts,
        'adverseIdentityClaimControls': claim_controls,
        'tenantWitnessesAreSeededNotEvaluated': True, 'paidProviderCallsPerformed': False,
        'chromiumRenderingVerified': False, 'externalEnterpriseIdpVerified': False,
        'productionDeploymentPerformed': False, 'privateInputsPrinted': False}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'completed': False, 'code': 'SYNTHETIC_HTTPS_PROTOCOL_UNVERIFIED',
                          'errorType': type(error).__name__, 'privateInputsPrinted': False}))
        raise SystemExit(1)
