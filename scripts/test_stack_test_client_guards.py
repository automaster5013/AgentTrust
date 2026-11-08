"""Exercise destination guards with no network access."""
import unittest
from unittest.mock import patch
from urllib.request import HTTPRedirectHandler, Request

from stack_test_client import FixedRedirects, StackClient


class StackTestClientGuardsTest(unittest.TestCase):
    @patch.object(HTTPRedirectHandler, 'redirect_request')
    def test_external_redirect_is_refused(self, forward):
        with self.assertRaises(AssertionError):
            FixedRedirects().redirect_request(
                Request('http://127.0.0.1:4320'), None, 302, '', {},
                'https://synthetic.invalid/',
            )
        forward.assert_not_called()

    @patch.object(HTTPRedirectHandler, 'redirect_request')
    def test_allowed_redirect_preserves_handler_result(self, forward):
        result = FixedRedirects().redirect_request(
            Request('http://127.0.0.1:4320'), None, 302, '', {},
            'http://127.0.0.1:4322/',
        )
        self.assertIs(result, forward.return_value)

    def test_external_base_is_refused(self):
        with self.assertRaises(AssertionError):
            StackClient('https://synthetic.invalid', {})
