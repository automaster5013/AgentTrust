import {pathToFileURL} from 'node:url';
import {createReadStream} from 'node:fs';
import {readReceiptFile} from './verify-receipt.mjs';
import {readTrustedReceiptKey} from './trusted-receipt-key.mjs';
import {inspectHistoricalReceipt,normalizeReceiptExpectation} from '../packages/receipts/inspection.js';

export function parseReceiptInspectionArguments(args){
 if(!Array.isArray(args)||args.length<2||args.length>12||args.some(value=>typeof value!=='string'||!value)||args.length%2!==0)throw new Error('Invalid inspection arguments.');
 const [receiptFile,trustedKeyFile,...options]=args,fields={'--organization-id':'organizationId','--project-id':'projectId','--candidate-run-id':'candidateRunId','--baseline-run-id':'baselineRunId'},expected={};
 let reviewFile;
 for(let i=0;i<options.length;i+=2){
  if(options[i]==='--review-file'){if(reviewFile!==undefined)throw new Error('Duplicate review file.');reviewFile=options[i+1];continue;}
  const flag=options[i],value=options[i+1];if(!Object.hasOwn(fields,flag)||Object.hasOwn(expected,fields[flag]))throw new Error('Invalid inspection options.');
  expected[fields[flag]]=flag==='--baseline-run-id'&&value==='none'?null:value;
 }
 return {receiptFile,trustedKeyFile,expected:normalizeReceiptExpectation(Object.keys(expected).length?expected:undefined),...(reviewFile!==undefined?{reviewFile}:{})};
}

export const inspectionReviewFileLimit=65536;
export async function readInspectionReviewFile(path){
 const chunks=[];let bytes=0;
 for await(const chunk of createReadStream(path)){
  bytes+=chunk.length;if(bytes>inspectionReviewFileLimit)throw new Error('Review exceeds inspection limit.');chunks.push(chunk);
 }
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,bytes)));
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const {receiptFile,trustedKeyFile,expected,reviewFile}=parseReceiptInspectionArguments(process.argv.slice(2));
  const key=await readTrustedReceiptKey(trustedKeyFile);
  const receipt=await readReceiptFile(receiptFile);
  const summary=inspectHistoricalReceipt(receipt,key,expected);
  console.log(JSON.stringify(reviewFile===undefined?summary:inspectHistoricalReceipt(receipt,key,expected,await readInspectionReviewFile(reviewFile))));
 }catch{
  console.error('Historical receipt inspection failed. Provide a valid signed receipt and an independently trusted Ed25519 public key.');process.exitCode=2;
 }
}
