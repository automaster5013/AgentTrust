import test from 'node:test';
import assert from 'node:assert/strict';
import {runPortfolioScenario} from '../scripts/portfolio-scenario.mjs';

function fixture({failCheck=0,failWait=false,failCleanup=false,changeReceipt=()=>{},changeRun=()=>{}}={}){
  const calls=[],runs=new Map();let review='missing',checks=0,verified=0;
  const call=async(path,data)=>{
    calls.push({path,data});
    if(path==='/v1/catalog')return {agent:['compliant','regression','missing_evidence'].map(mode=>({id:mode,mode})),dataset:[{id:'dataset',name:'Customer support safety · v1'}],policy:[{id:'policy',name:'필수 검증 전체 통과',minimumPassRate:1}]};
    if(path==='/v1/policy-versions')return {id:'manual'};
    if(path==='/v1/runs'){
      const id='run-'+(runs.size+1),decision={compliant:'pass',regression:'block',missing_evidence:'inconclusive'}[data.agentVersionId];
      const run={id,agentVersionId:data.agentVersionId,datasetVersionId:data.datasetVersionId,policyVersionId:data.policyVersionId,state:'succeeded',snapshotHash:'snapshot-'+id,resultHash:'result-'+id,gate:{decision,evaluationPassed:decision==='pass',deploymentAllowed:decision==='pass'&&data.policyVersionId!=='manual'}};runs.set(id,run);return run;
    }
    if(path.endsWith('/reviews')){if(failCleanup&&data.decision==='rejected')throw Error('Synthetic cleanup failure');review=data.decision;return {};}
    if(path.endsWith('/cancel'))return {};
    if(path==='/v1/release-gate'){
      if(++checks===failCheck)throw Error('Synthetic check failure');
      const decision=runs.get(data.candidateRunId).gate.decision,manual=data.policyVersionId==='manual';
      const allowed=decision==='pass'&&(!manual||review==='approved'),baseline=runs.get(data.baselineRunId);
      const candidate=runs.get(data.candidateRunId);
      const receipt={decision:allowed?'pass':'block',deploymentAllowed:allowed,...(manual?{manualApproval:{status:review}}:{}),runId:candidate.id,reasons:allowed?[]:['synthetic block'],artifact:{receiptId:'receipt-'+checks,request:{...data},evidence:{candidate:{runId:candidate.id,snapshotHash:candidate.snapshotHash,resultHash:candidate.resultHash},...(baseline?{baseline:{runId:baseline.id,snapshotHash:baseline.snapshotHash,resultHash:baseline.resultHash}}:{})}},...(baseline?{comparison:{baselineRunId:baseline.id,candidateRunId:data.candidateRunId,comparable:decision!=='inconclusive',evaluationPassed:decision==='pass',regressions:decision==='pass'?[]:[{caseId:'synthetic',ruleId:'required'}]}}:{})};
      receipt.artifact.result=structuredClone(Object.fromEntries(Object.entries(receipt).filter(([k])=>k!=='artifact')));
      changeReceipt(receipt,checks);return receipt;
    }
    throw Error('Unexpected path');
  };
  return {calls,get verified(){return verified;},dependencies:{call,wait:async id=>{if(failWait)throw Error('Synthetic wait failure');const run=structuredClone(runs.get(id));changeRun(run);return run;},verify:()=>{verified++;return {signatureVerified:true};}}};
}
test('portfolio scenario demonstrates four evaluations and six independently signed release decisions',async()=>{
  const f=fixture(),r=await runPortfolioScenario(f.dependencies);
  assert.equal(r.completed,true);assert.equal(r.cleanupSucceeded,true);assert.equal(r.steps.length,10);assert.equal(f.verified,6);
  assert.deepEqual(r.steps.filter(s=>s.receiptId).map(s=>s.deploymentAllowed),[true,false,false,false,true,false]);
  assert.deepEqual(r.steps.filter(s=>s.name.startsWith('approval_')).map(s=>s.manualApproval),['missing','approved','rejected']);
  assert.equal(f.calls.filter(c=>c.path==='/v1/runs').length,4);assert.equal(f.calls.at(-2).data.decision,'rejected');assert.equal(r.serverDeployed,false);
});
test('failed post-approval verification leaves the synthetic example rejected',async()=>{
  const f=fixture({failCheck:5}),r=await runPortfolioScenario(f.dependencies);
  assert.equal(r.completed,false);assert.equal(r.cleanupSucceeded,true);assert.equal(f.calls.at(-1).data.decision,'rejected');
});
test('unfinished evaluation is cancelled without leaking raw errors into the report',async()=>{
  const f=fixture({failWait:true}),r=await runPortfolioScenario(f.dependencies);
  assert.equal(r.completed,false);assert.equal(r.cleanupSucceeded,true);assert.match(f.calls.at(-1).path,/\/cancel$/);assert.ok(!JSON.stringify(r).includes('Synthetic wait failure'));
});
test('signature or cleanup failures prevent a successful demo report',async()=>{
  const unsigned=fixture();unsigned.dependencies.verify=()=>({signatureVerified:false});assert.equal((await runPortfolioScenario(unsigned.dependencies)).completed,false);
  const f=fixture({failCheck:5,failCleanup:true}),r=await runPortfolioScenario(f.dependencies);assert.equal(r.completed,false);assert.equal(r.cleanupSucceeded,false);
});

test('comparison demo binds six signed decisions to two distinct policy baselines and preserves approval boundaries',async()=>{
  const f=fixture(),r=await runPortfolioScenario({...f.dependencies,compare:true});
  assert.equal(r.completed,true);assert.equal(r.cleanupSucceeded,true);assert.equal(r.withBaselineComparison,true);
  assert.equal(r.steps.length,12);assert.equal(f.verified,6);assert.equal(f.calls.filter(c=>c.path==='/v1/runs').length,6);
  const checks=r.steps.filter(s=>s.receiptId),baselines=r.steps.filter(s=>s.name==='baseline_compliant');
  assert.equal(baselines.length,2);assert.notEqual(baselines[0].runId,baselines[1].runId);
  assert.deepEqual(checks.map(s=>s.deploymentAllowed),[true,false,false,false,true,false]);
  assert.deepEqual(checks.map(s=>s.comparisonEvaluationPassed),[true,false,false,true,true,true]);
  assert.deepEqual(checks.map(s=>s.comparable),[true,true,false,true,true,true]);
  for(const [i,c] of checks.entries()){assert.equal(c.baselineRunId,baselines[i<3?0:1].runId);assert.notEqual(c.runId,c.baselineRunId);}
});

test('comparison demo rejects wrong baseline evidence or comparison semantics even when signature verification succeeds',async()=>{
  for(const change of [r=>{r.artifact.request.candidateRunId='wrong';},r=>{r.artifact.request.agentVersionId='wrong';},r=>{r.artifact.evidence.candidate.runId='wrong';},r=>{r.artifact.evidence.candidate.resultHash='wrong';},r=>{r.artifact.request.baselineRunId='wrong';},r=>{r.artifact.evidence.baseline.resultHash='wrong';},r=>{r.comparison.candidateRunId='wrong';},r=>{r.comparison.regressions=[{}];},r=>{r.comparison.comparable=false;},r=>{r.comparison.evaluationPassed=false;}]){
    const f=fixture({changeReceipt:change}),r=await runPortfolioScenario({...f.dependencies,compare:true});
    assert.equal(r.completed,false);assert.equal(r.cleanupSucceeded,true);assert.equal(f.verified,1);
  }
});

test('comparison failure after approval still rejects the demonstration and an unfinished baseline is cancelled',async()=>{
  const f=fixture({changeReceipt:(r,n)=>{if(n===5)r.comparison.baselineRunId='wrong';}}),r=await runPortfolioScenario({...f.dependencies,compare:true});
  assert.equal(r.completed,false);assert.equal(r.cleanupSucceeded,true);assert.equal(f.calls.at(-1).data.decision,'rejected');
  const pending=fixture({failWait:true}),unfinished=await runPortfolioScenario({...pending.dependencies,compare:true});
  assert.equal(unfinished.completed,false);assert.equal(unfinished.cleanupSucceeded,true);assert.match(pending.calls.at(-1).path,/\/cancel$/);
});

 test('default demo rejects a valid signature attached to unrelated evidence or unsigned decision fields',async()=>{
  for(const change of [r=>{r.artifact.request.candidateRunId='wrong';},r=>{r.artifact.request.policyVersionId='wrong';},r=>{r.artifact.evidence.candidate.resultHash='wrong';},r=>{r.artifact.evidence.candidate.runId='wrong';},r=>{r.artifact.result.deploymentAllowed=false;},r=>{r.artifact.result.decision='block';},r=>{r.runId='wrong';}]){
    const f=fixture({changeReceipt:change}),r=await runPortfolioScenario(f.dependencies);
    assert.equal(r.completed,false);assert.equal(r.cleanupSucceeded,true);
  }
 });

test('portfolio polling cannot substitute another execution or fixed version and cleanup cancels the created ID',async()=>{
 for(const changeRun of [r=>{r.id='other';},r=>{r.agentVersionId='other';},r=>{r.datasetVersionId='other';},r=>{r.policyVersionId='other';}])for(const compare of [false,true]){
  const f=fixture({changeRun}),r=await runPortfolioScenario({...f.dependencies,compare});assert.equal(r.completed,false);assert.equal(r.cleanupSucceeded,true);assert.equal(f.calls.at(-1).path,'/v1/runs/run-1/cancel');
 }
});
