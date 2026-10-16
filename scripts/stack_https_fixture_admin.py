"""Administrative controls on one of two fixed, freshly created fixture realms.

The application still obtains real signed tokens and UserInfo over verified TLS.
Administrative transport stays on the fixture's unpublished internal interface.
"""
import json
import urllib.error
import urllib.parse
import urllib.request
from stack_https_identity_client import require
from stack_https_fixture_diagnostics import FixtureHttpRefused


class NoRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


class FixtureAdmin:
    def __init__(self, password, provider="identity"):
        require(provider in ("identity", "enterprise"))
        self.host, self.realm = {"identity": ("tls-identity", "agenttrust"), "enterprise": ("tls-enterprise", "enterprise-synthetic")}[provider]
        self.password = password
        self.access = self.refresh = None
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirects())

    def wire(self, path, method='GET', body=None, expected=200, form=False):
        require(path.startswith(('/realms/master/protocol/openid-connect/', '/admin/realms/' + self.realm + '/'))
                and '..' not in path and not any(c in path for c in '\r\n\\#'))
        headers = {'Content-Type': 'application/x-www-form-urlencoded' if form else 'application/json'}
        if self.access:
            headers['Authorization'] = 'Bearer ' + self.access
        if body is not None:
            body = (urllib.parse.urlencode(body) if form else json.dumps(body)).encode()
        request = urllib.request.Request('http://' + self.host + ':8080' + path, data=body, headers=headers, method=method)
        try:
            response = self.opener.open(request, timeout=10)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            raw = response.read(1048577)
            if response.status != expected:
                kind = ('fixture-admin-auth' if path.startswith('/realms/master/') else
                        'fixture-mapper' if '/protocol-mappers/models' in path else 'fixture-admin-config')
                raise FixtureHttpRefused(response.status, expected, kind)
            require(len(raw) <= 1048576)
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
