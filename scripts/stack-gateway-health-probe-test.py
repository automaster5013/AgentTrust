"""Exercise the real shell/curl health probe against owned loopback responses."""
import http.server
import json
import os
import pathlib
import subprocess
import tempfile
import threading
import time
import unittest


class ProbeContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.hits = []

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                cls.hits.append(self.path)
                case = self.path.split('/')[-1]
                body = b'{"status":"UP"}'
                status = {'created': 201, 'redirect': 302, 'unavailable': 503}.get(case, 200)
                if case == 'down':
                    body = b'{"status":"DOWN"}'
                if case == 'empty':
                    body = b''
                if case in ('boundary', 'oversize', 'chunked-oversize'):
                    body += b' ' * ((16384 if case == 'boundary' else 16385) - len(body))
                self.send_response(status)
                self.send_header('Location', '/redirect-trap')
                if case == 'chunked-oversize':
                    self.send_header('Transfer-Encoding', 'chunked')
                else:
                    self.send_header('Content-Length', str(len(body) + (20 if case == 'truncated' else 0)))
                self.end_headers()
                try:
                    if case == 'slow':
                        time.sleep(3.5)
                    if case == 'chunked-oversize':
                        self.wfile.write(('%x\r\n' % len(body)).encode() + body + b'\r\n0\r\n\r\n')
                    else:
                        self.wfile.write(body)
                except (BrokenPipeError, ConnectionResetError):
                    pass
                self.close_connection = True

        cls.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        cls.server.daemon_threads = True
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.source = (pathlib.Path(__file__).resolve().parents[1] / 'services/gateway/healthcheck.sh').read_text()
        cls.url = 'http://127.0.0.1:8080/actuator/health'
        assert cls.source.count(cls.url) == 1

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def run_probe(self, case, expected):
        with tempfile.TemporaryDirectory() as home:
            # A user curlrc must not redirect output or add another request.
            pathlib.Path(home, '.curlrc').write_text('url = "http://127.0.0.1:%d/curlrc-trap"\n' % self.server.server_port)
            script = self.source.replace(self.url, 'http://127.0.0.1:%d/%s' % (self.server.server_port, case))
            env = {key: os.environ[key] for key in ('PATH', 'SYSTEMROOT') if key in os.environ}
            env.update(HOME=home, CURL_HOME=home, http_proxy='http://127.0.0.1:%d/proxy-trap' % self.server.server_port, NO_PROXY='')
            started = time.monotonic()
            result = subprocess.run(['/bin/sh', '-c', script], env=env, capture_output=True, timeout=6)
            self.assertEqual(result.returncode, expected, case)
            self.assertEqual(result.stdout, b'', case)
            self.assertEqual(result.stderr, b'', case)
            self.assertLess(time.monotonic() - started, 5, case)
            self.assertFalse(any('trap' in path for path in self.hits))

    def test_success_and_exact_size_boundary(self):
        for case in ('up', 'boundary'):
            with self.subTest(case=case):
                self.run_probe(case, 0)

    def test_failure_closed_status_and_body(self):
        for case in ('down', 'empty', 'created', 'redirect', 'unavailable', 'oversize', 'chunked-oversize', 'truncated', 'slow'):
            with self.subTest(case=case):
                self.run_probe(case, 1)


if __name__ == '__main__':
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(ProbeContract)
    result = unittest.TextTestRunner(verbosity=1).run(suite)
    print(json.dumps({'completed': result.wasSuccessful(), 'ownedLoopbackOnly': True, 'cases': 11}))
    raise SystemExit(0 if result.wasSuccessful() else 1)
