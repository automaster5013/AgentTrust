import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, evaluateRule } from '../packages/evaluator/index.js';
import { sampleDataset } from '../packages/contracts/samples.js';
import { validate } from '../packages/contracts/index.js';
import { Store } from '../apps/api/store.js';

const snapshot = mode => ({ agent: { name: mode, mode }, dataset: structuredClone(sampleDataset), policy: { name: 'strict', minimumPassRate: 1 } });
for (const [mode, decision, state] of [
  ['compliant', 'pass', 'succeeded'], ['regression', 'block', 'succeeded'], ['forbidden_tool', 'block', 'succeeded'],
  ['error', 'inconclusive', 'failed'], ['missing_evidence', 'inconclusive', 'succeeded'], ['unsafe_output', 'block', 'succeeded']
]) test(`${mode}: ${decision}, ${state}`, () => {
  const result = evaluate(snapshot(mode));
  assert.equal(result.gate.decision, decision); assert.equal(result.state, state);
  assert.equal(result.gate.deploymentAllowed, decision === 'pass');
  assert.equal(result.results.length, 3);
  assert.deepEqual(evaluate(snapshot(mode)), result);
});
test('tool arguments are checked even when the tool name is allowed', () => {
  const rule = sampleDataset.cases[2].rules[0];
  const result = evaluateRule(rule, { toolEvents: [{ name: 'lookup_order', args: { orderId: 'OTHER', admin: true } }] });
  assert.equal(result.status, 'fail');
});
test('missing required evidence cannot pass a zero threshold', () => {
  const data = snapshot('missing_evidence'); data.policy.minimumPassRate = 0;
  assert.equal(evaluate(data).gate.decision, 'inconclusive');
});
test('a required failure blocks even when another case errors', () => {
  const data = snapshot('compliant'); data.dataset.cases[0].mock.output = 'wrong';
  data.dataset.cases[1].mock = null;
  const result = evaluate(data);
  assert.equal(result.state, 'failed'); assert.equal(result.gate.decision, 'block');
});
test('JSON schema rejects invalid JSON and extra properties', () => {
  const rule = sampleDataset.cases[1].rules[0];
  for (const output of ['plain text', '{"status":"resolved","confidence":0.9,"extra":true}', '{"status":"resolved","confidence":2}']) assert.equal(evaluateRule(rule, { output }).status, 'fail');
});
test('validation rejects malformed contracts and dangerous schema keywords', () => {
  for (const mode of ['url', 'shell', 'compliant; command']) assert.throws(() => validate('agent', { name: 'x', mode }));
  for (const keyword of ['$ref', 'pattern', 'format', 'if']) {
    const data = structuredClone(sampleDataset); data.cases[1].rules[0].schema[keyword] = 'https://invalid.test';
    assert.throws(() => validate('dataset', data));
  }
  const duplicate = structuredClone(sampleDataset); duplicate.cases.push(duplicate.cases[0]);
  assert.throws(() => validate('dataset', duplicate));
  const empty = structuredClone(sampleDataset); empty.cases[0].rules.forEach(r => r.required = false);
  assert.throws(() => validate('dataset', empty));
  assert.throws(() => validate('policy', { name: 'x', minimumPassRate: -1 }));
});
test('source mutations and later versions do not change an existing run', async () => {
  const store = new Store();
  const input = structuredClone(sampleDataset); const dataset = store.createVersion('dataset', input);
  const catalog = store.catalog();
  const request = { agentVersionId: catalog.agent[0].id, datasetVersionId: dataset.id, policyVersionId: catalog.policy[0].id };
  const { run } = store.createRun(request, 'immutable-key');
  input.cases[0].mock.output = 'mutated'; dataset.cases[0].rules[0].value = 'mutated';
  store.createVersion('dataset', { ...input, name: 'changed' });
  const returned = store.getRun(run.id); returned.snapshot.policy.minimumPassRate = 0;
  await new Promise(resolve => setImmediate(resolve));
  const final = store.getRun(run.id);
  assert.equal(final.gate.decision, 'pass'); assert.equal(final.snapshotHash, run.snapshotHash);
  assert.equal(final.snapshot.policy.minimumPassRate, 1);
  assert.equal(final.snapshot.dataset.cases[0].rules[0].value, '7일');
  const before = final.resultHash; store.execute(run.id); assert.equal(store.getRun(run.id).resultHash, before);
});
test('idempotency returns the same run and rejects changed requests', () => {
  const store = new Store(); const c = store.catalog();
  const input = { agentVersionId: c.agent[0].id, datasetVersionId: c.dataset[0].id, policyVersionId: c.policy[0].id };
  const first = store.createRun(input, 'same-request'); const replay = store.createRun(input, 'same-request');
  assert.equal(first.run.id, replay.run.id); assert.equal(replay.replay, true);
  const reordered = { policyVersionId: input.policyVersionId, datasetVersionId: input.datasetVersionId, agentVersionId: input.agentVersionId };
  assert.equal(store.createRun(reordered, 'same-request').run.id, first.run.id);
  assert.throws(() => store.createRun({ ...input, agentVersionId: c.agent[1].id }, 'same-request'), /conflict/);
  assert.throws(() => store.createRun(input, ''), /Idempotency/);
});
test('local memory capacity is bounded', () => {
  const store = new Store({ limit: 6 });
  assert.throws(() => store.createVersion('agent', { name: 'extra', mode: 'compliant' }), /capacity/);
});
