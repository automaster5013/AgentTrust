"""Adverse mapper controls on the freshly created fixture realm only.

The application still obtains real signed tokens and UserInfo over verified TLS.
Administrative transport stays on the fixture's unpublished internal interface.
"""
import copy
import json
import pathlib
import re
import urllib.error
import urllib.parse
import urllib.request
from stack_https_identity_client import HttpsIdentityClient, require


class NoRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


class FixtureAdmin:
    def __init__(self, password):
        self.password = password
        self.access = self.refresh = None
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirects())

    def wire(self, path, method='GET', body=None, expected=200, form=False):
        require(path.startswith(('/realms/master/protocol/openid-connect/', '/admin/realms/agenttrust/'))
                and '..' not in path and not any(c in path for c in '\r\n\\#'))
        headers = {'Content-Type': 'application/x-www-form-urlencoded' if form else 'application/json'}
        if self.access:
            headers['Authorization'] = 'Bearer ' + self.access
        if body is not None:
            body = (urllib.parse.urlencode(body) if form else json.dumps(body)).encode()
        request = urllib.request.Request('http://tls-identity:8080' + path, data=body, headers=headers, method=method)
        try:
            response = self.opener.open(request, timeout=10)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            raw = response.read(1048577)
            require(response.status == expected and len(raw) <= 1048576)
            return json.loads(raw) if raw else None, response.headers.get('Location')

    def __enter__(self):
        value, _ = self.wire('/realms/master/protocol/openid-connect/token', 'POST',
            {'client_id': 'admin-cli', 'grant_type': 'password', 'username': 'fixture-admin', 'password': self.password}, form=True)
        self.access, self.refresh = value['access_token'], value['refresh_token']
        self.password = None
        return self

    def __exit__(self, *args):
        try:
            if self.refresh:
                self.wire('/realms/master/protocol/openid-connect/logout', 'POST',
                    {'client_id': 'admin-cli', 'refresh_token': self.refresh}, expected=204, form=True)
        finally:
            self.access = self.refresh = self.password = None


def identifier(value):
    require(isinstance(value, str) and re.fullmatch('[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}', value))
    return value


def verify_claim_controls(ca_file, accounts, existing_clients):
    private = json.loads(pathlib.Path('/fixture/administrator.json').read_text(encoding='utf-8'))
    account = next(row for row in accounts if row['username'] == 'demo-viewer')
    refused = []
    with FixtureAdmin(private['password']) as admin:
        clients, _ = admin.wire('/admin/realms/agenttrust/clients?clientId=agenttrust-console')
        require(isinstance(clients, list) and len(clients) == 1 and clients[0]['clientId'] == 'agenttrust-console')
        client = identifier(clients[0]['id'])
        base = '/admin/realms/agenttrust/clients/' + client + '/protocol-mappers/models'
        mappers, _ = admin.wire(base)
        require(isinstance(mappers, list) and 1 <= len(mappers) <= 32)

        def mapper(field):
            found = [m for m in mappers if m['config'].get('claim.name') == field]
            require(len(found) == 1)
            original = copy.deepcopy(found[0])
            identifier(original['id'])
            require(original['protocol'] == 'openid-connect'
                    and original['config'].get('id.token.claim') == 'true'
                    and original['config'].get('userinfo.token.claim') == 'true')
            return original

        def refuse_login(label):
            own = HttpsIdentityClient(ca_file, account)
            try:
                result = own.login(expect_identity_refusal=True)
                require(result['authenticationRefused'] and result['protectedIdentityUnavailable'])
                for existing in existing_clients:
                    require(existing.api('me')['actorId'] == existing.account['actorId'])
            finally:
                own.logout()
            require(not own.logged and not own.provider_session_owned)
            refused.append(label)

        for field in ('agenttrust_organization', 'agenttrust_project'):
            original = mapper(field)
            changed = copy.deepcopy(original)
            changed['protocolMapper'] = 'oidc-hardcoded-claim-mapper'
            changed['config'] = {'claim.name': field, 'claim.value': '00000000-0000-0000-0000-000000000000',
                'jsonType.label': 'String', 'id.token.claim': 'true', 'access.token.claim': 'true', 'userinfo.token.claim': 'true'}
            try:
                admin.wire(base + '/' + original['id'], 'PUT', changed, expected=204)
                refuse_login('actual signed nil ' + field + ' refused without disturbing existing sessions')
            finally:
                admin.wire(base + '/' + original['id'], 'PUT', original, expected=204)

        original = mapper('agenttrust_organization')
        changed = copy.deepcopy(original)
        changed['config']['userinfo.token.claim'] = 'false'
        created = None
        try:
            admin.wire(base + '/' + original['id'], 'PUT', changed, expected=204)
            other = next(a for a in accounts if a['organizationId'] != account['organizationId'])
            adverse = {'name': 'synthetic-fixture-conflicting-userinfo-org', 'protocol': 'openid-connect',
                'protocolMapper': 'oidc-hardcoded-claim-mapper', 'config': {'claim.name': 'agenttrust_organization',
                    'claim.value': other['organizationId'], 'jsonType.label': 'String',
                    'id.token.claim': 'false', 'access.token.claim': 'false', 'userinfo.token.claim': 'true'}}
            _, location = admin.wire(base, 'POST', adverse, expected=201)
            require(isinstance(location, str))
            parsed = urllib.parse.urlsplit(location)
            require(parsed.path.startswith(base + '/') and not parsed.query and not parsed.fragment)
            created = identifier(parsed.path[len(base) + 1:])
            observed, _ = admin.wire(base + '/' + created)
            require(observed['id'] == created and observed['name'] == adverse['name'] and observed['config'] == adverse['config'])
            refuse_login('actual UserInfo organization contradicting the signed token is refused')
        finally:
            if created:
                admin.wire(base + '/' + created, 'DELETE', expected=204)
            admin.wire(base + '/' + original['id'], 'PUT', original, expected=204)
        restored, _ = admin.wire(base)
        require({m['id']: m for m in restored} == {m['id']: m for m in mappers})

    recovered = HttpsIdentityClient(ca_file, account)
    try:
        recovered.login()
    finally:
        recovered.logout()
    require(not recovered.logged and not recovered.provider_session_owned)
    return {'completed': True, 'refusedActualLoginControls': refused,
        'actualSignedNilOrganizationAndProjectRefused': True,
        'actualConflictingUserInfoOrganizationRefused': True,
        'otherExistingApplicationSessionsPreserved': True,
        'fixtureClientMappersExactlyRestored': True, 'normalLoginAfterRestorationPassed': True,
        'ownAdministratorAndProviderSessionsClosed': True, 'originalRealmContacted': False,
        'actualProductionIdpVerified': False, 'privateValuesPrinted': False}
