import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {ReceiptSigner,verifyReceipt} from '../packages/receipts/signature.js';
import {hash} from '../packages/contracts/hash.js';
import {inspectHistoricalReceipt} from '../packages/receipts/inspection.js';

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const pair=generateKeyPairSync('ed25519'),key=pair.publicKey.export({type:'spki',format:'pem'}),signer=new ReceiptSigner(pair.privateKey.export({type:'pkcs8',format:'pem'}));
function artifact(){return {schemaVersion:1,receiptId:id(1),organizationId:id(2),projectId:id(3),checkedAt:'2026-10-08T00:00:00.000Z',request:{candidateRunId:id(4)},result:{runId:id(4),decision:'pass',deploymentAllowed:true,reasons:[]},evidence:{candidate:{runId:id(4),snapshotHash:'a'.repeat(64),resultHash:'b'.repeat(64)}}};}
const signed=a=>({artifact:a,artifactHash:hash(a),signature:signer.sign(a)});
test('offline inspection authenticates historical pass without granting current deployment',()=>{
 const summary=inspectHistoricalReceipt(signed(artifact()),key);
 assert.equal(summary.historicalDecision,'pass');assert.equal(summary.deploymentAllowed,false);assert.equal(summary.currentReleasePermissionVerified,false);assert.equal(summary.signatureVerified,true);assert.equal(summary.historicalEvidenceOnly,true);assert.equal(summary.evidenceBodiesVerified,false);
});
test('valid signatures cannot disguise contradictory release result or duplicate wrapper fields',()=>{
 for(const change of [a=>a.result.decision='block',a=>a.result.reasons=['secret raw explanation'],a=>a.result.runId=id(9),a=>a.evidence.candidate.runId=id(9),a=>a.evidence.candidate.resultHash='bad',a=>a.schemaVersion=2,a=>a.checkedAt='tomorrow']){
  const a=artifact();change(a);const receipt=signed(a);assert.equal(verifyReceipt(receipt,key).signatureVerified,true);assert.throws(()=>inspectHistoricalReceipt(receipt,key));
 }
 assert.throws(()=>inspectHistoricalReceipt({...signed(artifact()),deploymentAllowed:false},key));
});
test('manual approvals and baseline evidence are historical, bounded and internally consistent',()=>{
 const a=artifact();a.result.manualApproval={required:true,status:'approved',reviewId:id(7),reviewHash:'c'.repeat(64)};
 a.request.baselineRunId=id(5);a.evidence.baseline={runId:id(5),snapshotHash:'d'.repeat(64),resultHash:'e'.repeat(64)};
 a.result.comparison={candidateRunId:id(4),baselineRunId:id(5),comparable:true,passRateDelta:0,changes:[],regressions:[],requiresManualApproval:true,evaluationPassed:true,deploymentAllowed:false};
 const summary=inspectHistoricalReceipt(signed(a),key);assert.equal(summary.manualApprovalStatus,'approved');assert.equal(summary.reviewBodyVerified,false);assert.equal(summary.comparison.regressions,0);
 for(const mutate of [b=>b.result.manualApproval.status='rejected',b=>b.result.manualApproval.reviewHash=undefined,b=>b.result.comparison.requiresManualApproval=false,b=>b.result.comparison.baselineRunId=id(8),b=>b.evidence.baseline.runId=id(8),b=>b.result.comparison.passRateDelta=2,b=>b.result.comparison.changes=[{caseId:'c',ruleId:'r',before:'pass',after:'fail'}]]){const b=structuredClone(a);mutate(b);assert.throws(()=>inspectHistoricalReceipt(signed(b),key));}
});
test('blocked receipt summarizes counts without echoing reasons or rule identities',()=>{
 const a=artifact();a.result={runId:id(4),decision:'block',deploymentAllowed:false,reasons:['private customer detail']};
 const summary=inspectHistoricalReceipt(signed(a),key);assert.equal(summary.reasonCount,1);assert.equal(summary.historicalDecision,'block');assert.ok(!JSON.stringify(summary).includes('private customer'));
 a.result.reasons=[];assert.throws(()=>inspectHistoricalReceipt(signed(a),key));a.result.reasons=Array(65).fill('x');assert.throws(()=>inspectHistoricalReceipt(signed(a),key));
});
test('inspection rejects untrusted keys, tampered bodies and excessive nested input before hashing',()=>{
 const receipt=signed(artifact());assert.throws(()=>inspectHistoricalReceipt(receipt,generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'})));
 receipt.artifact.result.decision='block';assert.throws(()=>inspectHistoricalReceipt(receipt,key));
 const a=artifact();let cursor=a;for(let i=0;i<65;i++){cursor.extra={};cursor=cursor.extra;}assert.throws(()=>inspectHistoricalReceipt({artifact:a},key));
});
