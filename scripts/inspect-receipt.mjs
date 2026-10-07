import {pathToFileURL} from 'node:url';
import {readReceiptFile} from './verify-receipt.mjs';
import {readTrustedReceiptKey} from './trusted-receipt-key.mjs';
import {inspectHistoricalReceipt,normalizeReceiptExpectation} from '../packages/receipts/inspection.js';

export function parseReceiptInspectionArguments(args){
 if(!Array.isArray(args)||args.length<2||args.length>10||args.some(value=>typeof value!=='string'||!value)||args.length%2!==0)throw new Error('Invalid inspection arguments.');
 const [receiptFile,trustedKeyFile,...options]=args,fields={'--organization-id':'organizationId','--project-id':'projectId','--candidate-run-id':'candidateRunId','--baseline-run-id':'baselineRunId'},expected={};
 for(let i=0;i<options.length;i+=2){
  const flag=options[i],value=options[i+1];if(!Object.hasOwn(fields,flag)||Object.hasOwn(expected,fields[flag]))throw new Error('Invalid inspection options.');
  expected[fields[flag]]=flag==='--baseline-run-id'&&value==='none'?null:value;
 }
 return {receiptFile,trustedKeyFile,expected:normalizeReceiptExpectation(options.length?expected:undefined)};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const {receiptFile,trustedKeyFile,expected}=parseReceiptInspectionArguments(process.argv.slice(2));
  const key=await readTrustedReceiptKey(trustedKeyFile);
  console.log(JSON.stringify(inspectHistoricalReceipt(await readReceiptFile(receiptFile),key,expected)));
 }catch{
  console.error('Historical receipt inspection failed. Provide a valid signed receipt and an independently trusted Ed25519 public key.');process.exitCode=2;
 }
}
