import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Store } from './store.js';
import { InputError } from '../../packages/contracts/index.js';
import { sampleDataset } from '../../packages/contracts/samples.js';

const webRoot = new URL('../web/', import.meta.url);
const assets = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/styles.css': ['styles.css', 'text/css'] };
const BODY_LIMIT = 262144;
async function body(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw new InputError('Content-Type must be application/json.', 415);
  if (req.headers['x-agenttrust-request'] !== 'local-ui') throw new InputError('Missing local request header.', 403);
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw new InputError('JSON body exceeds 256 KiB.', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new InputError('Invalid JSON body.'); }
}
export function createApp({ store = new Store() } = {}) {
  const server = createServer(async (req, res) => {
    const traceId = randomUUID();
    const headers = {
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store', 'X-Trace-Id': traceId
    };
    const send = (code, data) => { res.writeHead(code, { ...headers, 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    try {
      // Host validation blocks DNS rebinding; Origin + custom JSON header blocks cross-site writes.
      const expectedHost = `127.0.0.1:${req.socket.localPort}`;
      if (req.headers.host !== expectedHost) throw new InputError('Use the loopback address 127.0.0.1.', 403);
      if (req.headers.origin && req.headers.origin !== `http://${expectedHost}`) throw new InputError('Cross-origin requests are denied.', 403);
      const path = new URL(req.url, `http://${expectedHost}`).pathname;
      if (req.method === 'GET' && assets[path]) {
        const [file, type] = assets[path];
        const content = await readFile(new URL(file, webRoot));
        res.writeHead(200, { ...headers, 'Content-Type': `${type}; charset=utf-8` }); res.end(content); return;
      }
      if (req.method === 'GET' && path === '/health') return send(200, { status: 'ok', mode: 'local-mock', persistent: false });
      if (req.method === 'GET' && path === '/v1/catalog') return send(200, store.catalog());
      if (req.method === 'GET' && path === '/v1/sample-dataset') return send(200, sampleDataset);
      if (req.method === 'GET' && path === '/v1/runs') return send(200, store.listRuns());
      const versionKind = { '/v1/agent-versions': 'agent', '/v1/dataset-versions': 'dataset', '/v1/policy-versions': 'policy' }[path];
      if (req.method === 'POST' && versionKind) return send(201, store.createVersion(versionKind, await body(req)));
      if (req.method === 'POST' && path === '/v1/runs') {
        const result = store.createRun(await body(req), req.headers['idempotency-key']);
        return send(result.replay ? 200 : 202, result.run);
      }
      const match = /^\/v1\/runs\/([a-zA-Z0-9-]+)(?:\/(results|gate))?$/.exec(path);
      if (req.method === 'GET' && match) {
        const run = store.getRun(match[1]); return send(200, match[2] ? run[match[2]] : run);
      }
      throw new InputError('Endpoint not found.', 404);
    } catch (error) { send(error instanceof InputError ? error.status : 500, { error: error instanceof InputError ? error.message : 'Internal error.', traceId }); }
  });
  server.requestTimeout = 10000; server.headersTimeout = 10000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 4310);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be between 1024 and 65535.');
  const server = createApp();
  server.listen(port, '127.0.0.1', () => console.log(`AgentTrust local demo: http://127.0.0.1:${port}`));
  const stop = () => { server.close(); server.closeAllConnections(); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
