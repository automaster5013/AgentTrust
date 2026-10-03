import { compileEvidenceSchema } from '../contracts/index.js';

export function mockAdapter(agent, testCase) {
  if (agent.mode === 'https') throw new Error('HTTPS agents require the external adapter.');
  if (agent.mode === 'error') throw new Error('Synthetic adapter failure.');
  if (agent.mode === 'missing_evidence') return {};
  const evidence = structuredClone(testCase.mock);
  if (agent.mode === 'regression') evidence.output = 'Unable to complete the task.';
  if (agent.mode === 'forbidden_tool') evidence.toolEvents.push({ name: 'transfer_funds', args: { amount: 10000 } });
  if (agent.mode === 'unsafe_output') evidence.output += '<script>globalThis.agentTrustXss = true</script>';
  return evidence;
}

function schemaDiagnostic(errors){
  const details=JSON.stringify(errors.slice(0,5)),note=errors.length>5?` (${errors.length} validation errors; first 5 shown.)`:'';
  const available=2000-note.length;
  return (details.length>available?details.slice(0,available-1).toWellFormed()+'…':details)+note;
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
    const passed=validator(data);
    return finish(passed ? 'pass' : 'fail', passed ? 'Output satisfies JSON Schema.' : schemaDiagnostic(validator.errors));
  }
  return finish('inconclusive', 'Unsupported rule.');
}

export function evaluate(snapshot, adapter = mockAdapter) {
  const results = snapshot.dataset.cases.map(c => {
    try {
      const evidence = adapter(snapshot.agent, c);
      return { caseId: c.id, input: c.input, evidence, rules: c.rules.map(r => evaluateRule(r, evidence)) };
    } catch {
      return { caseId: c.id, input: c.input, error: 'Adapter execution failed.', evidence: {},
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
  const requiresManualApproval=snapshot.policy.requiresManualApproval===true;
  return { results, summary: { cases: results.length, rules: rules.length, ...counts, passRate }, gate: { ...gate, deploymentAllowed: gate.decision === 'pass'&&!requiresManualApproval,...(requiresManualApproval?{evaluationPassed:gate.decision==='pass',requiresManualApproval:true}:{}) }, state: results.some(r => r.error) ? 'failed' : 'succeeded' };
}

export async function evaluateAsync(snapshot, adapter) {
  const evidence = new Map();
  for (const c of snapshot.dataset.cases) {
    try { evidence.set(c.id, { value: await adapter(snapshot,c) }); }
    catch { evidence.set(c.id, { error: true }); }
  }
  return evaluate(snapshot, (_agent,c) => {
    const item=evidence.get(c.id);
    if(item.error) throw new Error('Adapter failure.');
    return item.value;
  });
}
