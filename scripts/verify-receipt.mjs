import {readTrustedReceiptKey} from './trusted-receipt-key.mjs';
import { createReadStream } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { verifyReceipt } from '../packages/receipts/signature.js';
import { receiptFileLimit } from '../packages/receipts/limits.js';
export { receiptFileLimit } from '../packages/receipts/limits.js';

// Pretty-printed exports may be larger than the 8 MiB API response.
export async function readReceiptFile(path){
  const chunks=[];let bytes=0;
  for await(const chunk of createReadStream(path)){
    bytes+=chunk.length;
    if(bytes>receiptFileLimit)throw new Error('Receipt exceeds the verification size limit.');
    chunks.push(chunk);
  }
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,bytes)));
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    if(process.argv.length!==4)throw new Error('Expected receipt JSON and trusted public key paths.');
    const trustedKey=await readTrustedReceiptKey(process.argv[3]);
    const result=verifyReceipt(await readReceiptFile(process.argv[2]),trustedKey);
    console.log(JSON.stringify({...result,historicalEvidenceOnly:true}));
  }catch{console.error('Signed receipt verification failed. Supply a trusted Ed25519 public key and unmodified receipt.');process.exitCode=2;}
}
