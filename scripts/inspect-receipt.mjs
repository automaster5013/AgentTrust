import {pathToFileURL} from 'node:url';
import {readReceiptFile} from './verify-receipt.mjs';
import {readTrustedReceiptKey} from './trusted-receipt-key.mjs';
import {inspectHistoricalReceipt} from '../packages/receipts/inspection.js';

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(process.argv.length!==4)throw new Error();
  const key=await readTrustedReceiptKey(process.argv[3]);
  console.log(JSON.stringify(inspectHistoricalReceipt(await readReceiptFile(process.argv[2]),key)));
 }catch{
  console.error('Historical receipt inspection failed. Provide a valid signed receipt and an independently trusted Ed25519 public key.');process.exitCode=2;
 }
}
