import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { ReceiptSigner,verifyReceipt,loadReceiptSigner,trustedReceiptKey } from '../packages/receipts/signature.js';
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

test('trusted receipt keys accept only Ed25519 public SPKI PEM without deriving private keys',()=>{
 const pair=generateKeyPairSync('ed25519'),privatePem=pair.privateKey.export({type:'pkcs8',format:'pem'}),signer=new ReceiptSigner(privatePem);
 const artifact={result:{decision:'pass'}},receipt={artifact,artifactHash:hash(artifact),signature:signer.sign(artifact)};
 const publicPem=pair.publicKey.export({type:'spki',format:'pem'});
 assert.equal(verifyReceipt(receipt,'\n'+publicPem+'\n').signatureVerified,true);
 for(const key of [privatePem,'',undefined,publicPem.replace('PUBLIC KEY','PRIVATE KEY'),'-----BEGIN PUBLIC KEY-----\ninvalid\n-----END PUBLIC KEY-----',generateKeyPairSync('ec',{namedCurve:'prime256v1'}).publicKey.export({type:'spki',format:'pem'}),pair.publicKey]){
  assert.throws(()=>trustedReceiptKey(key),/valid Ed25519 trusted public key/);
  assert.throws(()=>verifyReceipt(receipt,key),/valid Ed25519 trusted public key/);
 }
});
