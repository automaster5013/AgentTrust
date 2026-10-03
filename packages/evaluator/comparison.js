import { InputError } from '../contracts/index.js';
import { hash } from '../contracts/hash.js';

export function compareRuns(baseline, candidate) {
  if (baseline.organizationId !== candidate.organizationId || baseline.projectId !== candidate.projectId) throw new InputError('Runs must belong to the same project.');
  if (baseline.snapshot.dataset.contentHash !== candidate.snapshot.dataset.contentHash || baseline.snapshot.policy.contentHash !== candidate.snapshot.policy.contentHash) throw new InputError('Comparison requires identical dataset and policy content.',409);
  const index = run => new Map(run.results.flatMap(c => c.rules.map(r => [JSON.stringify([c.caseId,r.ruleId]),r.status])));
  const before=index(baseline), after=index(candidate);
  const coverage=run=>{const expected=run.snapshot.dataset.cases.flatMap(c=>c.rules.map(r=>JSON.stringify([c.id,r.id])));const actual=run.results.flatMap(c=>c.rules.map(r=>JSON.stringify([c.caseId,r.ruleId])));return expected.length===actual.length&&new Set(actual).size===expected.length&&expected.every(k=>actual.includes(k));};
  const complete = run => coverage(run) && run.state==='succeeded' && !run.results.some(c=>c.error) && run.results.length===run.snapshot.dataset.cases.length && run.results.every(c=>c.rules.every(r=>r.status!=='inconclusive'));
  const comparable=complete(baseline)&&complete(candidate)&&before.size===after.size&&[...before.keys()].every(k=>after.has(k));
  const changes=[...before].filter(([key,status])=>after.get(key)!==status).map(([key,status])=>({caseId:JSON.parse(key)[0],ruleId:JSON.parse(key)[1],before:status,after:after.get(key)||'missing'}));
  const regressions=changes.filter(c=>c.before==='pass'&&c.after!=='pass');
  return {baselineRunId:baseline.id,candidateRunId:candidate.id,comparable,changes,regressions,passRateDelta:candidate.summary.passRate-baseline.summary.passRate,deploymentAllowed:comparable&&candidate.gate.deploymentAllowed===true&&regressions.length===0};
}

export function releaseGate(run, expected, baseline, now=Date.now()) {
  const reasons=[];
  for(const key of ['agentVersionId','datasetVersionId','policyVersionId']) if(!expected[key]||run[key]!==expected[key]) reasons.push(`Version mismatch: ${key}`);
  const maxAgeSeconds=expected.maxAgeSeconds??600;
  if(!Number.isInteger(maxAgeSeconds)||maxAgeSeconds<1||maxAgeSeconds>86400) throw new InputError('maxAgeSeconds must be 1..86400.');
  const age=now-Date.parse(run.completedAt);
  if(!Number.isFinite(age)||age<0||age>maxAgeSeconds*1000) reasons.push('Result is missing, stale or future-dated.');
  if(run.state!=='succeeded'||run.gate.decision!=='pass'||run.gate.deploymentAllowed!==true) reasons.push('A completed passing evaluation is required.');
  if(run.snapshotHash!==hash(run.snapshot)||run.resultHash!==hash({results:run.results,gate:run.gate})) reasons.push('Evidence integrity verification failed.');
  if(!compareRuns(run,run).comparable) reasons.push('Evaluation coverage is incomplete.');
  const comparison=baseline?compareRuns(baseline,run):undefined;
  if(comparison&&!comparison.deploymentAllowed) reasons.push('Baseline comparison is incomplete or regressed.');
  return {runId:run.id,deploymentAllowed:reasons.length===0,decision:reasons.length?'block':'pass',reasons,comparison};
}
