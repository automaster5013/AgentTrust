"""Real TLS handshakes: default refusal, fixture trust, and hostname refusal."""
import pathlib
import socket
import ssl
import tempfile
import threading
import unittest
from stack_https_fixture_certificates import generate


class ActualTlsFixtureTest(unittest.TestCase):
    def test_actual_certificate_chain_and_hostname_verification(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = pathlib.Path(temporary)
            result = generate(directory)
            self.assertFalse(result['caPrivateKeyWritten'])
            self.assertEqual(set(p.name for p in directory.iterdir()), {'ca.crt', 'server.crt', 'server.key'})
            server_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            server_context.load_cert_chain(directory / 'server.crt', directory / 'server.key')
            listener = socket.socket()
            listener.bind(('127.0.0.1', 0))
            listener.listen(8)
            listener.settimeout(0.1)
            address = listener.getsockname()
            stop = threading.Event()
            requests = []

            def serve():
                while not stop.is_set():
                    try:
                        raw, _ = listener.accept()
                    except socket.timeout:
                        continue
                    except OSError:
                        break
                    raw.settimeout(2)
                    try:
                        with server_context.wrap_socket(raw, server_side=True) as connection:
                            if connection.recv(1) == b'x':
                                requests.append('public-canary')
                                connection.sendall(b'y')
                    except (ssl.SSLError, OSError):
                        raw.close()

            thread = threading.Thread(target=serve, daemon=True)
            thread.start()
            try:
                trusted = ssl.create_default_context(cafile=str(directory / 'ca.crt'))
                self.assertTrue(trusted.check_hostname)
                self.assertEqual(trusted.verify_mode, ssl.CERT_REQUIRED)
                for hostname in ['console.example.com', 'identity.example.com', 'enterprise.example.net']:
                    with socket.create_connection(address, timeout=2) as raw:
                        with trusted.wrap_socket(raw, server_hostname=hostname) as connection:
                            connection.sendall(b'x')
                            self.assertEqual(connection.recv(1), b'y')
                self.assertEqual(len(requests), 3)
                for context, hostname in [(ssl.create_default_context(), 'console.example.com'),
                        (trusted, 'wrong.example.com'), (trusted, '127.0.0.1')]:
                    with self.subTest(kind='actual-tls-certificate-refusal'):
                        with socket.create_connection(address, timeout=2) as raw:
                            with self.assertRaises(ssl.SSLCertVerificationError):
                                context.wrap_socket(raw, server_hostname=hostname)
                self.assertEqual(len(requests), 3, 'Rejected TLS clients must not reach the canary handler')
            finally:
                stop.set()
                listener.close()
                thread.join(3)
                self.assertFalse(thread.is_alive())

    def test_existing_directory_contents_are_never_overwritten(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = pathlib.Path(temporary)
            (path / 'original.txt').write_text('PUBLIC-CANARY', encoding='utf-8')
            with self.assertRaises(ValueError):
                generate(path)
            self.assertEqual((path / 'original.txt').read_text(encoding='utf-8'), 'PUBLIC-CANARY')


if __name__ == '__main__':
    unittest.main()
