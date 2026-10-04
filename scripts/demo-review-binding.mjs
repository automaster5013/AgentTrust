import assert from 'node:assert/strict';
import {hash} from '../packages/contracts/hash.js';
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);

// The caller must first verify the receipt against an independently trusted key.
// This binds a historical review body to that receipt; current approval is separate.
export function assertDemoReviewBinding(review,receipt){
 const artifact=receipt.artifact,manual=artifact.result.manualApproval,{reviewHash,...payload}=review;
 assert.equal(Object.keys(payload).sort().join(','),'actorId,comment,createdAt,decision,id,organizationId,projectId,resultHash,runId,schemaVersion,snapshotHash');
 assert.equal(payload.schemaVersion,1);assert.ok(['id','organizationId','projectId','runId','actorId'].every(key=>uuid(payload[key])));
 assert.ok(sha(reviewHash)&&sha(payload.snapshotHash)&&sha(payload.resultHash));assert.equal(hash(payload),reviewHash);
 assert.equal(payload.id,manual.reviewId);assert.equal(reviewHash,manual.reviewHash);assert.equal(payload.organizationId,artifact.organizationId);assert.equal(payload.projectId,artifact.projectId);assert.equal(payload.runId,artifact.request.candidateRunId);
 assert.equal(payload.snapshotHash,artifact.evidence.candidate.snapshotHash);assert.equal(payload.resultHash,artifact.evidence.candidate.resultHash);
 assert.ok(['approved','rejected'].includes(payload.decision));assert.ok(['approved','rejected','expired','invalid'].includes(manual.status));
 if(['approved','expired'].includes(manual.status))assert.equal(payload.decision,'approved');if(manual.status==='rejected')assert.equal(payload.decision,'rejected');
 assert.equal(typeof payload.comment,'string');assert.ok(payload.comment.length<=500);
 assert.ok(Number.isFinite(Date.parse(payload.createdAt))&&new Date(payload.createdAt).toISOString()===payload.createdAt&&Date.parse(payload.createdAt)<=Date.parse(artifact.checkedAt));
 return {reviewBodyHashMatched:true,receiptReferenceMatched:true,historicalEvidenceOnly:true,currentReleasePermissionVerified:false};
}
