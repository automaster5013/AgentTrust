import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {readFile,writeFile,rm,mkdtemp,readdir} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {ReceiptSigner} from '../packages/receipts/signature.js';
import {hash} from '../packages/contracts/hash.js';
import {writePortfolioEvidence,loadPortfolioEvidence} from '../scripts/portfolio-evidence.mjs';
import {inspectPortfolioEvidence} from '../scripts/portfolio-evidence-inspection.mjs';
import {parsePortfolioInspectionArguments} from '../scripts/inspect-portfolio-evidence.mjs';
const exec=promisify(execFile),canary='private-opinion-and-reason-canary';

function fixture(compare=false,withReviews=false){
 const signer=new ReceiptSigner(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'pem'}));
 const trustedPem=signer.publicMetadata().publicKey,organizationId=randomUUID(),projectId=randomUUID(),datasetVersionId=randomUUID(),policies=[randomUUID(),randomUUID()],candidates=Array.from({length:4},()=>randomUUID()),agents=Array.from({length:3},()=>randomUUID()),baselines=[randomUUID(),randomUUID()];
 const names=['release_compliant','release_regression','release_missing_evidence','approval_required','approval_valid','approval_rejected'];
 const receipts=names.map((step,index)=>{
  const runId=candidates[Math.min(index,3)],baselineRunId=baselines[index<3?0:1],allowed=[true,false,false,false,true,false][index];
  const request={candidateRunId:runId,agentVersionId:agents[index<3?index:0],datasetVersionId,policyVersionId:policies[index<3?0:1],...(compare?{baselineRunId}:{})};
  const changes=[1,2].includes(index)?[{caseId:'case',ruleId:'required',before:'pass',after:index===1?'fail':'missing'}]:[];
  const result={runId,decision:allowed?'pass':'block',deploymentAllowed:allowed,reasons:allowed?[]:[canary],...(index>=3?{manualApproval:{required:true,status:['missing','approved','rejected'][index-3],...(index>3?{reviewId:randomUUID(),reviewHash:'c'.repeat(64)}:{})}}:{}),...(compare?{comparison:{candidateRunId:runId,baselineRunId,comparable:index!==2,passRateDelta:0,changes,regressions:changes.map(change=>({...change})),requiresManualApproval:index>=3,evaluationPassed:![1,2].includes(index),deploymentAllowed:index<3&&allowed}}:{})};
  return {artifact:{schemaVersion:1,receiptId:randomUUID(),organizationId,projectId,checkedAt:'2026-10-08T00:00:00.000Z',request,result,evidence:{candidate:{runId,snapshotHash:hash(runId),resultHash:hash('result'+runId)},...(compare?{baseline:{runId:baselineRunId,snapshotHash:hash(baselineRunId),resultHash:hash('result'+baselineRunId)}}:{})}}};
 });
 const reviews=receipts.slice(4).map(receipt=>{
  const a=receipt.artifact,payload={schemaVersion:1,id:a.result.manualApproval.reviewId,organizationId,projectId,runId:a.request.candidateRunId,actorId:randomUUID(),decision:a.result.manualApproval.status,comment:canary,createdAt:'2026-10-07T23:59:00.000Z',snapshotHash:a.evidence.candidate.snapshotHash,resultHash:a.evidence.candidate.resultHash};
  const review={...payload,reviewHash:hash(payload)};a.result.manualApproval.reviewHash=review.reviewHash;return review;
 });
 const resign=()=>{for(const receipt of receipts){receipt.artifactHash=hash(receipt.artifact);receipt.signature=signer.sign(receipt.artifact);}};resign();
 return {receipts,trustedPem,organizationId,projectId,resign,...(withReviews?{reviews}:{}),report:{completed:true,cleanupSucceeded:true,sessionLoggedOut:true,withBaselineComparison:compare,steps:receipts.map((r,i)=>({name:names[i],receiptId:r.artifact.receiptId,runId:r.artifact.request.candidateRunId,...(compare?{baselineRunId:r.artifact.request.baselineRunId}:{})}))}};
}
async function bundle(t,f=fixture()){
 const written=await writePortfolioEvidence(f);t.after(async()=>{assert.ok(resolve(written.directory).startsWith(resolve('.local')+sep));await rm(written.directory,{recursive:true,force:true});});return {...f,...written};
}

test('offline six-record inspection supports both bundle formats and comparison modes without current authority',async t=>{
 for(const compare of [false,true])for(const reviews of [false,true]){
  const f=await bundle(t,fixture(compare,reviews)),files=await readdir(f.directory),before=await Promise.all(files.map(name=>readFile(join(f.directory,name))));
  const summary=await inspectPortfolioEvidence(f.directory,f.trustedPem,f.manifestSha256);
  assert.equal(summary.semanticStructuresVerified,6);assert.equal(summary.records.length,6);assert.equal(summary.expectedManifestDigestMatched,true);assert.equal(summary.manifestCryptographicallySigned,false);
  assert.deepEqual(summary.records.map(r=>r.historicalDecision),['pass','block','block','block','pass','block']);
  assert.equal(summary.records.filter(r=>r.reviewBodyVerified).length,reviews?2:0);
  assert.ok(summary.records.every(r=>r.signatureVerified&&r.structureVerified&&r.comparison.performed===compare&&!r.expectedScopeVerified&&!r.expectedCandidateVerified&&!r.deploymentAllowed&&!r.currentReviewerAuthorityVerified&&!r.evidenceBodiesVerified));
  assert.equal(summary.currentReleasePermissionVerified,false);assert.equal(summary.deploymentAllowed,false);assert.equal(JSON.stringify(summary).includes(canary),false);
  assert.deepEqual(await readdir(f.directory),files);assert.deepEqual(await Promise.all(files.map(name=>readFile(join(f.directory,name)))),before);
 }
});

test('an externally selected organization and project bind all six signatures and reject other valid scopes',async t=>{
 const f=await bundle(t,fixture(true,true)),expected={organizationId:f.organizationId.toUpperCase(),projectId:f.projectId.toUpperCase()};
 const summary=await inspectPortfolioEvidence(f.directory,f.trustedPem,f.manifestSha256,expected);assert.ok(summary.expectedScopeVerified&&summary.records.every(r=>r.expectedScopeVerified));
 for(const field of ['organizationId','projectId'])await assert.rejects(inspectPortfolioEvidence(f.directory,f.trustedPem,f.manifestSha256,{organizationId:f.organizationId,projectId:f.projectId,[field]:randomUUID()}));
 for(const expected of [{organizationId:f.organizationId},{organizationId:f.organizationId,projectId:f.projectId,candidateRunId:randomUUID()},[],null])await assert.rejects(inspectPortfolioEvidence('missing',f.trustedPem,undefined,expected));
});

test('a validly signed comparison contradiction passes legacy inventory checks but fails semantic inspection',async t=>{
 for(const mutate of [a=>{a.result.comparison.changes=[];},a=>{a.result.comparison.passRateDelta=2;},a=>{a.result.comparison.changes.push({...a.result.comparison.changes[0]});}]){
  const f=fixture(true,true);mutate(f.receipts[1].artifact);f.resign();const b=await bundle(t,f);
  assert.equal((await loadPortfolioEvidence(b.directory,b.trustedPem,b.manifestSha256)).verification.bundleVerified,true);
  await assert.rejects(inspectPortfolioEvidence(b.directory,b.trustedPem,b.manifestSha256));
 }
});

test('the bundle inspection CLI redacts opinions and reasons while binding an explicit digest and scope',async t=>{
 const f=await bundle(t,fixture(true,true)),dir=await mkdtemp(join(resolve('.local'),'portfolio-inspection-key-test-'));t.after(async()=>{assert.ok(resolve(dir).startsWith(resolve('.local')+sep));await rm(dir,{recursive:true,force:true});});
 const key=join(dir,'trusted.pem');await writeFile(key,f.trustedPem);
 const args=[f.directory,key,'--manifest-sha256',f.manifestSha256,'--organization-id',f.organizationId,'--project-id',f.projectId];
 const result=await exec(process.execPath,['scripts/inspect-portfolio-evidence.mjs',...args],{windowsHide:true,timeout:15000,maxBuffer:65536});
 const summary=JSON.parse(result.stdout);assert.equal(summary.semanticStructuresVerified,6);assert.equal(summary.expectedScopeVerified,true);assert.equal(result.stdout.includes(canary),false);
 for(const badArgs of [[f.directory,key,'--manifest-sha256','f'.repeat(64)],[f.directory,key,'--organization-id',randomUUID(),'--project-id',f.projectId]])await assert.rejects(exec(process.execPath,['scripts/inspect-portfolio-evidence.mjs',...badArgs],{windowsHide:true,timeout:15000}),e=>e.code===2&&!e.stdout&&!e.stderr.includes(canary));
});

test('a malformed last signed record produces no partial CLI success and does not alter the source bundle',async t=>{
 const f=fixture(true,true);f.receipts[5].artifact.result.reasons=[canary+'x'.repeat(501)];f.resign();const b=await bundle(t,f),dir=await mkdtemp(join(resolve('.local'),'portfolio-inspection-failure-test-'));
 t.after(async()=>{assert.ok(resolve(dir).startsWith(resolve('.local')+sep));await rm(dir,{recursive:true,force:true});});const key=join(dir,'trusted.pem');await writeFile(key,b.trustedPem);
 assert.equal((await loadPortfolioEvidence(b.directory,b.trustedPem,b.manifestSha256)).verification.bundleVerified,true);
 const before=await readFile(join(b.directory,'receipt-6.json'));await assert.rejects(exec(process.execPath,['scripts/inspect-portfolio-evidence.mjs',b.directory,key,'--manifest-sha256',b.manifestSha256],{windowsHide:true,timeout:15000}),e=>e.code===2&&!e.stdout&&!e.stderr.includes(canary));assert.deepEqual(await readFile(join(b.directory,'receipt-6.json')),before);
});

test('bundle inspection options reject ambiguous digests, partial scopes and unknown record selectors',()=>{
 const scope={organizationId:randomUUID(),projectId:randomUUID()};assert.deepEqual(parsePortfolioInspectionArguments(['bundle','key','--project-id',scope.projectId,'--organization-id',scope.organizationId]).expected,scope);
 assert.equal(parsePortfolioInspectionArguments(['bundle','key']).expected,undefined);
 for(const args of [[],['bundle'],['bundle','key','--manifest-sha256','bad'],['bundle','key','--organization-id',scope.organizationId],['bundle','key','--project-id',scope.projectId],['bundle','key','--candidate-run-id',randomUUID()],['bundle','key','--manifest-sha256','a'.repeat(64),'--manifest-sha256','a'.repeat(64)],['bundle','key','--organization-id',scope.organizationId,'--organization-id',scope.organizationId],['bundle','key','--manifest-sha256']])assert.throws(()=>parsePortfolioInspectionArguments(args));
});
