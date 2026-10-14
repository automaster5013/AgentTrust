"""Test-only transport for loopback OIDC URLs inside a portless recovery network.

URL, Host, redirects, issuer and cookies retain the original loopback contracts.
Only the TCP destination changes to a fixed fixture-network service. This is never
installed into the application or used by a production client.
"""
import http.client
import socket
import urllib.error
import urllib.parse
import urllib.request

DESTINATIONS = {
    '127.0.0.1:4320': ('stack-console', 3000),
    '127.0.0.1:4321': ('stack-core-api', 8080),
    '127.0.0.1:4322': ('stack-identity', 8080),
    '127.0.0.1:4323': ('stack-gateway', 8080),
}


class RecoveryConnection(http.client.HTTPConnection):
    def connect(self):
        if self._tunnel_host is not None:
            raise ValueError('Recovery tunnel refused')
        target = DESTINATIONS.get(self.host + ':' + str(self.port))
        if target is None:
            raise ValueError('Recovery destination refused')
        self.sock = socket.create_connection(target, self.timeout, self.source_address)


class RecoveryHTTPHandler(urllib.request.HTTPHandler):
    def http_open(self, request):
        parsed = urllib.parse.urlsplit(request.full_url)
        if (parsed.scheme != 'http' or parsed.netloc not in DESTINATIONS
                or parsed.username or parsed.password or parsed.fragment
                or request.has_proxy()):
            raise urllib.error.URLError('Recovery URL refused')
        return self.do_open(RecoveryConnection, request)


class RefuseHTTPS(urllib.request.HTTPSHandler):
    def https_open(self, request):
        raise urllib.error.URLError('Recovery external HTTPS refused')


def fixture_opener(jar, redirects):
    return urllib.request.build_opener(urllib.request.ProxyHandler({}), redirects,
                                      urllib.request.HTTPCookieProcessor(jar),
                                      RecoveryHTTPHandler(), RefuseHTTPS())
