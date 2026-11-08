"""Exercise identity administration guards with synthetic HTTP responses."""
from pathlib import Path
import unittest
from unittest.mock import patch

from stack_identity_admin import IdentityAdmin


class IdentityAdminTest(unittest.TestCase):
    def setUp(self):
        self.admin = IdentityAdmin(Path('synthetic'))
        self.admin.token = 'synthetic'
        self.admin.refresh = 'synthetic'

    @patch('stack_identity_admin.urllib.request.urlopen')
    def test_disallowed_path_never_sends_request(self, urlopen):
        for path in ('/roles', '//users', '/users/../roles'):
            with self.subTest(path=path), self.assertRaises(ValueError):
                self.admin.request(path)
        urlopen.assert_not_called()

    @patch('stack_identity_admin.urllib.request.urlopen')
    def test_allowed_path_preserves_json_response(self, urlopen):
        urlopen.return_value.__enter__.return_value.read.return_value = b'{"fixture":true}'
        self.assertEqual(self.admin.request('/users'), {'fixture': True})

    @patch('stack_identity_admin.urllib.request.urlopen')
    def test_oversized_response_is_refused(self, urlopen):
        urlopen.return_value.__enter__.return_value.read.return_value = b'{}' + b' ' * 1048575
        with self.assertRaises(ValueError):
            self.admin.request('/users')

    @patch('stack_identity_admin.urllib.request.urlopen')
    def test_unexpected_logout_status_is_refused_and_credentials_cleared(self, urlopen):
        urlopen.return_value.__enter__.return_value.status = 200
        with self.assertRaises(ValueError):
            self.admin.__exit__(None, None, None)
        self.assertIsNone(self.admin.token)
        self.assertIsNone(self.admin.refresh)
