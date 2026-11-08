"""Exercise the imported callback without executing the worker-interruption script."""
import io
import json
from email.message import Message
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request
from stack_campaign_callback import callback


class CallbackTests(unittest.TestCase):
    def exercise(self, status=200, expected=200, location=None, proxy=False):
        calls = []
        responses = []

        class FixtureHTTP(urllib.request.HTTPHandler):
            def http_open(self, request):
                calls.append(request)
                headers = Message()
                if location and len(calls) == 1:
                    headers['Location'] = location
                response = urllib.error.HTTPError(request.full_url,
                    status if len(calls) == 1 or not location else 200,
                    'Fixture', headers, io.BytesIO(b'{}'))
                responses.append(response)
                return response

        build = urllib.request.build_opener
        ambient = {'http': 'http://proxy.invalid:8080'} if proxy else {}
        with patch('urllib.request.getproxies', return_value=ambient), \
                patch('urllib.request.proxy_bypass', return_value=False), \
                patch('socket.create_connection', side_effect=AssertionError('Real socket refused')):
            legacy = build(FixtureHTTP())
            with patch('urllib.request._opener', legacy), \
                    patch('urllib.request.build_opener', side_effect=lambda *handlers: build(*handlers, FixtureHTTP())):
                try:
                    callback('completions', {'scenario': 'synthetic'}, expected, 'synthetic-contract-only')
                finally:
                    self.calls = calls
                    self.assertTrue(all(response.closed for response in responses))
        return calls

    def test_fixed_endpoint_preserves_post_body_and_header(self):
        calls = self.exercise()
        self.assertEqual(len(calls), 1)
        request = calls[0]
        self.assertEqual(request.full_url, 'http://127.0.0.1:4321/internal/completions')
        self.assertEqual(request.get_method(), 'POST')
        self.assertEqual(json.loads(request.data), {'scenario': 'synthetic'})
        self.assertEqual(request.get_header('X-agenttrust-worker-token'), 'synthetic-contract-only')

    def test_expected_error_status_remains_supported(self):
        for status in (400, 409):
            with self.subTest(status=status):
                self.assertEqual(len(self.exercise(status=status, expected=status)), 1)

    def test_unexpected_error_status_fails(self):
        with self.assertRaises(AssertionError):
            self.exercise(status=500)

    def test_redirects_never_send_a_second_authenticated_request(self):
        for status in (301, 302, 303, 307, 308):
            for location in ('http://external.invalid/callback',
                             'https://external.invalid/callback',
                             'ftp://external.invalid/callback',
                             'http://127.0.0.1:4321/internal/other'):
                with self.subTest(status=status, location=location):
                    with self.assertRaises(urllib.error.URLError):
                        self.exercise(status=status, location=location)
                    self.assertEqual(len(self.calls), 1)

    def test_ambient_proxy_is_not_used(self):
        calls = self.exercise(proxy=True)
        self.assertEqual(len(calls), 1)
        self.assertFalse(calls[0].has_proxy())
        self.assertEqual(calls[0].host, '127.0.0.1:4321')


if __name__ == '__main__':
    unittest.main()
