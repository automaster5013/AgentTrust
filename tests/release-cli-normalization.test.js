import test from 'node:test';
import assert from 'node:assert/strict';
import {checkRelease} from '../scripts/release-gate.mjs';
import {hash} from '../packages/contracts/hash.js';
const candidate='abcdefab-cdef-abcd-efab-cdefabcdefab',baseline='fedcbafe-dcba-fedc-bafe-dcbafedcbafe';
test('release CLI canonicalizes mixed-case execution version project and baseline IDs',async()=>{
 const original=globalThis.fetch;let captured;
 globalThis.fetch=async(url,options)=>{captured=options;const request=JSON.parse(options.body),result={runId:candidate,decision:'pass',deploymentAllowed:true,reasons:[],comparison:{candidateRunId:candidate,baselineRunId:baseline,comparable:true,deploymentAllowed:true}},artifact={request,result,projectId:candidate};return new Response(JSON.stringify({...result,artifact,artifactHash:hash(artifact)}));};
 const options={base:'http://127.0.0.1:4310/',accessKey:'atci_synthetic',candidateRunId:candidate.toUpperCase(),baselineRunId:baseline.toUpperCase(),projectId:candidate.toUpperCase(),agentVersionId:candidate.toUpperCase(),datasetVersionId:candidate.toUpperCase(),policyVersionId:candidate.toUpperCase(),checkKey:'Keep_Case_123'};
 try{const result=await checkRelease(options);assert.equal(result.deploymentAllowed,true);assert.deepEqual(JSON.parse(captured.body),{candidateRunId:candidate,baselineRunId:baseline,agentVersionId:candidate,datasetVersionId:candidate,policyVersionId:candidate});assert.equal(captured.headers['X-AgentTrust-Project'],candidate);assert.equal(captured.headers['Idempotency-Key'],'Keep_Case_123');assert.equal(options.candidateRunId,candidate.toUpperCase());}finally{globalThis.fetch=original;}
});
test('case-only duplicate baseline is refused without network',async()=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('Unexpected call');};try{await assert.rejects(checkRelease({base:'http://127.0.0.1:4310/',accessKey:'atci_synthetic',candidateRunId:candidate.toUpperCase(),baselineRunId:candidate,agentVersionId:candidate,datasetVersionId:candidate,policyVersionId:candidate}),/distinct/);assert.equal(calls,0);}finally{globalThis.fetch=original;}
});
