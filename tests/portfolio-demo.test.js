import test from 'node:test';
import assert from 'node:assert/strict';
import {runPortfolioScenario} from '../scripts/portfolio-scenario.mjs';

function fixture({failCheck=0,failWait=false,failCleanup=false}={}){
  const calls=[],runs=new Map();let review='missing',checks=0,verified=0;
  const call=async(path,data)=>{
    calls.push({path,data});
    if(path==='/v1/catalog')return {agent:['compliant','regression','missing_evidence'].map(mode=>({id:mode,mode})),dataset:[{id:'dataset',name:'Customer support safety · v1'}],policy:[{id:'policy',name:'필수 검증 전체 통과',minimumPassRate:1}]};
    if(path==='/v1/policy-versions')return {id:'manual'};
    if(path==='/v1/runs'){
      const id='run-'+(runs.size+1),decision={compliant:'pass',regression:'block',missing_evidence:'inconclusive'}[data.agentVersionId];
      const run={id,state:'succeeded',gate:{decision,evaluationPassed:decision==='pass',deploymentAllowed:decision==='pass'&&data.policyVersionId!=='manual'}};runs.set(id,run);return run;
    }
    if(path.endsWith('/reviews')){if(failCleanup&&data.decision==='rejected')throw Error('Synthetic cleanup failure');review=data.decision;return {};}
    if(path.endsWith('/cancel'))return {};
    if(path==='/v1/release-gate'){
      if(++checks===failCheck)throw Error('Synthetic check failure');
      const decision=runs.get(data.candidateRunId).gate.decision,manual=data.policyVersionId==='manual';
      return {decision,deploymentAllowed:decision==='pass'&&(!manual||review==='approved'),...(manual?{manualApproval:{status:review}}:{}),artifact:{receiptId:'receipt-'+checks}};
    }
    throw Error('Unexpected path');
  };
  return {calls,get verified(){return verified;},dependencies:{call,wait:async id=>{if(failWait)throw Error('Synthetic wait failure');return runs.get(id);},verify:()=>{verified++;return {signatureVerified:true};}}};
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
