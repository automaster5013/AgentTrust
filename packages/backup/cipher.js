import { createCipheriv,createDecipheriv,randomBytes } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { canonical } from '../contracts/hash.js';

const algorithm='aes-256-gcm';
function validKey(key){if(!Buffer.isBuffer(key)||key.length!==32)throw new Error('Backup key must contain 32 bytes.');}
export async function encryptBackup(input,output,key,metadata){
  validKey(key);
  const nonce=randomBytes(12),cipher=createCipheriv(algorithm,key,nonce,{authTagLength:16});
  cipher.setAAD(Buffer.from(JSON.stringify(canonical(metadata)),'utf8'));
  await pipeline(input,cipher,output);
  return {algorithm,nonce:nonce.toString('hex'),tag:cipher.getAuthTag().toString('hex')};
}
export async function decryptBackup(input,output,key,metadata,encryption){
  validKey(key);
  if(encryption?.algorithm!==algorithm||!/^\w{24}$/.test(encryption.nonce)||!/^\w{32}$/.test(encryption.tag)||
    !/^[a-f0-9]+$/.test(encryption.nonce+encryption.tag))throw new Error('Invalid backup encryption metadata.');
  const decipher=createDecipheriv(algorithm,key,Buffer.from(encryption.nonce,'hex'),{authTagLength:16});
  decipher.setAAD(Buffer.from(JSON.stringify(canonical(metadata)),'utf8'));
  decipher.setAuthTag(Buffer.from(encryption.tag,'hex'));
  // Callers must discard output on failure and never restore before this resolves.
  await pipeline(input,decipher,output);
}
