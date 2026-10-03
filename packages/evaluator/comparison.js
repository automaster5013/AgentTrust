import { InputError } from '../contracts/index.js';
import { hash } from '../contracts/hash.js';
import { runIntegrity } from './integrity.js';
export const evaluationPassing=run=>run.state==='succeeded'&&run.gate.decision==='pass'&&(run.gate.deploymentAllowed===true||run.snapshot.policy.requiresManualApproval===true&&run.gate.requiresManualApproval===true&&run.gate.evaluationPassed===true);

function integrityChecker(){
  const checked=new WeakMap();
  return run=>{if(!checked.has(run))checked.set(run,runIntegrity(run));return checked.get(run);};
}
export function compareRuns(baseline,candidate){return compare(baseline,candidate,integrityChecker());}
function compare(baseline, candidate,check) {
  if (baseline.organizationId !== candidate.organizationId || baseline.projectId !== candidate.projectId) throw new InputError('Runs must belong to the same project.');
  if (baseline.snapshot.dataset.contentHash !== candidate.snapshot.dataset.contentHash || baseline.snapshot.policy.contentHash !== candidate.snapshot.policy.contentHash) throw new InputError('Comparison requires identical dataset and policy content.',409);
  const index = run => new Map(run.results.flatMap(c => c.rules.map(r => [JSON.stringify([c.caseId,r.ruleId]),r.status])));
  const before=index(baseline), after=index(candidate);
  const coverage=run=>{const expected=run.snapshot.dataset.cases.flatMap(c=>c.rules.map(r=>JSON.stringify([c.id,r.id])));const actual=run.results.flatMap(c=>c.rules.map(r=>JSON.stringify([c.caseId,r.ruleId]))),seen=new Set(actual);return expected.length===actual.length&&seen.size===expected.length&&expected.every(k=>seen.has(k));};
  const complete = run => check(run) && coverage(run) && run.state==='succeeded' && !run.results.some(c=>c.error) && run.results.length===run.snapshot.dataset.cases.length && run.results.every(c=>c.rules.every(r=>r.status!=='inconclusive'));
  const comparable=complete(baseline)&&complete(candidate)&&before.size===after.size&&[...before.keys()].every(k=>after.has(k));
  const changes=[...before].filter(([key,status])=>after.get(key)!==status).map(([key,status])=>({caseId:JSON.parse(key)[0],ruleId:JSON.parse(key)[1],before:status,after:after.get(key)||'missing'}));
  const regressions=changes.filter(c=>c.before==='pass'&&c.after!=='pass');
  const evaluationPassed=comparable&&evaluationPassing(candidate)&&regressions.length===0;
  return {baselineRunId:baseline.id,candidateRunId:candidate.id,comparable,changes,regressions,passRateDelta:candidate.summary.passRate-baseline.summary.passRate,deploymentAllowed:evaluationPassed&&candidate.snapshot.policy.requiresManualApproval!==true,...(candidate.snapshot.policy.requiresManualApproval?{evaluationPassed,requiresManualApproval:true}:{})};
}

export function releaseGate(run, expected, baseline, now=Date.now(),review) {
  const reasons=[],check=integrityChecker();
  for(const key of ['agentVersionId','datasetVersionId','policyVersionId']) if(!expected[key]||run[key]!==expected[key]) reasons.push(`Version mismatch: ${key}`);
  const maxAgeSeconds=expected.maxAgeSeconds??600;
  if(!Number.isInteger(maxAgeSeconds)||maxAgeSeconds<1||maxAgeSeconds>86400) throw new InputError('maxAgeSeconds must be 1..86400.');
  const age=now-Date.parse(run.completedAt);
  if(!Number.isFinite(age)||age<0||age>maxAgeSeconds*1000) reasons.push('Result is missing, stale or future-dated.');
  if(!evaluationPassing(run)) reasons.push('A completed passing evaluation is required.');
  if(run.snapshotHash!==hash(run.snapshot)||run.resultHash!==hash({results:run.results,gate:run.gate})) reasons.push('Evidence integrity verification failed.');
  if(!check(run))reasons.push('Evidence structure, version binding or summary is inconsistent.');
  if(!compare(run,run,check).comparable) reasons.push('Evaluation coverage is incomplete.');
  const comparison=baseline?compare(baseline,run,check):undefined;
  if(comparison&&!(comparison.evaluationPassed??comparison.deploymentAllowed)) reasons.push('Baseline comparison is incomplete or regressed.');
  let manualApproval;
  if(run.snapshot.policy.requiresManualApproval===true){
    let status='missing';
    if(review){
      const age=now-Date.parse(review.createdAt);
      const payload=Object.fromEntries(Object.entries(review).filter(([key])=>!['reviewHash','actorValid'].includes(key)));
      if(review.reviewHash!==hash(payload)||review.organizationId!==run.organizationId||review.projectId!==run.projectId||review.runId!==run.id||review.snapshotHash!==run.snapshotHash||review.resultHash!==run.resultHash||review.actorValid!==true)status='invalid';
      else if(review.decision==='rejected')status='rejected';
      else if(!Number.isFinite(age)||age<0||age>(run.snapshot.policy.manualApprovalTtlSeconds??3600)*1000)status='expired';
      else if(review.decision==='approved')status='approved';
      else status='invalid';
    }
    manualApproval={required:true,status,...(review?{reviewId:review.id,reviewHash:review.reviewHash}:{})};
    if(status!=='approved')reasons.push('A current administrator approval is required: '+status+'.');
  }
  return {runId:run.id,deploymentAllowed:reasons.length===0,decision:reasons.length?'block':'pass',reasons,comparison,...(manualApproval?{manualApproval}:{})};
}
