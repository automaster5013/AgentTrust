import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { verifyReceipt } from '../packages/receipts/signature.js';

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    if(process.argv.length!==4)throw new Error('Expected receipt JSON and trusted public key paths.');
    const receiptText=await readFile(process.argv[2],'utf8');
    if(Buffer.byteLength(receiptText)>524288)throw new Error('Receipt exceeds the verification size limit.');
    const result=verifyReceipt(JSON.parse(receiptText),await readFile(process.argv[3],'utf8'));
    console.log(JSON.stringify({...result,historicalEvidenceOnly:true}));
  }catch{console.error('Signed receipt verification failed. Supply a trusted Ed25519 public key and unmodified receipt.');process.exitCode=2;}
}
