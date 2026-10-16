// A fixed, portless CI TLS edge. No request URL, body, cookie or token is logged.
import https from 'node:https';
import http from 'node:http';
import {readFileSync} from 'node:fs';
import {fixturePath} from './edge-policy.mjs';

const directory = '/fixture/certificates';
const destinations = new Map([
  ['console.example.com', {host: 'tls-console', port: 3000}],
  ['identity.example.com', {host: 'tls-identity', port: 8080}],
  ['enterprise.example.net', {host: 'tls-enterprise', port: 8080}],
]);
const counts = {authorization: 0, token: 0, userinfo: 0, jwks: 0, callback: 0, providerLogout: 0,
  enterpriseAuthorization: 0, enterpriseToken: 0, enterpriseUserinfo: 0, enterpriseJwks: 0,
  enterpriseLogout: 0, brokerCallback: 0, forwarded: 0, refusedHost: 0};
const server = https.createServer({
  key: readFileSync(directory + '/server.key'),
  cert: readFileSync(directory + '/server.crt'),
  minVersion: 'TLSv1.2', maxHeaderSize: 16384,
}, (request, response) => {
  const host = request.headers.host;
  if (!destinations.has(host) || request.socket.servername !== host) {
    counts.refusedHost++;
    response.writeHead(421); response.end(); return;
  }
  if (request.method === 'GET' && request.url === '/fixture/observations') {
    response.writeHead(200, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'});
    response.end(JSON.stringify(counts)); return;
  }
  const path = fixturePath(host, request.url);
  if (path === null) {
    response.writeHead(404); response.end(); return;
  }
  const known = new Map([
    ['/realms/agenttrust/protocol/openid-connect/auth', 'authorization'],
    ['/realms/agenttrust/protocol/openid-connect/token', 'token'],
    ['/realms/agenttrust/protocol/openid-connect/userinfo', 'userinfo'],
    ['/realms/agenttrust/protocol/openid-connect/certs', 'jwks'],
    ['/backend/login/oauth2/code/keycloak', 'callback'],
    ['/realms/agenttrust/protocol/openid-connect/logout', 'providerLogout'],
    ['/realms/enterprise-synthetic/protocol/openid-connect/auth', 'enterpriseAuthorization'],
    ['/realms/enterprise-synthetic/protocol/openid-connect/token', 'enterpriseToken'],
    ['/realms/enterprise-synthetic/protocol/openid-connect/userinfo', 'enterpriseUserinfo'],
    ['/realms/enterprise-synthetic/protocol/openid-connect/certs', 'enterpriseJwks'],
    ['/realms/enterprise-synthetic/protocol/openid-connect/logout', 'enterpriseLogout'],
    ['/realms/agenttrust/broker/enterprise/endpoint', 'brokerCallback'],
  ]);
  if (known.has(path)) counts[known.get(path)]++;
  counts.forwarded++;
  const headers = {...request.headers};
  // Never trust caller-supplied proxy headers, even inside this private fixture.
  for (const name of Object.keys(headers)) {
    if (name === 'forwarded' || name.startsWith('x-forwarded-')) delete headers[name];
  }
  Object.assign(headers, {host, 'x-forwarded-host': host, 'x-forwarded-proto': 'https',
    'x-forwarded-port': '443', 'x-forwarded-for': request.socket.remoteAddress});
  const destination = destinations.get(host);
  const upstream = http.request({...destination, path: request.url, method: request.method, headers}, incoming => {
    response.writeHead(incoming.statusCode, incoming.headers);
    incoming.pipe(response);
  });
  const deadline = setTimeout(() => upstream.destroy(), 15000);
  upstream.on('error', () => {if (!response.headersSent) response.writeHead(502); response.end();});
  upstream.on('close', () => clearTimeout(deadline));
  response.on('close', () => {clearTimeout(deadline); upstream.destroy();});
  let bytes = 0;
  request.on('data', chunk => {
    bytes += chunk.length;
    if (bytes > 32768) {upstream.destroy(); request.destroy();}
  });
  request.pipe(upstream);
});
server.requestTimeout = 15000;
server.headersTimeout = 5000;
server.on('tlsClientError', () => {});
server.listen(443, '0.0.0.0');
