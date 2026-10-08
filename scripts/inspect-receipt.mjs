import {pathToFileURL} from 'node:url';
import {createReadStream} from 'node:fs';
import {readReceiptFile} from './verify-receipt.mjs';
import {readTrustedReceiptKey} from './trusted-receipt-key.mjs';
import {inspectHistoricalReceipt,normalizeReceiptExpectation} from '../packages/receipts/inspection.js';

export function parseReceiptInspectionArguments(args){
 if(!Array.isArray(args)||args.length<2||args.length>16||args.some(value=>typeof value!=='string'||!value)||args.length%2!==0)throw new Error('Invalid inspection arguments.');
 const [receiptFile,trustedKeyFile,...options]=args,fields={'--organization-id':'organizationId','--project-id':'projectId','--candidate-run-id':'candidateRunId','--baseline-run-id':'baselineRunId'},expected={};
 let reviewFile;
 const bodyFiles={},bodyFlags={'--candidate-evidence-file':'candidateEvidenceFile','--baseline-evidence-file':'baselineEvidenceFile'};
 for(let i=0;i<options.length;i+=2){
  if(options[i]==='--review-file'){if(reviewFile!==undefined)throw new Error('Duplicate review file.');reviewFile=options[i+1];continue;}
  if(Object.hasOwn(bodyFlags,options[i])){const field=bodyFlags[options[i]];if(Object.hasOwn(bodyFiles,field))throw new Error('Duplicate evidence file.');bodyFiles[field]=options[i+1];continue;}
  const flag=options[i],value=options[i+1];if(!Object.hasOwn(fields,flag)||Object.hasOwn(expected,fields[flag]))throw new Error('Invalid inspection options.');
  expected[fields[flag]]=flag==='--baseline-run-id'&&value==='none'?null:value;
 }
 if(bodyFiles.baselineEvidenceFile!==undefined&&bodyFiles.candidateEvidenceFile===undefined)throw new Error('Candidate evidence is required.');
 return {receiptFile,trustedKeyFile,expected:normalizeReceiptExpectation(Object.keys(expected).length?expected:undefined),...(reviewFile!==undefined?{reviewFile}:{}),...bodyFiles};
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
  const {receiptFile,trustedKeyFile,expected,reviewFile,candidateEvidenceFile,baselineEvidenceFile}=parseReceiptInspectionArguments(process.argv.slice(2));
  const key=await readTrustedReceiptKey(trustedKeyFile);
  const receipt=await readReceiptFile(receiptFile);
  const summary=inspectHistoricalReceipt(receipt,key,expected);
  if(candidateEvidenceFile!==undefined&&(receipt.artifact.request.baselineRunId!==undefined)!==(baselineEvidenceFile!==undefined))throw new Error('Evidence selection does not match receipt.');
  const review=reviewFile===undefined?undefined:await readInspectionReviewFile(reviewFile);
  const bodies=candidateEvidenceFile===undefined?undefined:{candidate:await readReceiptFile(candidateEvidenceFile),...(baselineEvidenceFile!==undefined?{baseline:await readReceiptFile(baselineEvidenceFile)}:{})};
  console.log(JSON.stringify(review===undefined&&bodies===undefined?summary:inspectHistoricalReceipt(receipt,key,expected,review,bodies)));
 }catch{
  console.error('Historical receipt inspection failed. Provide a valid signed receipt and an independently trusted Ed25519 public key.');process.exitCode=2;
 }
}
