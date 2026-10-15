"""Fixed loopback Keycloak transport for local workspace onboarding only."""
import json
import pathlib
import re
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from stack_workspace_onboarding import canonical_uuid, require


class NoRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class LocalWorkspaceIdentity:
    def __init__(self, root):
        self.root = pathlib.Path(root).resolve()
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirects())
        self.token = self.refresh = None
        self.created = set()

    def wire(self, path, method='GET', body=None, content_type='application/json', expected=200):
        require(isinstance(path, str) and path.startswith('/') and '..' not in path
                and len(path) <= 512 and '#' not in path)
        url = 'http://127.0.0.1:4322' + path
        headers = {'Accept': 'application/json', 'Content-Type': content_type}
        if self.token:
            headers['Authorization'] = 'Bearer ' + self.token
        request = urllib.request.Request(url, data=body, method=method, headers=headers)
        try:
            response = self.opener.open(request, timeout=15)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            raw = response.read(1048577)
            require(response.status == expected and len(raw) <= 1048576,
                    'WORKSPACE_IDENTITY_HTTP_REFUSED')
            return raw, response.headers.get('Location')

    def __enter__(self):
        result = subprocess.run(['docker', 'inspect', '--format',
            '{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}|{{.State.Health.Status}}',
            'agenttrust-stack-identity-1'], cwd=self.root, capture_output=True,
            text=True, encoding='utf-8', timeout=15)
        require(result.returncode == 0 and result.stdout.strip() == 'agenttrust|stack-identity|healthy')
        path = self.root / '.local/stack/identity.env'
        require(not path.is_symlink() and path.stat().st_size <= 1024)
        values = {}
        for line in path.read_text(encoding='utf-8').splitlines():
            name, value = line.split('=', 1)
            require(name not in values)
            values[name] = value
        password = values.get('STACK_IDENTITY_ADMIN_PASSWORD')
        require(isinstance(password, str) and re.fullmatch('[a-f0-9]{48}', password) is not None)
        body = urllib.parse.urlencode({'client_id': 'admin-cli', 'grant_type': 'password',
            'username': 'stack-admin', 'password': password}).encode()
        raw, _ = self.wire('/realms/master/protocol/openid-connect/token', 'POST', body,
                           'application/x-www-form-urlencoded')
        tokens = json.loads(raw)
        self.token, self.refresh = tokens['access_token'], tokens['refresh_token']
        require(all(isinstance(t, str) and 16 <= len(t) <= 32768 for t in (self.token, self.refresh)))
        return self

    def read(self, path):
        require(path in ('/clients?clientId=agenttrust-console', '/users/profile')
                or re.fullmatch(r'/users\?username=[a-z][a-z0-9-]{2,40}&exact=true&max=2', path) is not None
                or re.fullmatch(r'/users/[a-f0-9-]{36}(?:/sessions|/role-mappings(?:/realm/(?:available|composite))?)?', path) is not None)
        raw, _ = self.wire('/admin/realms/agenttrust' + path)
        return json.loads(raw)

    def create_user(self, representation):
        raw, location = self.wire('/admin/realms/agenttrust/users', 'POST',
                                 json.dumps(representation).encode(), expected=201)
        require(raw == b'' and isinstance(location, str))
        expected = 'http://127.0.0.1:4322/admin/realms/agenttrust/users/'
        require(location.startswith(expected))
        identifier = canonical_uuid(location[len(expected):])
        require(identifier not in self.created)
        self.created.add(identifier)
        return identifier

    def write(self, path, method, value):
        match = re.fullmatch(r'/users/([a-f0-9-]{36})(/role-mappings/realm)?', path)
        require(match is not None and match[1] in self.created)
        require((method == 'PUT' and match[2] is None) or (method == 'POST' and match[2] is not None))
        self.wire('/admin/realms/agenttrust' + path, method, json.dumps(value).encode(), expected=204)

    def suspend_user(self, identifier, verified_user):
        canonical_uuid(identifier)
        require(isinstance(verified_user, dict) and verified_user.get('id') == identifier)
        # Caller verifies the journal's exact actor/name/scope/role before every
        # mutation. Existing attributes stay unchanged; only enabled becomes false.
        self.wire('/admin/realms/agenttrust/users/' + identifier, 'PUT',
                  json.dumps({**verified_user, 'enabled': False}).encode(), expected=204)
        self.wire('/admin/realms/agenttrust/users/' + identifier + '/logout', 'POST', b'', expected=204)

    def __exit__(self, *args):
        try:
            if self.refresh:
                body = urllib.parse.urlencode({'client_id': 'admin-cli', 'refresh_token': self.refresh}).encode()
                self.wire('/realms/master/protocol/openid-connect/logout', 'POST', body,
                          'application/x-www-form-urlencoded', 204)
        finally:
            self.token = self.refresh = None
