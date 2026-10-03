import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { ReceiptSigner,verifyReceipt,loadReceiptSigner } from '../packages/receipts/signature.js';
import { hash } from '../packages/contracts/hash.js';

test('receipt signatures require an independently trusted key and bind the full artifact',()=>{
  const pair=generateKeyPairSync('ed25519'),signer=new ReceiptSigner(pair.privateKey.export({type:'pkcs8',format:'pem'}));
  const publicKey=pair.publicKey.export({type:'spki',format:'pem'}),artifact={schemaVersion:1,receiptId:'synthetic',organizationId:'tenant',projectId:'project',checkedAt:'2026-10-03T19:00:00Z',request:{candidateRunId:'candidate'},result:{decision:'pass',deploymentAllowed:true}};
  const receipt={artifact,artifactHash:hash(artifact),signature:signer.sign(artifact)};
  assert.equal(verifyReceipt(receipt,publicKey).signatureVerified,true);
  for(const field of ['organizationId','projectId','checkedAt','receiptId']){
    const changed={...artifact,[field]:'changed'};assert.throws(()=>verifyReceipt({...receipt,artifact:changed,artifactHash:hash(changed)},publicKey));
  }
  const changed={...artifact,result:{decision:'block',deploymentAllowed:false}};assert.throws(()=>verifyReceipt({...receipt,artifact:changed,artifactHash:hash(changed)},publicKey));
  assert.throws(()=>verifyReceipt(receipt,generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'})));
  assert.throws(()=>verifyReceipt({...receipt,signature:undefined},publicKey));
  assert.throws(()=>verifyReceipt({...receipt,signature:{...receipt.signature,value:'A'.repeat(86)+'=='}},publicKey));
  assert.throws(()=>verifyReceipt({...receipt,signature:{...receipt.signature,algorithm:'none'}},publicKey));
  assert.throws(()=>loadReceiptSigner('C:/AgentTrust/.local/missing-signing-key.pem'));
  assert.equal(loadReceiptSigner(''),null);
});
