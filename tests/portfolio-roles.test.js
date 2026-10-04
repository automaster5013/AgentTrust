import test from 'node:test';
import assert from 'node:assert/strict';
import {runRoleScenario} from '../scripts/portfolio-roles-scenario.mjs';

function fixture({waitFails=false,denyFails=false,checkFails=false,cleanupFails=false,changeReceipt=()=>{},changeRun=()=>{}}={}){
  const calls=[];let review='missing',checks=0;
  const completed={id:'synthetic-run',agentVersionId:'agent',datasetVersionId:'dataset',policyVersionId:'policy',state:'succeeded',snapshotHash:'synthetic-hash',resultHash:'synthetic-result',gate:{decision:'pass',evaluationPassed:true,deploymentAllowed:false}};
  const call=async(role,path,data,expected)=>{
    calls.push({role,path,data,expected});
    if(expected){if(denyFails)throw Error('Authorization was unexpectedly allowed');return;}
    if(path==='/v1/catalog')return {agent:[{id:'agent',mode:'compliant'}],dataset:[{id:'dataset',name:'Customer support safety · v1'}]};
    if(path==='/v1/policy-versions')return {id:'policy'};
    if(path==='/v1/runs')return {...completed,state:'queued'};
    if(path.endsWith('/cancel'))return {};
    if(path.endsWith('/reviews')){if(!data)return [];if(cleanupFails&&data.decision==='rejected')throw Error('Synthetic cleanup failure');review=data.decision;return {};}
    if(path==='/v1/release-gate'){
      checks++;if(checkFails&&checks===2)throw Error('Synthetic signed check failure');
      const allowed=review==='approved',result={runId:completed.id,decision:allowed?'pass':'block',deploymentAllowed:allowed,reasons:allowed?[]:['synthetic block'],manualApproval:{status:review}};
      const receipt={...result,artifact:{receiptId:'receipt-'+checks,request:{...data},result:structuredClone(result),evidence:{candidate:{runId:completed.id,snapshotHash:completed.snapshotHash,resultHash:completed.resultHash}}}};
      changeReceipt(receipt,checks);return receipt;
    }
    return completed;
  };
  return {calls,dependencies:{call,wait:async()=>{if(waitFails)throw Error('Synthetic wait failure');const run=structuredClone(completed);changeRun(run);return run;},verify:()=>({signatureVerified:true})}};
}
test('role demo separates editor creation, viewer checks, admin reviews and organization denials',async()=>{
  const f=fixture(),r=await runRoleScenario(f.dependencies);assert.equal(r.completed,true);assert.equal(r.cleanupSucceeded,true);assert.equal(r.steps.length,11);
  assert.equal(f.calls.find(c=>c.path==='/v1/runs'&&!c.expected).role,'editor');
  assert.deepEqual(f.calls.filter(c=>c.expected).map(c=>c.expected),[403,403,403,403,404,404]);
  assert.ok(f.calls.filter(c=>c.path==='/v1/release-gate'&&!c.expected).every(c=>c.role==='viewer'));
  assert.ok(f.calls.filter(c=>c.path.endsWith('/reviews')&&c.data&&!c.expected).every(c=>c.role==='admin'));
  assert.deepEqual(r.steps.filter(s=>s.signatureVerified).map(s=>s.deploymentAllowed),[false,true,false]);
});
test('unexpected authorization success blocks the role demonstration',async()=>{
  const f=fixture({denyFails:true}),r=await runRoleScenario(f.dependencies);assert.equal(r.completed,false);assert.ok(!JSON.stringify(r).includes('unexpectedly allowed'));
});
test('role demo cancels its unfinished editor run after polling failure',async()=>{
  const f=fixture({waitFails:true}),r=await runRoleScenario(f.dependencies);assert.equal(r.completed,false);assert.equal(r.cleanupSucceeded,true);assert.equal(f.calls.at(-1).role,'editor');assert.match(f.calls.at(-1).path,/\/cancel$/);
});
test('failed signed approval check triggers admin rejection and reports cleanup failure',async()=>{
  const f=fixture({checkFails:true}),r=await runRoleScenario(f.dependencies);assert.equal(r.completed,false);assert.equal(f.calls.at(-1).data.decision,'rejected');assert.equal(r.cleanupSucceeded,true);
  const broken=fixture({checkFails:true,cleanupFails:true});assert.equal((await runRoleScenario(broken.dependencies)).cleanupSucceeded,false);
});

 test('role demo checks signed candidate evidence and rejects unsigned approval substitutions',async()=>{
  for(const change of [r=>{r.artifact.request.candidateRunId='wrong';},r=>{r.artifact.evidence.candidate.snapshotHash='wrong';},r=>{r.artifact.result.manualApproval.status='approved';},r=>{r.artifact.result.deploymentAllowed=true;}]){
    const f=fixture({changeReceipt:change}),r=await runRoleScenario(f.dependencies);assert.equal(r.completed,false);assert.equal(r.cleanupSucceeded,true);
  }
  const f=fixture({changeReceipt:(r,n)=>{if(n===2)r.artifact.result.manualApproval.status='missing';}}),r=await runRoleScenario(f.dependencies);
  assert.equal(r.completed,false);assert.equal(r.cleanupSucceeded,true);assert.equal(f.calls.at(-1).data.decision,'rejected');
 });

test('role polling cannot replace the editor-created ID or versions and cancels only that created execution',async()=>{
 for(const changeRun of [r=>{r.id='other';},r=>{r.agentVersionId='other';},r=>{r.datasetVersionId='other';},r=>{r.policyVersionId='other';}]){
  const f=fixture({changeRun}),r=await runRoleScenario(f.dependencies);assert.equal(r.completed,false);assert.equal(r.cleanupSucceeded,true);assert.equal(f.calls.at(-1).path,'/v1/runs/synthetic-run/cancel');assert.equal(f.calls.at(-1).role,'editor');
 }
});
