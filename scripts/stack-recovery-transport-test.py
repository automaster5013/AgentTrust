import io
import http.cookiejar
from email.message import Message
import unittest
import urllib.request
import urllib.error
from unittest.mock import patch
from stack_recovery_transport import RecoveryConnection, RecoveryHTTPHandler, RefuseHTTPS, fixture_opener


class RecoveryTransportTests(unittest.TestCase):
    def test_connection_preserves_host_but_maps_only_fixed_fixture_socket(self):
        with patch('stack_recovery_transport.socket.create_connection') as connect:
            connection = RecoveryConnection('127.0.0.1:4322', timeout=3)
            connection.connect()
            connect.assert_called_once_with(('stack-identity', 8080), 3, None)
            self.assertEqual(connection.host, '127.0.0.1')
            self.assertEqual(connection.port, 4322)

    def test_other_port_external_host_and_tunnel_refused_before_socket(self):
        with patch('stack_recovery_transport.socket.create_connection') as connect:
            for address in ('127.0.0.1:9999', 'example.com:80', 'stack-core-api:8080'):
                with self.subTest(address=address), self.assertRaises(ValueError):
                    RecoveryConnection(address).connect()
            tunneled = RecoveryConnection('127.0.0.1:4321');tunneled.set_tunnel('example.com')
            with self.assertRaises(ValueError):tunneled.connect()
            connect.assert_not_called()

    def test_handler_refuses_userinfo_fragment_proxy_and_nonfixture_urls(self):
        handler = RecoveryHTTPHandler()
        requests = [urllib.request.Request(url) for url in (
            'http://example.com/', 'http://127.0.0.1:4322.evil/',
            'http://user@127.0.0.1:4322/', 'http://127.0.0.1:4322/#fragment')]
        proxied = urllib.request.Request('http://127.0.0.1:4322/');proxied.set_proxy('proxy:8080', 'http');requests.append(proxied)
        with patch.object(handler, 'do_open') as open_request:
            for request in requests:
                with self.subTest(url=request.full_url), self.assertRaises(urllib.error.URLError):handler.http_open(request)
            open_request.assert_not_called()

    def test_exact_loopback_oidc_request_retains_original_url(self):
        handler = RecoveryHTTPHandler()
        request = urllib.request.Request('http://127.0.0.1:4322/realms/agenttrust/protocol/openid-connect/auth?state=fixture')
        with patch.object(handler, 'do_open') as open_request:
            handler.http_open(request)
            open_request.assert_called_once_with(RecoveryConnection, request)

    def test_opener_refuses_non_http_schemes_before_default_handlers(self):
        opener = fixture_opener(http.cookiejar.CookieJar(), urllib.request.HTTPRedirectHandler())
        with patch.object(urllib.request.FileHandler, 'file_open') as local_file, \
                patch.object(urllib.request.FTPHandler, 'ftp_open') as ftp, \
                patch.object(urllib.request.DataHandler, 'data_open') as inline, \
                patch('stack_recovery_transport.socket.create_connection') as connect:
            for url in ('file:///contract-only', 'ftp://example.invalid/fixture',
                        'data:text/plain,fixture'):
                with self.subTest(scheme=url.split(':')[0]), self.assertRaises(urllib.error.URLError):
                    opener.open(url)
            local_file.assert_not_called()
            ftp.assert_not_called()
            inline.assert_not_called()
            connect.assert_not_called()

    def test_opener_refuses_ftp_redirect_before_external_handler(self):
        opener = fixture_opener(http.cookiejar.CookieJar(), urllib.request.HTTPRedirectHandler())
        url = 'http://127.0.0.1:4322/fixture'
        headers = Message()
        headers['Location'] = 'ftp://example.invalid/fixture'
        response = urllib.error.HTTPError(url, 302, 'Found', headers, io.BytesIO())
        with patch.object(RecoveryHTTPHandler, 'do_open', return_value=response), \
                patch.object(urllib.request.FTPHandler, 'ftp_open') as ftp:
            with self.assertRaises(urllib.error.URLError):
                opener.open(url)
            ftp.assert_not_called()

    def test_https_is_refused_without_attempting_tls(self):
        with self.assertRaises(urllib.error.URLError):
            RefuseHTTPS().https_open(urllib.request.Request('https://example.com/'))


if __name__ == '__main__':unittest.main()
