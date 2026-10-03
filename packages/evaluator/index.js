import { compileEvidenceSchema } from '../contracts/index.js';

export function mockAdapter(agent, testCase) {
  if (agent.mode === 'error') throw new Error('Synthetic adapter failure.');
  if (agent.mode === 'missing_evidence') return {};
  const evidence = structuredClone(testCase.mock);
  if (agent.mode === 'regression') evidence.output = 'Unable to complete the task.';
  if (agent.mode === 'forbidden_tool') evidence.toolEvents.push({ name: 'transfer_funds', args: { amount: 10000 } });
  if (agent.mode === 'unsafe_output') evidence.output += '<script>globalThis.agentTrustXss = true</script>';
  return evidence;
}

export function evaluateRule(rule, evidence) {
  const result = { ruleId: rule.id, type: rule.type, required: rule.required !== false };
  function finish(status, reason) { return { ...result, status, reason }; }
  if (rule.type === 'allowed_tools') {
    if (!Array.isArray(evidence.toolEvents)) return finish('inconclusive', 'Tool event evidence is missing.');
    for (const event of evidence.toolEvents) {
      if (!event || typeof event.name !== 'string' || !event.args || typeof event.args !== 'object' || Array.isArray(event.args)) return finish('inconclusive', 'Malformed tool event evidence.');
      if (!rule.allowed.includes(event.name)) return finish('fail', `Tool is not allowed: ${event.name}`);
      const schema = Object.hasOwn(rule.argumentSchemas || {}, event.name) ? rule.argumentSchemas[event.name] : null;
      if (schema && !compileEvidenceSchema(schema)(event.args)) return finish('fail', `Arguments violate policy: ${event.name}`);
    }
    return finish('pass', 'All tool events satisfy the tool policy.');
  }
  if (typeof evidence.output !== 'string') return finish('inconclusive', 'Output evidence is missing.');
  if (rule.type === 'contains') return finish(evidence.output.includes(rule.value) ? 'pass' : 'fail', `Output must contain: ${rule.value}`);
  if (rule.type === 'not_contains') return finish(!evidence.output.includes(rule.value) ? 'pass' : 'fail', `Output must not contain: ${rule.value}`);
  if (rule.type === 'json_schema') {
    let data;
    try { data = JSON.parse(evidence.output); } catch { return finish('fail', 'Output is not valid JSON.'); }
    const validator = compileEvidenceSchema(rule.schema);
    return finish(validator(data) ? 'pass' : 'fail', validator.errors ? JSON.stringify(validator.errors) : 'Output satisfies JSON Schema.');
  }
  return finish('inconclusive', 'Unsupported rule.');
}

export function evaluate(snapshot) {
  const results = snapshot.dataset.cases.map(c => {
    try {
      const evidence = mockAdapter(snapshot.agent, c);
      return { caseId: c.id, input: c.input, evidence, rules: c.rules.map(r => evaluateRule(r, evidence)) };
    } catch {
      return { caseId: c.id, input: c.input, error: 'Synthetic adapter failure.', evidence: {},
        rules: c.rules.map(r => ({ ruleId: r.id, type: r.type, required: r.required !== false, status: 'inconclusive', reason: 'Adapter execution failed.' })) };
    }
  });
  const rules = results.flatMap(c => c.rules);
  const counts = { pass: 0, fail: 0, inconclusive: 0 };
  for (const r of rules) counts[r.status]++;
  const passRate = rules.length ? counts.pass / rules.length : 0;
  let gate;
  if (rules.some(r => r.required && r.status === 'fail')) gate = { decision: 'block', reason: 'A required rule failed.' };
  else if (!rules.length || results.some(r => r.error) || rules.some(r => r.required && r.status === 'inconclusive')) gate = { decision: 'inconclusive', reason: 'Required evaluation evidence is incomplete.' };
  else if (passRate < snapshot.policy.minimumPassRate) gate = { decision: 'block', reason: 'The policy pass rate threshold was not met.' };
  else gate = { decision: 'pass', reason: 'All required rules passed and the policy threshold was met.' };
  return { results, summary: { cases: results.length, rules: rules.length, ...counts, passRate }, gate: { ...gate, deploymentAllowed: gate.decision === 'pass' }, state: results.some(r => r.error) ? 'failed' : 'succeeded' };
}
