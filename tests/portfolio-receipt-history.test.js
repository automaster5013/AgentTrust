import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyPortfolioReceiptHistory} from '../scripts/portfolio-receipt-history.mjs';
const candidates=Array.from({length:4},(_,i)=>'00000000-0000-0000-0000-'+String(i+1).padStart(12,'0'));
function fixture(){
 const receipts=Array.from({length:6},(_,i)=>({artifact:{receiptId:'receipt-'+i,checkedAt:'2026-10-05T00:00:00Z',request:{candidateRunId:candidates[Math.min(i,3)]},result:{decision:[true,false,false,false,true,false][i]?'pass':'block'}},artifactHash:'hash-'+i,signature:{keyId:'trusted-key'}}));
 const requests=[];
 const call=async path=>{requests.push(path);const q=new URL(path,'http://127.0.0.1:4310').searchParams,items=receipts.filter(r=>r.artifact.request.candidateRunId===q.get('candidateRunId')&&(!q.has('decision')||r.artifact.result.decision===q.get('decision')));const index=Number(q.get('cursor')||0),r=items[index];return {items:r?[{id:r.artifact.receiptId,candidate_run_id:r.artifact.request.candidateRunId,baseline_run_id:null,decision:r.artifact.result.decision,artifact_hash:r.artifactHash,signing_key_id:r.signature.keyId,created_at:r.artifact.checkedAt}]:[],nextCursor:index+1<items.length?String(index+1):null};};
 return {receipts,requests,call};
}
test('history verification follows bounded pages for each candidate and decision and matches the original six records',async()=>{
 const f=fixture(),result=await verifyPortfolioReceiptHistory(f);assert.equal(result.receiptHistoryVerified,true);assert.equal(result.receiptHistoryRecordsMatched,6);assert.equal(result.receiptHistoryCandidates,4);assert.equal(result.readOnlyHistoryQueries,true);assert.equal(result.receiptHistoryQueries,f.requests.length);assert.equal(f.requests.length,15);assert.ok(f.requests.every(path=>path.startsWith('/v1/release-receipts?')));
});
test('history verification rejects foreign records, altered hashes, incorrect decisions and leaked full evidence',async()=>{
 for(const mutate of [row=>{row.id='foreign';},row=>{row.artifact_hash='altered';},row=>{row.decision='block';},row=>{row.snapshot={private:'canary'};},row=>{row.signing_key_id='other';},row=>{row.candidate_run_id=candidates[1];}]){
  const f=fixture();await assert.rejects(verifyPortfolioReceiptHistory({...f,call:async path=>{const page=await f.call(path);if(page.items.length)mutate(page.items[0]);return page;}}));assert.equal(f.requests.length,1);
 }
});
test('history verification rejects a repeated row instead of treating it as another page',async()=>{
 const f=fixture();let firstRow;await assert.rejects(verifyPortfolioReceiptHistory({...f,call:async path=>{const page=await f.call(path);if(path.includes(candidates[3])&&!path.includes('decision=')){firstRow??=page.items[0];return {...page,items:[firstRow]};}return page;}}));
});
test('history verification stops before following unexpected or excessive page cursors',async()=>{
 for(const nextCursor of ['//untrusted.example','a'.repeat(513),'1']){
  const f=fixture();await assert.rejects(verifyPortfolioReceiptHistory({...f,call:async path=>{const page=await f.call(path);return {...page,nextCursor};}}));assert.equal(f.requests.length,1);
 }
});
