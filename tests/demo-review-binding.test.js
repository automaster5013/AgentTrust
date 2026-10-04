import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {ReceiptSigner,verifyReceipt} from '../packages/receipts/signature.js';
import {hash} from '../packages/contracts/hash.js';
import {assertDemoReviewBinding} from '../scripts/demo-review-binding.mjs';
import {verifyPortfolioReceiptHistory} from '../scripts/portfolio-receipt-history.mjs';
const signer=new ReceiptSigner(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'pem'})),publicKey=signer.publicMetadata().publicKey;
function fixture(status='approved',runId=randomUUID(),scope){
 const organizationId=scope?.organizationId??randomUUID(),projectId=scope?.projectId??randomUUID(),payload={schemaVersion:1,id:randomUUID(),organizationId,projectId,runId,actorId:randomUUID(),decision:status==='rejected'?'rejected':'approved',comment:'Synthetic review',createdAt:'2026-10-04T23:00:00.000Z',snapshotHash:hash('snapshot'),resultHash:hash('result')},review={...payload,reviewHash:hash(payload)};
 const artifact={schemaVersion:1,receiptId:randomUUID(),organizationId,projectId,checkedAt:'2026-10-05T00:00:00.000Z',request:{candidateRunId:runId},result:{decision:['approved','none'].includes(status)?'pass':'block',...(status!=='none'?{manualApproval:{required:true,status,...(status!=='missing'?{reviewId:review.id,reviewHash:review.reviewHash}:{})}}:{})},evidence:{candidate:{runId,snapshotHash:payload.snapshotHash,resultHash:payload.resultHash}}};
 return {review,receipt:{artifact,artifactHash:hash(artifact),signature:signer.sign(artifact)}};
}

test('signed review references bind approved, rejected, expired and invalid historical states without granting permission',()=>{
 for(const status of ['approved','rejected','expired','invalid']){const f=fixture(status);assert.equal(verifyReceipt(f.receipt,publicKey).signatureVerified,true);const result=assertDemoReviewBinding(f.review,f.receipt);assert.equal(result.reviewBodyHashMatched,true);assert.equal(result.receiptReferenceMatched,true);assert.equal(result.historicalEvidenceOnly,true);assert.equal(result.currentReleasePermissionVerified,false);}
});

test('a correctly signed but unrelated review reference cannot authenticate a different review body',()=>{
 for(const field of ['organizationId','projectId','runId','snapshotHash','resultHash']){
  const f=fixture();if(field.endsWith('Hash'))f.receipt.artifact.evidence.candidate[field]=hash('unrelated');else if(field==='runId')f.receipt.artifact.request.candidateRunId=randomUUID();else f.receipt.artifact[field]=randomUUID();f.receipt.artifactHash=hash(f.receipt.artifact);f.receipt.signature=signer.sign(f.receipt.artifact);assert.equal(verifyReceipt(f.receipt,publicKey).signatureVerified,true);assert.throws(()=>assertDemoReviewBinding(f.review,f.receipt));
 }
 const first=fixture(),other=fixture();assert.throws(()=>assertDemoReviewBinding(other.review,first.receipt));
});

test('review body tampering and an opinion issued after the receipt are rejected',()=>{
 for(const mutate of [r=>{r.comment='changed';},r=>{r.actorId='invalid';},r=>{r.decision='rejected';},r=>{r.createdAt='2026-10-06T00:00:00.000Z';},r=>{r.privateExtra='private-review-canary';}]){const f=fixture();mutate(f.review);assert.throws(()=>assertDemoReviewBinding(f.review,f.receipt));}
});

test('an authentic future-dated opinion cannot be bound to an earlier signed release check',()=>{
 const f=fixture();f.review.createdAt='2026-10-06T00:00:00.000Z';const {reviewHash,...payload}=f.review;f.review.reviewHash=hash(payload);f.receipt.artifact.result.manualApproval.reviewHash=f.review.reviewHash;f.receipt.artifactHash=hash(f.receipt.artifact);f.receipt.signature=signer.sign(f.receipt.artifact);assert.equal(verifyReceipt(f.receipt,publicKey).signatureVerified,true);assert.throws(()=>assertDemoReviewBinding(f.review,f.receipt));
});

test('history verification retrieves original linked reviews after matching all six receipt records',async()=>{
 const runId=randomUUID(),scope={organizationId:randomUUID(),projectId:randomUUID()},parts=[fixture('none',randomUUID(),scope),fixture('none',randomUUID(),scope),fixture('none',randomUUID(),scope),fixture('missing',runId,scope),fixture('approved',runId,scope),fixture('rejected',runId,scope)],receipts=parts.map(part=>part.receipt),requests=[];
 const result=await verifyPortfolioReceiptHistory({receipts,call:async path=>{
  requests.push(path);const url=new URL(path,'http://127.0.0.1:4310');if(url.pathname.includes('/reviews/'))return parts.find(part=>url.pathname.endsWith(part.review.id)).review;
  const q=url.searchParams,items=receipts.filter(r=>r.artifact.request.candidateRunId===q.get('candidateRunId')&&(!q.has('decision')||r.artifact.result.decision===q.get('decision'))),index=Number(q.get('cursor')||0),r=items[index];
  return {items:r?[{id:r.artifact.receiptId,candidate_run_id:r.artifact.request.candidateRunId,baseline_run_id:null,decision:r.artifact.result.decision,artifact_hash:r.artifactHash,signing_key_id:r.signature.keyId,created_at:r.artifact.checkedAt}]:[],nextCursor:index+1<items.length?String(index+1):null};
 }});assert.equal(result.linkedReviewsVerified,2);assert.equal(result.linkedReviewQueries,2);assert.equal(requests.filter(path=>path.includes('/reviews/')).length,2);
});
