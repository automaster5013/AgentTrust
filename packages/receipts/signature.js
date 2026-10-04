import { createPrivateKey,createPublicKey,sign,verify,createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { hash } from '../contracts/hash.js';

const message=artifactHash=>Buffer.from('AgentTrust release receipt v1\n'+artifactHash,'utf8');
function publicIdentity(key){
  const publicKey=createPublicKey(key);
  if(publicKey.asymmetricKeyType!=='ed25519')throw new Error('Receipt signing requires Ed25519.');
  const der=publicKey.export({type:'spki',format:'der'});
  return {publicKey,keyId:createHash('sha256').update(der).digest('hex')};
}
export function trustedReceiptKey(pem){
  try{
    if(typeof pem!=='string'||pem.length>1024||!/^[ \t\r\n]*-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----[ \t\r\n]*$/.test(pem))throw new Error();
    return publicIdentity(pem);
  }catch{throw new Error('A valid Ed25519 trusted public key is required.');}
}
export class ReceiptSigner{
  constructor(pem){
    this.privateKey=createPrivateKey(pem);const identity=publicIdentity(this.privateKey);
    this.publicKey=identity.publicKey;this.keyId=identity.keyId;
  }
  sign(artifact){return {algorithm:'Ed25519',keyId:this.keyId,value:sign(null,message(hash(artifact)),this.privateKey).toString('base64')};}
  publicMetadata(){return {algorithm:'Ed25519',keyId:this.keyId,publicKey:this.publicKey.export({type:'spki',format:'pem'})};}
}
export function loadReceiptSigner(path=process.env.AGENTTRUST_RECEIPT_SIGNING_KEY_FILE){
  return path?new ReceiptSigner(readFileSync(path,'utf8')):null;
}
export function verifyReceipt(receipt,trustedPem){
  const {artifact,artifactHash,signature}=receipt||{};
  if(!artifact||artifactHash!==hash(artifact)||signature?.algorithm!=='Ed25519'||typeof signature.value!=='string'||!/^[A-Za-z0-9+/]{86}==$/.test(signature.value))throw new Error('Invalid signed release receipt.');
  const {publicKey,keyId}=trustedReceiptKey(trustedPem);
  if(signature.keyId!==keyId||!verify(null,message(artifactHash),publicKey,Buffer.from(signature.value,'base64')))throw new Error('Receipt signature does not match the trusted key.');
  return {receiptId:artifact.receiptId,organizationId:artifact.organizationId,projectId:artifact.projectId,checkedAt:artifact.checkedAt,decision:artifact.result.decision,keyId,signatureVerified:true};
}
