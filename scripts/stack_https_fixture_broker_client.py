"""Actual cross-site synthetic broker protocol; no production IdP claim."""
import html.parser
import json
import re
import urllib.parse
from stack_https_identity_client import CONSOLE, IDENTITY, CALLBACK, HttpsIdentityClient, IdentityForm, endpoint, require
from stack_https_fixture_enterprise import ENTERPRISE, EXTERNAL_ISSUER, CALLBACK as BROKER_CALLBACK


class EnterpriseLink(html.parser.HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.link = None

    def handle_starttag(self, tag, attrs):
        value = dict(attrs)
        if tag == 'a' and value.get('id') == 'social-enterprise':
            require(self.link is None)
            self.link = value.get('href')


class BrokerIdentityClient(HttpsIdentityClient):
    def __init__(self, ca_file, account, external_account):
        super().__init__(ca_file, account)
        self.external_account = external_account
        self.external_session_owned = False
        self.enterprise_authorization_verified = False

    def login(self, expect_unlinked_refusal=False):
        require(not self.logged and not self.provider_session_owned)
        raw, url, _ = self.wire(CONSOLE + '/backend/oauth2/authorization/keycloak')
        parsed = endpoint(url)
        query = urllib.parse.parse_qs(parsed.query, strict_parsing=True)
        require(parsed.netloc == 'identity.example.com'
            and parsed.path == '/realms/agenttrust/protocol/openid-connect/auth'
            and query.get('client_id') == ['agenttrust-console'] and query.get('redirect_uri') == [CALLBACK]
            and query.get('response_type') == ['code'] and query.get('code_challenge_method') == ['S256']
            and len(query.get('state', [''])[0]) >= 16 and len(query.get('nonce', [''])[0]) >= 16
            and re.fullmatch(r'[A-Za-z0-9_-]{43}', query.get('code_challenge', [''])[0]))
        self.authorization_verified = True
        links = EnterpriseLink(); links.feed(raw.decode('utf-8'))
        link = urllib.parse.urljoin(url, links.link or '')
        parsed = endpoint(link)
        require(links.link and parsed.netloc == 'identity.example.com'
            and parsed.path == '/realms/agenttrust/broker/enterprise/login')
        raw, url, _ = self.wire(link)
        parsed = endpoint(url); query = urllib.parse.parse_qs(parsed.query, strict_parsing=True)
        require(parsed.netloc == 'enterprise.example.net'
            and parsed.path == '/realms/enterprise-synthetic/protocol/openid-connect/auth'
            and query.get('client_id') == ['agenttrust-enterprise-bridge']
            and query.get('redirect_uri') == [BROKER_CALLBACK] and query.get('response_type') == ['code']
            and query.get('code_challenge_method') == ['S256']
            and len(query.get('state', [''])[0]) >= 16 and len(query.get('nonce', [''])[0]) >= 16
            and re.fullmatch(r'[A-Za-z0-9_-]{43}', query.get('code_challenge', [''])[0]))
        self.enterprise_authorization_verified = True
        form = IdentityForm(); form.feed(raw.decode('utf-8'))
        parsed = endpoint(form.action)
        require(parsed.netloc == 'enterprise.example.net'
            and parsed.path == '/realms/enterprise-synthetic/login-actions/authenticate')
        body = urllib.parse.urlencode({**form.fields, 'username': self.external_account['username'],
            'password': self.external_account['password'], 'credentialId': ''}).encode()
        require(len(body) <= 32768)
        self.external_session_owned = self.provider_session_owned = True
        raw, final, _ = self.wire(form.action, 'POST', body, 'application/x-www-form-urlencoded',
            expected=401 if expect_unlinked_refusal else 200)
        if expect_unlinked_refusal:
            parsed = endpoint(final)
            require(parsed.netloc == 'identity.example.com' and parsed.path in (
                '/realms/agenttrust/broker/enterprise/endpoint',
                '/realms/agenttrust/login-actions/first-broker-login'))
            self.api('me', expected=401)
            return {'unlinkedBrokerAuthenticationRefused': True, 'protectedIdentityUnavailable': True}
        require(final == CONSOLE + '/')
        cookies = [c for c in self.jar if c.name == 'AGENTTRUST_STACK_SESSION']
        require(len(cookies) == 1 and cookies[0].secure
            and cookies[0].path == '/' and not cookies[0].domain_specified
            and cookies[0].has_nonstandard_attr('HttpOnly')
            and cookies[0].get_nonstandard_attr('SameSite', '').lower() == 'lax')
        self.logged = True
        self.csrf(); me = self.api('me')
        require(me.get('identityProvider') == 'keycloak'
            and all(me.get(k) == self.account[k] for k in ('actorId', 'organizationId', 'projectId', 'role', 'username')))
        return me

    def logout(self):
        super().logout()
        # A primary broker logout must also clear the external SSO session.
        # The external administrator checks that before any fallback cleanup.

    def cleanup_external(self):
        if not self.external_session_owned:
            return
        url = EXTERNAL_ISSUER + '/protocol/openid-connect/logout?' + urllib.parse.urlencode({
            'client_id': 'agenttrust-enterprise-bridge', 'post_logout_redirect_uri': BROKER_CALLBACK + '/logout_response'})
        raw, final, _ = self.wire(url)
        if urllib.parse.urlsplit(final).netloc == 'enterprise.example.net':
            form = IdentityForm(logout=True, realm='enterprise-synthetic'); form.feed(raw.decode('utf-8'))
            action = urllib.parse.urljoin(url, form.action or ''); parsed = endpoint(action)
            require(form.action and parsed.netloc == 'enterprise.example.net'
                and parsed.path == '/realms/enterprise-synthetic/protocol/openid-connect/logout/logout-confirm')
            # This fallback is cleanup only; the stale broker logout callback
            # may legitimately be refused. No fallback can establish acceptance.
            try:
                self.wire(action, 'POST', urllib.parse.urlencode(form.fields).encode(), 'application/x-www-form-urlencoded')
            except ValueError:
                pass
        self.external_session_owned = False
