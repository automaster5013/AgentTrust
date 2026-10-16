"""Offline adverse controls for the synthetic HTTPS/OIDC fixture client."""
import email.message
import http.cookiejar
import urllib.request
import unittest
from stack_https_identity_client import endpoint, FixedHttpsRedirects, IdentityForm, secure_session_cookie


class HttpsIdentityBoundaryTest(unittest.TestCase):
    def test_only_exact_https_fixture_origins(self):
        for value in ['http://console.example.com/', 'https://console.example.com:443/',
                      'https://console.example.com.evil.invalid/', 'https://user@identity.example.com/',
                      'https://identity.example.com/#fragment', 'https://127.0.0.1/',
                      'https://console.example.com/\r\nX:evil', 'https://console.example.com\\@evil.invalid/',
                      'https://CONSOLE.example.com/', 'https://identity.example.com./']:
            with self.subTest(kind='unsafe-origin'), self.assertRaises(ValueError):
                endpoint(value)
        self.assertEqual(endpoint('https://console.example.com/backend/me').path, '/backend/me')
        self.assertEqual(endpoint('https://identity.example.com/realms/agenttrust').hostname, 'identity.example.com')

    def test_post_redirect_cannot_replay_credentials(self):
        handler = FixedHttpsRedirects()
        request = urllib.request.Request('https://identity.example.com/realms/agenttrust/login-actions/authenticate', data=b'password=PUBLIC-CANARY')
        for code in [307, 308]:
            with self.subTest(status=code), self.assertRaises(ValueError):
                handler.redirect_request(request, None, code, '', {}, 'https://console.example.com/')
        redirected = handler.redirect_request(request, None, 302, '', {}, 'https://console.example.com/backend/login/oauth2/code/keycloak')
        self.assertEqual(redirected.get_method(), 'GET')
        self.assertIsNone(redirected.data)
        with self.assertRaises(ValueError):
            handler.redirect_request(request, None, 302, '', {}, 'https://evil.invalid/')

    def test_standard_secure_cookie_is_not_sent_over_http(self):
        jar = http.cookiejar.CookieJar()
        cookie = http.cookiejar.Cookie(0, 'AGENTTRUST_STACK_SESSION', 'PUBLIC-CANARY', None, False,
            'console.example.com', False, False, '/', True, True, None, True, None, None, {'HttpOnly': None, 'SameSite': 'Lax'})
        jar.set_cookie(cookie)
        plain = urllib.request.Request('http://console.example.com/backend/me')
        jar.add_cookie_header(plain)
        self.assertFalse(plain.has_header('Cookie'))
        secure = urllib.request.Request('https://console.example.com/backend/me')
        jar.add_cookie_header(secure)
        self.assertEqual(secure.get_header('Cookie'), 'AGENTTRUST_STACK_SESSION=PUBLIC-CANARY')

    def test_cookie_scope_and_logout_expiry(self):
        base = 'AGENTTRUST_STACK_SESSION=PUBLIC-CANARY; Path=/; Secure; HttpOnly; SameSite=Lax'
        def frame(value):
            headers = email.message.Message()
            headers.add_header('Set-Cookie', value)
            return headers
        secure_session_cookie(frame(base))
        secure_session_cookie(frame(base.replace('=PUBLIC-CANARY', '=') + '; Max-Age=0'))
        for bad in [base.replace('; Secure', ''), base.replace('; HttpOnly', ''),
                    base.replace('Lax', 'None'), base.replace('Path=/', 'Path=/backend'),
                    base + '; Domain=example.com', base + '; Path=/', base + '; Secure',
                    base + '; SameSite=None']:
            with self.subTest(kind='unsafe-cookie'), self.assertRaises(ValueError):
                secure_session_cookie(frame(bad))
        duplicate = frame(base)
        duplicate.add_header('Set-Cookie', base)
        with self.assertRaises(ValueError):
            secure_session_cookie(duplicate)

    def test_login_form_does_not_accept_a_second_credential_target(self):
        form = IdentityForm()
        form.feed('<form id="kc-form-login" action="https://identity.example.com/realms/agenttrust/login-actions/authenticate?a=1&amp;b=2"><input type="hidden" name="credentialId" value=""></form>')
        self.assertIn('&b=2', form.action)
        self.assertEqual(form.fields, {'credentialId': ''})
        with self.assertRaises(ValueError):
            form.feed('<form id="kc-form-login" action="https://evil.invalid/"></form>')


if __name__ == '__main__':
    unittest.main()
