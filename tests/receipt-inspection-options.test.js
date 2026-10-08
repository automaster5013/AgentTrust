import test from 'node:test';
import assert from 'node:assert/strict';
import {parseReceiptInspectionArguments} from '../scripts/inspect-receipt.mjs';
const id='abcdef01-2345-4000-8000-000000000001';
test('offline receipt scope options require tenant pair and explicit candidate for baseline',()=>{
 const base=['receipt.json','trusted.pem'];assert.deepEqual(parseReceiptInspectionArguments(base),{receiptFile:base[0],trustedKeyFile:base[1],expected:undefined});
 const scope=['--organization-id',id.toUpperCase(),'--project-id',id];
 assert.deepEqual(parseReceiptInspectionArguments([...base,...scope,'--candidate-run-id',id,'--baseline-run-id','none']).expected,{organizationId:id,projectId:id,candidateRunId:id,baselineRunId:null});
 assert.equal(parseReceiptInspectionArguments([...base,...scope,'--candidate-run-id',id,'--baseline-run-id',id]).expected.baselineRunId,id);
});
test('scope option parsing fails closed on ambiguous incomplete unknown and malformed input',()=>{
 const base=['receipt.json','trusted.pem'],scope=['--organization-id',id,'--project-id',id];
 for(const args of [[],['receipt.json'],['','key'],[...base,'extra'],[...base,'--unknown',id],[...base,'--organization-id',id],[...base,'--candidate-run-id',id],[...base,...scope,'--baseline-run-id','none'],[...base,...scope,'--project-id',id],[...base,...scope,'--candidate-run-id'],[...base,...scope,'--candidate-run-id','bad'],[...base,...scope,'--candidate-run-id',id,'--baseline-run-id','NONE'],[...base,...scope,'--candidate-run-id',id,'--baseline-run-id',''],[...base,'--organization-id','bad','--project-id',id]])assert.throws(()=>parseReceiptInspectionArguments(args));
});
test('linked opinion file combines with optional scope and rejects duplicate or incomplete flags',()=>{
 const base=['receipt.json','trusted.pem'];
 assert.deepEqual(parseReceiptInspectionArguments([...base,'--review-file','review.json']),{receiptFile:base[0],trustedKeyFile:base[1],expected:undefined,reviewFile:'review.json'});
 const all=[...base,'--organization-id',id,'--project-id',id,'--candidate-run-id',id,'--baseline-run-id','none','--review-file','review.json'];
 assert.equal(parseReceiptInspectionArguments(all).reviewFile,'review.json');assert.equal(parseReceiptInspectionArguments(all).expected.baselineRunId,null);
 for(const options of [['--review-file'],['--review-file',''],['--review-file','a','--review-file','b'],['--review-file','a','--organization-id',id]])assert.throws(()=>parseReceiptInspectionArguments([...base,...options]));
});
