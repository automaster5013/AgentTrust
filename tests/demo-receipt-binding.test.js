import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {ReceiptSigner,verifyReceipt} from '../packages/receipts/signature.js';
import {hash} from '../packages/contracts/hash.js';
import {assertDemoReceiptBinding} from '../scripts/demo-receipt-binding.mjs';

const {privateKey}=generateKeyPairSync('ed25519');
const signer=new ReceiptSigner(privateKey.export({type:'pkcs8',format:'pem'}));
const publicKey=signer.publicMetadata().publicKey;
function fixture(){
  const run={id:'candidate',snapshotHash:'snapshot',resultHash:'result'};
  const request={candidateRunId:run.id,agentVersionId:'agent',datasetVersionId:'dataset',policyVersionId:'policy'};
  const result={runId:run.id,decision:'pass',deploymentAllowed:true,reasons:[]};
  const artifact={receiptId:'synthetic',request:{...request},result:structuredClone(result),evidence:{candidate:{runId:run.id,snapshotHash:run.snapshotHash,resultHash:run.resultHash}}};
  return {run,request,receipt:{...result,artifact,artifactHash:hash(artifact),signature:signer.sign(artifact)}};
}
test('cryptographically valid but unrelated demo evidence is blocked independently of signature verification',()=>{
  for(const change of [a=>{a.request.candidateRunId='other';},a=>{a.evidence.candidate.resultHash='other';},a=>{a.request.baselineRunId='unrequested';}]){
    const {run,request,receipt}=fixture();change(receipt.artifact);
    receipt.artifactHash=hash(receipt.artifact);receipt.signature=signer.sign(receipt.artifact);
    assert.equal(verifyReceipt(receipt,publicKey).signatureVerified,true);
    assert.throws(()=>assertDemoReceiptBinding(receipt,request,run));
  }
});
test('unsigned response substitutions cannot change a verified demo decision or approval',()=>{
  const {run,request,receipt}=fixture();
  assertDemoReceiptBinding(receipt,request,run);
  receipt.manualApproval={status:'approved'};
  assert.equal(verifyReceipt(receipt,publicKey).signatureVerified,true);
  assert.throws(()=>assertDemoReceiptBinding(receipt,request,run));
});
