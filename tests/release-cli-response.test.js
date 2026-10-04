import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../packages/contracts/hash.js';
import {checkRelease} from '../scripts/release-gate.mjs';
const id='00000000-0000-0000-0000-000000000123',baseline='00000000-0000-0000-0000-000000000456';
const input={base:'http://127.0.0.1:4310/',accessKey:'atci_synthetic',candidateRunId:id,agentVersionId:id,datasetVersionId:id,policyVersionId:id};
async function check(result,options={}){
 const request={candidateRunId:id,agentVersionId:id,datasetVersionId:id,policyVersionId:id,...(options.baselineRunId?{baselineRunId:options.baselineRunId}:{})};
 const artifact={request,result},receipt={...result,artifact,artifactHash:hash(artifact)};
 const original=globalThis.fetch;globalThis.fetch=async()=>new Response(JSON.stringify(receipt),{headers:{'Content-Type':'application/json'}});try{return await checkRelease({...input,...options});}finally{globalThis.fetch=original;}
}
const passing={runId:id,decision:'pass',deploymentAllowed:true,reasons:[]};
test('CLI rejects hash-consistent contradictions between decision, permission and reasons',async()=>{
 for(const result of [{...passing,decision:'block'},{...passing,deploymentAllowed:false},{...passing,reasons:['Blocked']},{...passing,reasons:null},{...passing,reasons:[7]}])await assert.rejects(check(result),/decision is inconsistent/);
 assert.equal((await check(passing)).deploymentAllowed,true);assert.equal((await check({...passing,decision:'block',deploymentAllowed:false,reasons:['Approval missing']})).deploymentAllowed,false);
});
test('CLI binds baseline comparison to requested runs and rejects incomplete permissive comparisons',async()=>{
 const comparison={baselineRunId:baseline,candidateRunId:id,comparable:true,deploymentAllowed:true};
 for(const value of [undefined,{...comparison,baselineRunId:id},{...comparison,candidateRunId:baseline},{...comparison,comparable:false},{...comparison,deploymentAllowed:false}])await assert.rejects(check({...passing,comparison:value},{baselineRunId:baseline}),/baseline comparison/);
 assert.equal((await check({...passing,comparison},{baselineRunId:baseline})).deploymentAllowed,true);
});
test('manual baseline evaluation pass remains separate from overall administrator approval',async()=>{
 const comparison={baselineRunId:baseline,candidateRunId:id,comparable:true,evaluationPassed:true,deploymentAllowed:false,requiresManualApproval:true};
 assert.equal((await check({...passing,comparison},{baselineRunId:baseline})).deploymentAllowed,true);
 assert.equal((await check({...passing,decision:'block',deploymentAllowed:false,reasons:['Approval missing'],comparison},{baselineRunId:baseline})).deploymentAllowed,false);
});
