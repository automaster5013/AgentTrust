import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyGitHubDelivery,deliveryJobs} from '../scripts/verify-delivery-github.mjs';
import {preflightChecks} from '../scripts/preflight-diagnostic.mjs';
const env={AGENTTRUST_DELIVERY_REPOSITORY:'automaster5013/AgentTrust',AGENTTRUST_EXPECTED_REVISION:'a'.repeat(40),AGENTTRUST_DELIVERY_RUN_ID:'123',AGENTTRUST_DELIVERY_RUN_ATTEMPT:'1',AGENTTRUST_IMAGE:'ghcr.io/automaster5013/agenttrust@sha256:'+'b'.repeat(64)};
function fixture(){
 const manifest={schemaVersion:1,repository:env.AGENTTRUST_DELIVERY_REPOSITORY,revision:env.AGENTTRUST_EXPECTED_REVISION,image:env.AGENTTRUST_IMAGE,workflow:{runId:'123',attempt:'1',url:'https://github.com/automaster5013/AgentTrust/actions/runs/123'},state:'promoted',verification:{runtimeVerifiedAt:'2026-10-04T00:00:00.000Z',preflightVerifiedAt:'2026-10-04T00:01:00.000Z',checks:preflightChecks.map(({id})=>id)},promotedAt:'2026-10-04T00:02:00.000Z',serverDeployed:false};
 const run={id:123,run_attempt:1,head_sha:manifest.revision,head_branch:'main',event:'push',path:'.github/workflows/validate.yml',repository:{full_name:manifest.repository},head_repository:{full_name:manifest.repository},html_url:manifest.workflow.url,status:'completed',conclusion:'success'};
 const listing={total_count:4,jobs:deliveryJobs.map((name,i)=>({id:i+1,name,run_id:123,run_attempt:1,head_sha:manifest.revision,status:'completed',conclusion:'success'}))};return {manifest,run,listing};
}
function transport(f,requests=[]){return async(url,options)=>{requests.push({url,options});return new Response(JSON.stringify(url.includes('/jobs?')?f.listing:f.run),{status:200});};}
test('online verification binds attempt-specific HTTPS requests and projects only public results',async()=>{
 const f=fixture(),requests=[],canary='secret-token-do-not-print';f.run.extra=canary;f.listing.jobs[0].extra=canary;
 const report=await verifyGitHubDelivery(env,f.manifest,{token:canary,fetchImpl:transport(f,requests)});
 assert.equal(report.ciSuccessChecked,true);assert.equal(report.ciJobsVerified,4);assert.equal(report.signatureVerified,false);assert.equal(report.registryDigestBindingChecked,false);assert.ok(!JSON.stringify(report).includes(canary));
 assert.deepEqual(requests.map(r=>r.url),['https://api.github.com/repos/automaster5013/AgentTrust/actions/runs/123/attempts/1','https://api.github.com/repos/automaster5013/AgentTrust/actions/runs/123/attempts/1/jobs?per_page=100']);
 assert.ok(requests.every(r=>r.options.method==='GET'&&r.options.redirect==='error'&&r.options.signal instanceof AbortSignal));
});
test('online verification rejects queued, failed, skipped, duplicate, missing and mismatched remote records',async()=>{
 for(const change of [f=>f.run.status='in_progress',f=>f.run.conclusion='failure',f=>f.run.run_attempt=2,f=>f.run.head_sha='c'.repeat(40),f=>f.run.event='pull_request',f=>f.run.head_branch='other',f=>f.run.path='.github/workflows/other.yml',f=>f.run.head_repository.full_name='other/repo',f=>f.listing.jobs[0].conclusion='skipped',f=>f.listing.jobs[0].status='queued',f=>f.listing.jobs[0].run_attempt=2,f=>f.listing.jobs[0].head_sha='c'.repeat(40),f=>f.listing.jobs.pop(),f=>f.listing.total_count=5,f=>f.listing.jobs[1]={...f.listing.jobs[0]}]){
  const f=fixture();change(f);await assert.rejects(verifyGitHubDelivery(env,f.manifest,{fetchImpl:transport(f)}));
 }
});
test('API errors, oversized responses and malformed manifests fail without offline fallback',async()=>{
 const f=fixture();let calls=0;
 await assert.rejects(verifyGitHubDelivery(env,{...f.manifest,state:'runtime_verified'},{fetchImpl:async()=>{calls++;throw Error('Should not fetch');}}));assert.equal(calls,0);
 for(const fetchImpl of [async()=>new Response('denied',{status:403}),async()=>new Response('redirect',{status:302}),async()=>new Response(' '.repeat(1048577)),async()=>new Response('bad JSON'),async()=>{throw Error('network timeout');}])await assert.rejects(verifyGitHubDelivery(env,f.manifest,{fetchImpl}));
});
