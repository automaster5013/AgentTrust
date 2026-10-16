"""Actual HTTPS/OIDC client for the portless, owned synthetic CI fixture only.

This deliberately does not extend the loopback development client's exception
for Secure cookies. No trust-all context or environment proxy is used.
"""
import html.parser
import http.cookiejar
import http.cookies
import json
import pathlib
import re
import ssl
import urllib.error
import urllib.parse
import urllib.request

CONSOLE = 'https://console.example.com'
IDENTITY = 'https://identity.example.com'
ISSUER = IDENTITY + '/realms/agenttrust'
CALLBACK = CONSOLE + '/backend/login/oauth2/code/keycloak'
LIMIT = 1024 * 1024


def require(condition):
    if not condition:
        raise ValueError('SYNTHETIC_HTTPS_IDENTITY_REFUSED')


def endpoint(url):
    require(isinstance(url, str) and 0 < len(url) <= 8192
            and url.isascii() and not any(c in url for c in '\r\n\\'))
    parsed = urllib.parse.urlsplit(url)
    require(parsed.scheme == 'https' and parsed.netloc in
            ('console.example.com', 'identity.example.com')
            and not parsed.username and not parsed.password and not parsed.fragment)
    return parsed


class FixedHttpsRedirects(urllib.request.HTTPRedirectHandler):
    max_redirections = 8
    max_repeats = 2

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        endpoint(req.full_url)
        endpoint(newurl)
        # A redirect can never forward a credential-bearing POST body.
        require(req.get_method() == 'GET' or code in (302, 303))
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class IdentityForm(html.parser.HTMLParser):
    def __init__(self, logout=False):
        super().__init__(convert_charrefs=True)
        self.action = None
        self.fields = {}
        self.active = False
        self.logout = logout

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        wanted = (values.get('id') == 'kc-form-login' if not self.logout else
                  urllib.parse.urlsplit(values.get('action', '')).path ==
                  '/realms/agenttrust/protocol/openid-connect/logout/logout-confirm')
        if tag == 'form' and wanted:
            require(self.action is None)
            self.action = values.get('action')
            self.active = True
        if tag == 'input' and self.active and values.get('name') and values.get('type') in ('hidden', 'submit'):
            require(len(self.fields) < 32 and values['name'] not in self.fields)
            self.fields[values['name']] = values.get('value', '')

    def handle_endtag(self, tag):
        if tag == 'form':
            self.active = False


def secure_session_cookie(headers):
    values = headers.get_all('Set-Cookie') or []
    selected = [v for v in values if v.startswith('AGENTTRUST_STACK_SESSION=')]
    require(len(selected) == 1)
    attributes = [part.strip().split('=', 1)[0].lower() for part in selected[0].split(';')[1:]]
    require(len(attributes) == len(set(attributes)))
    cookie = http.cookies.SimpleCookie()
    cookie.load(selected[0])
    require(set(cookie) == {'AGENTTRUST_STACK_SESSION'})
    value = cookie['AGENTTRUST_STACK_SESSION']
    require(value['secure'] is True and value['httponly'] is True
            and value['samesite'].lower() == 'lax' and value['path'] == '/'
            and not value['domain'])


class HttpsIdentityClient:
    def __init__(self, ca_file, account):
        context = ssl.create_default_context(cafile=str(pathlib.Path(ca_file)))
        require(context.check_hostname and context.verify_mode == ssl.CERT_REQUIRED)
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}),
            FixedHttpsRedirects(), urllib.request.HTTPCookieProcessor(self.jar),
            urllib.request.HTTPSHandler(context=context))
        self.account = account
        self.logged = False
        self.provider_session_owned = False
        self.token = None
        self.authorization_verified = False

    def wire(self, url, method='GET', body=None, content_type=None, expected=200, request_key=None):
        parsed = endpoint(url)
        require(method in ('GET', 'POST'))
        headers = {'Accept': 'application/json'}
        if request_key is not None:
            require(parsed.netloc == 'console.example.com' and method == 'POST'
                    and re.fullmatch(r'[a-z0-9-]{16,100}', request_key) is not None)
            headers['Idempotency-Key'] = request_key
        if method == 'POST':
            headers['Origin'] = parsed.scheme + '://' + parsed.netloc
            if content_type:
                headers['Content-Type'] = content_type
            if parsed.netloc == 'console.example.com' and self.token:
                headers['X-CSRF-TOKEN'] = self.token
        request = urllib.request.Request(url, data=body, method=method, headers=headers)
        try:
            response = self.opener.open(request, timeout=15)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            raw = response.read(LIMIT + 1)
            require(response.status == expected and len(raw) <= LIMIT)
            endpoint(response.url)
            return raw, response.url, response.headers

    def api(self, path, expected=200):
        require(re.fullmatch(r'(?:[a-z][a-z-]{0,30}|runs/[a-f0-9-]{36})', path) is not None)
        raw, _, _ = self.wire(CONSOLE + '/backend/' + path, expected=expected)
        return json.loads(raw) if raw else None

    def csrf(self):
        self.token = self.api('csrf')['token']
        require(isinstance(self.token, str) and 1 <= len(self.token) <= 2048)

    def login(self, expect_identity_refusal=False):
        require(not self.logged)
        raw, url, _ = self.wire(CONSOLE + '/backend/oauth2/authorization/keycloak')
        target = endpoint(url)
        query = urllib.parse.parse_qs(target.query, strict_parsing=True)
        require(target.netloc == 'identity.example.com'
                and target.path == '/realms/agenttrust/protocol/openid-connect/auth')
        require(query.get('client_id') == ['agenttrust-console']
                and query.get('redirect_uri') == [CALLBACK]
                and query.get('response_type') == ['code']
                and query.get('code_challenge_method') == ['S256']
                and len(query.get('state', [''])[0]) >= 16
                and len(query.get('nonce', [''])[0]) >= 16
                and re.fullmatch(r'[A-Za-z0-9_-]{43}', query.get('code_challenge', [''])[0]) is not None)
        self.authorization_verified = True
        form = IdentityForm()
        form.feed(raw.decode('utf-8'))
        target = endpoint(form.action)
        require(target.netloc == 'identity.example.com'
                and target.path == '/realms/agenttrust/login-actions/authenticate')
        body = urllib.parse.urlencode({**form.fields, 'username': self.account['username'],
            'password': self.account['password'], 'credentialId': ''}).encode()
        require(len(body) <= 32768)
        # An uncertain POST may already have created an IdP session. The caller
        # must close that private context even when application login is refused.
        self.provider_session_owned = True
        raw, final, headers = self.wire(form.action, 'POST', body,
            'application/x-www-form-urlencoded', expected=401 if expect_identity_refusal else 200)
        if expect_identity_refusal:
            target = endpoint(final)
            require(target.netloc == 'console.example.com'
                    and target.path == '/backend/login/oauth2/code/keycloak'
                    and json.loads(raw).get('code') == 'OIDC_AUTHENTICATION_FAILED')
            self.api('me', expected=401)
            return {'authenticationRefused': True, 'protectedIdentityUnavailable': True}
        require(final == CONSOLE + '/')
        # The callback's Set-Cookie can precede the final home response; the
        # standard cookie jar independently retains Secure/HttpOnly attributes.
        cookies = [c for c in self.jar if c.name == 'AGENTTRUST_STACK_SESSION']
        require(len(cookies) == 1 and cookies[0].secure
                and cookies[0].path == '/' and not cookies[0].domain_specified
                and cookies[0].has_nonstandard_attr('HttpOnly')
                and cookies[0].get_nonstandard_attr('SameSite', '').lower() == 'lax')
        self.logged = True
        self.csrf()
        me = self.api('me')
        require(me.get('identityProvider') == 'keycloak')
        for field in ('organizationId', 'projectId', 'actorId', 'role'):
            require(me.get(field) == self.account[field])
        return me

    def logout(self):
        url = ISSUER + '/protocol/openid-connect/logout?' + urllib.parse.urlencode({
            'client_id': 'agenttrust-console', 'post_logout_redirect_uri': CONSOLE + '/'})
        if self.logged:
            self.csrf()
            raw, _, headers = self.wire(CONSOLE + '/backend/logout', 'POST', b'{}', 'application/json')
            secure_session_cookie(headers)
            value = json.loads(raw)
            self.api('me', expected=401)
            require(value.get('logoutUrl') == url)
            self.logged = False
        if not self.provider_session_owned:
            return
        raw, final, _ = self.wire(url)
        if final != CONSOLE + '/':
            form = IdentityForm(logout=True)
            form.feed(raw.decode('utf-8'))
            action = urllib.parse.urljoin(url, form.action or '')
            target = endpoint(action)
            require(form.action and target.netloc == 'identity.example.com'
                    and target.path == '/realms/agenttrust/protocol/openid-connect/logout/logout-confirm')
            _, final, _ = self.wire(action, 'POST', urllib.parse.urlencode(form.fields).encode(),
                'application/x-www-form-urlencoded')
        require(final == CONSOLE + '/')
        self.provider_session_owned = False
