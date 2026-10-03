import test from 'node:test';
import { request as httpRequest } from 'node:http';
import assert from 'node:assert/strict';
import { createApp } from '../apps/api/server.js';

const headers = { 'Content-Type': 'application/json', 'X-AgentTrust-Request': 'local-ui' };
async function fixture(t) {
  const server = createApp();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return `http://127.0.0.1:${server.address().port}`;
}
test('HTTP vertical flow, import, result evidence and immutable versions', async t => {
  const base = await fixture(t);
  const catalog = await (await fetch(`${base}/v1/catalog`)).json();
  const sample = await (await fetch(`${base}/v1/sample-dataset`)).json();
  const imported = await fetch(`${base}/v1/dataset-versions`, { method: 'POST', headers, body: JSON.stringify({ ...sample, name: 'Imported' }) });
  assert.equal(imported.status, 201); const dataset = await imported.json();
  for (const agent of catalog.agent) {
    const request = { agentVersionId: agent.id, datasetVersionId: dataset.id, policyVersionId: catalog.policy[0].id };
    const key = `http-test-${agent.mode}`;
    const response = await fetch(`${base}/v1/runs`, { method: 'POST', headers: { ...headers, 'Idempotency-Key': key }, body: JSON.stringify(request) });
    assert.equal(response.status, 202); const run = await response.json();
    let final;
    for (let i = 0; i < 50; i++) {
      final = await (await fetch(`${base}/v1/runs/${run.id}`)).json();
      if (['succeeded', 'failed'].includes(final.state)) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(['succeeded', 'failed'].includes(final.state));
    const gate = await (await fetch(`${base}/v1/runs/${run.id}/gate`)).json();
    assert.equal(gate.deploymentAllowed, agent.mode === 'compliant');
    const results = await (await fetch(`${base}/v1/runs/${run.id}/results`)).json();
    assert.equal(results.length, 3);
    const replay = await fetch(`${base}/v1/runs`, { method: 'POST', headers: { ...headers, 'Idempotency-Key': key }, body: JSON.stringify(request) });
    assert.equal(replay.status, 200); assert.equal((await replay.json()).id, run.id);
  }
  assert.equal((await (await fetch(`${base}/v1/runs`)).json()).length, 6);
  assert.equal((await fetch(`${base}/v1/dataset-versions/${dataset.id}`, { method: 'PUT', headers, body: '{}' })).status, 404);
});
test('API rejects cross-site requests, invalid inputs and arbitrary routes', async t => {
  const base = await fixture(t);
  assert.equal((await fetch(`${base}/v1/catalog`, { headers: { Origin: 'https://evil.test' } })).status, 403);
  const wrongHostStatus = await new Promise((resolve, reject) => {
    const req = httpRequest(`${base}/health`, { headers: { Host: 'evil.test' } }, response => { response.resume(); resolve(response.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(wrongHostStatus, 403);
  assert.equal((await fetch(`${base}/v1/agent-versions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  assert.equal((await fetch(`${base}/v1/agent-versions`, { method: 'POST', headers, body: '{invalid' })).status, 400);
  assert.equal((await fetch(`${base}/v1/agent-versions`, { method: 'POST', headers, body: JSON.stringify({ name: 'x', mode: 'shell' }) })).status, 400);
  assert.equal((await fetch(`${base}/v1/agent-versions`, { method: 'POST', headers: { ...headers, 'Content-Type': 'text/plain' }, body: '{}' })).status, 415);
  assert.equal((await fetch(`${base}/v1/runs/nonexistent`)).status, 404);
  assert.equal((await fetch(`${base}/.env`)).status, 404);
  assert.equal((await fetch(`${base}/v1/agent-versions`, { method: 'POST', headers, body: JSON.stringify({ name: 'x'.repeat(270000), mode: 'compliant' }) })).status, 413);
});
test('UI assets have strict CSP and render evidence through textContent', async t => {
  const base = await fixture(t); const page = await fetch(base);
  assert.equal(page.status, 200); assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const html = await page.text(); assert.match(html, /lang="ko"/); assert.match(html, /id="results"/);
  const js = await (await fetch(`${base}/app.js`)).text();
  assert.doesNotMatch(js, /innerHTML|outerHTML|insertAdjacentHTML|eval\(/);
  assert.match(js, /element.textContent = text/);
  assert.equal((await fetch(`${base}/styles.css`)).status, 200);
});
