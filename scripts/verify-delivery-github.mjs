import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {verifyPromotedDeliveryManifest} from './delivery-manifest.mjs';
import {readDeliveryManifest,deliveryExpectations} from './verify-delivery.mjs';

export const deliveryJobs=Object.freeze(['test','Publish candidate container','Verify registry image runtime','Promote runtime-verified main image']);
export function verifyGitHubAttempt(report,run,listing){
  assert.equal(report.identityAndStructureVerified,true);
  assert.ok(Number.isSafeInteger(run.id));assert.equal(String(run.id),report.workflow.runId);
  assert.ok(Number.isSafeInteger(run.run_attempt));assert.equal(String(run.run_attempt),report.workflow.attempt);
  assert.equal(run.head_sha,report.revision);assert.equal(run.head_branch,'main');
  assert.ok(['push','workflow_dispatch'].includes(run.event));
  assert.equal(run.path,'.github/workflows/validate.yml');
  assert.equal(run.repository.full_name.toLowerCase(),report.repository.toLowerCase());
  assert.equal(run.head_repository.full_name.toLowerCase(),report.repository.toLowerCase());
  assert.equal(run.html_url,report.workflow.url);assert.equal(run.status,'completed');assert.equal(run.conclusion,'success');
  assert.equal(listing.total_count,deliveryJobs.length);assert.equal(listing.jobs.length,deliveryJobs.length);
  assert.deepEqual(listing.jobs.map(job=>job.name).sort(),[...deliveryJobs].sort());
  assert.equal(new Set(listing.jobs.map(job=>job.id)).size,deliveryJobs.length);
  for(const job of listing.jobs){
    assert.ok(Number.isSafeInteger(job.id)&&job.id>0);
    assert.equal(job.run_id,run.id);assert.equal(job.run_attempt,run.run_attempt);assert.equal(job.head_sha,report.revision);
    assert.equal(job.status,'completed');assert.equal(job.conclusion,'success');
  }
  return {ciSuccessChecked:true,ciJobsVerified:deliveryJobs.length,ciCheckedAt:new Date().toISOString(),registryDigestBindingChecked:false,signatureVerified:false};
}
async function getGitHub(url,token,fetchImpl){
  const headers={Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10'};
  if(token){assert.equal(typeof token,'string');assert.ok(token.length<=1024&&!/[\r\n]/.test(token));headers.Authorization='Bearer '+token;}
  const response=await fetchImpl(url,{method:'GET',headers,redirect:'error',signal:AbortSignal.timeout(15000)});
  if(response.status!==200){await response.body?.cancel().catch(()=>{});throw new Error('GitHub query did not succeed.');}
  assert.ok(response.body);
  const chunks=[];let bytes=0;
  for await(const chunk of response.body){bytes+=chunk.length;assert.ok(bytes<=1048576);chunks.push(chunk);}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
}
export async function verifyGitHubDelivery(env,manifest,{token,fetchImpl=fetch}={}){
  const report=verifyPromotedDeliveryManifest(deliveryExpectations(env),manifest);
  const base=`https://api.github.com/repos/${report.repository}/actions/runs/${report.workflow.runId}/attempts/${report.workflow.attempt}`;
  const run=await getGitHub(base,token,fetchImpl);
  // The attempt-specific endpoint prevents mixing jobs from a later rerun.
  const listing=await getGitHub(base+'/jobs?per_page=100',token,fetchImpl);
  return {...report,...verifyGitHubAttempt(report,run,listing)};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    assert.equal(process.argv.length,3);assert.ok(process.argv[2].endsWith('.json'));
    const report=await verifyGitHubDelivery(process.env,await readDeliveryManifest(process.argv[2]),{token:process.env.AGENTTRUST_GITHUB_TOKEN});
    console.log(JSON.stringify({schemaVersion:1,status:'passed',readOnly:true,...report}));
  }catch{
    console.log(JSON.stringify({schemaVersion:1,status:'blocked',code:'DELIVERY_GITHUB_UNVERIFIED',readOnly:true,guidance:'Check independent manifest expectations, GitHub read access and the completed successful workflow attempt with all four required jobs. No offline fallback or deployment was performed.'}));
    console.error('GitHub delivery verification blocked.');process.exitCode=1;
  }
}
