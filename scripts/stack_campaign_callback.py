"""Fixed loopback worker callbacks; no proxy or authenticated redirect requests."""
import json
import urllib.error
import urllib.request


class CallbackRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, newurl):
        response.close()
        raise urllib.error.URLError('Worker callback redirect refused')


def callback(path, body, expected, token):
    request = urllib.request.Request('http://127.0.0.1:4321/internal/' + path,
        data=json.dumps(body).encode(),
        headers={'Content-Type': 'application/json', 'X-AgentTrust-Worker-Token': token},
        method='POST')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), CallbackRedirects())
    try:
        response = opener.open(request, timeout=10)
    except urllib.error.HTTPError as error:
        response = error
    try:
        status = response.status
        response.read(16385)
    finally:
        response.close()
    if status != expected:
        raise ValueError('Worker callback status refused')
