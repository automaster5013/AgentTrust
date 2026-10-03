import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, evaluateRule } from '../packages/evaluator/index.js';
import { sampleDataset } from '../packages/contracts/samples.js';
import { validate } from '../packages/contracts/index.js';


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


test('deeply nested evidence is rejected before schema compilation or database serialization', () => {
  const data=structuredClone(sampleDataset);let nested={};const root=nested;
  for(let i=0;i<30;i++){nested.child={};nested=nested.child;}
  data.cases[2].mock.toolEvents[0].args=root;
  assert.throws(()=>validate('dataset',data),/nesting/);
});
