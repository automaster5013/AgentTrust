import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {ReceiptSigner} from '../packages/receipts/signature.js';
import {hash} from '../packages/contracts/hash.js';
import {inspectHistoricalReceipt} from '../packages/receipts/inspection.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const pair=generateKeyPairSync('ed25519'),key=pair.publicKey.export({type:'spki',format:'pem'}),signer=new ReceiptSigner(pair.privateKey.export({type:'pkcs8',format:'pem'}));
function fixture(status='approved'){
 const payload={schemaVersion:1,id:id(5),organizationId:id(2),projectId:id(3),runId:id(4),actorId:id(6),decision:status==='rejected'?'rejected':'approved',comment:'private synthetic review <script>',createdAt:'2026-10-08T00:00:00.000Z',snapshotHash:'a'.repeat(64),resultHash:'b'.repeat(64)};
 const review={...payload,reviewHash:hash(payload)},pass=status==='approved';
 const artifact={schemaVersion:1,receiptId:id(1),organizationId:id(2),projectId:id(3),checkedAt:'2026-10-08T01:00:00.000Z',request:{candidateRunId:id(4)},result:{runId:id(4),decision:pass?'pass':'block',deploymentAllowed:pass,reasons:pass?[]:['Historical approval is not effective.'],manualApproval:{required:true,status,reviewId:review.id,reviewHash:review.reviewHash}},evidence:{candidate:{runId:id(4),snapshotHash:review.snapshotHash,resultHash:review.resultHash}}};
 return {artifact,review};
}
const signed=a=>({artifact:a,artifactHash:hash(a),signature:signer.sign(a)});
test('offline review body is authenticated through signed reference without current authority',()=>{
 for(const status of ['approved','rejected','expired','invalid']){
  const {artifact,review}=fixture(status),summary=inspectHistoricalReceipt(signed(artifact),key,undefined,review);
  assert.equal(summary.reviewBodyVerified,true);assert.equal(summary.linkedReviewId,review.id);assert.equal(summary.linkedReviewHash,review.reviewHash);
  assert.equal(summary.manualApprovalStatus,status);assert.equal(summary.deploymentAllowed,false);assert.equal(summary.currentReleasePermissionVerified,false);assert.equal(summary.currentReviewerAuthorityVerified,false);
  assert.ok(!JSON.stringify(summary).includes(review.comment));assert.ok(!JSON.stringify(summary).includes(review.actorId));
 }
 const {artifact}=fixture();assert.equal(inspectHistoricalReceipt(signed(artifact),key).reviewBodyVerified,false);
});
test('modified or unreferenced review cannot become authenticated by recomputing its hash',()=>{
 const {artifact,review}=fixture();
 for(const field of ['comment','id','organizationId','projectId','runId','actorId','snapshotHash','resultHash','decision','createdAt']){
  const changed={...review,[field]:field==='comment'?'altered':field==='createdAt'?'2026-10-08T00:30:00.000Z':field==='decision'?'rejected':field.endsWith('Hash')?'c'.repeat(64):id(9)};
  const {reviewHash,...payload}=changed;changed.reviewHash=hash(payload);
  assert.throws(()=>inspectHistoricalReceipt(signed(artifact),key,undefined,changed));
 }
 assert.throws(()=>inspectHistoricalReceipt(signed(artifact),key,undefined,{...review,comment:'altered'}));
 for(const status of [undefined,'missing']){
  const a=structuredClone(artifact);if(status===undefined)delete a.result.manualApproval;else a.result.manualApproval={required:true,status};a.result.decision='block';a.result.deploymentAllowed=false;a.result.reasons=['No linked review.'];
  assert.throws(()=>inspectHistoricalReceipt(signed(a),key,undefined,review));
 }
});
test('signed references also require coherent historical review metadata and bounded fields',()=>{
 for(const mutate of [r=>r.organizationId=id(9),r=>r.projectId=id(9),r=>r.runId=id(9),r=>r.snapshotHash='c'.repeat(64),r=>r.resultHash='c'.repeat(64),r=>r.decision='rejected',r=>r.createdAt='2026-10-08T02:00:00.000Z',r=>r.createdAt='2026-10-08',r=>r.comment='x'.repeat(501),r=>r.extra=true,r=>r.actorId='bad']){
  const {artifact,review}=fixture();mutate(review);const {reviewHash,...payload}=review;review.reviewHash=hash(payload);artifact.result.manualApproval.reviewHash=review.reviewHash;
  assert.throws(()=>inspectHistoricalReceipt(signed(artifact),key,undefined,review));
 }
 const {artifact,review}=fixture();const otherKey=generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'});
 assert.throws(()=>inspectHistoricalReceipt(signed(artifact),otherKey,undefined,review));
 assert.throws(()=>inspectHistoricalReceipt(signed(artifact),key,{organizationId:id(9),projectId:id(3)},review));
});
