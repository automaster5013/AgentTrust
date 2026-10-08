import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {ReceiptSigner} from '../packages/receipts/signature.js';
import {hash} from '../packages/contracts/hash.js';
import {readInspectionReviewFile,inspectionReviewFileLimit} from '../scripts/inspect-receipt.mjs';
const exec=promisify(execFile),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('inspection CLI explains signed blocks without exposing raw reasons or granting permission',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'agenttrust-inspection-'));
 try{
  const pair=generateKeyPairSync('ed25519'),signer=new ReceiptSigner(pair.privateKey.export({type:'pkcs8',format:'pem'}));
  const artifact={schemaVersion:1,receiptId:id(1),organizationId:id(2),projectId:id(3),checkedAt:'2026-10-08T00:00:00.000Z',request:{candidateRunId:id(4)},result:{runId:id(4),decision:'block',deploymentAllowed:false,reasons:['sensitive synthetic explanation']},evidence:{candidate:{runId:id(4),snapshotHash:'a'.repeat(64),resultHash:'b'.repeat(64)}}};
  const file=join(dir,'receipt.json'),key=join(dir,'trusted.pem');
  const save=async()=>writeFile(file,JSON.stringify({artifact,artifactHash:hash(artifact),signature:signer.sign(artifact)}));
  await save();await writeFile(key,pair.publicKey.export({type:'spki',format:'pem'}));
  const output=await exec(process.execPath,['scripts/inspect-receipt.mjs',file,key]),result=JSON.parse(output.stdout);
  assert.equal(result.historicalDecision,'block');assert.equal(result.reasonCount,1);assert.equal(result.currentReleasePermissionVerified,false);assert.equal(result.deploymentAllowed,false);assert.ok(!output.stdout.includes('sensitive synthetic'));assert.equal(output.stderr,'');
  const selected=['--organization-id',id(2),'--project-id',id(3),'--candidate-run-id',id(4),'--baseline-run-id','none'];
  const scoped=JSON.parse((await exec(process.execPath,['scripts/inspect-receipt.mjs',file,key,...selected])).stdout);assert.equal(scoped.expectedScopeVerified,true);assert.equal(scoped.expectedCandidateVerified,true);assert.equal(scoped.expectedBaselineVerified,true);assert.equal(scoped.deploymentAllowed,false);
  for(const [index,value] of [[1,id(9)],[3,id(9)],[5,id(9)],[7,id(9)]]){const wrong=[...selected];wrong[index]=value;await assert.rejects(exec(process.execPath,['scripts/inspect-receipt.mjs',file,key,...wrong]),error=>error.code===2&&!error.stdout&&!error.stderr.includes('sensitive synthetic')&&!error.stderr.includes(dir));}
  artifact.result.decision='pass';await save();
  await assert.rejects(exec(process.execPath,['scripts/inspect-receipt.mjs',file,key]),error=>error.code===2&&!error.stdout&&error.stderr.includes('Historical receipt inspection failed.')&&!error.stderr.includes('sensitive synthetic')&&!error.stderr.includes(dir));
  artifact.result.decision='block';await save();await writeFile(key,pair.privateKey.export({type:'pkcs8',format:'pem'}));
  await assert.rejects(exec(process.execPath,['scripts/inspect-receipt.mjs',file,key]),error=>error.code===2&&!error.stdout&&!error.stderr.includes('PRIVATE KEY'));
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('inspection CLI verifies original opinion and refuses altered content with safe output',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'agenttrust-review-inspection-'));
 try{
  const pair=generateKeyPairSync('ed25519'),signer=new ReceiptSigner(pair.privateKey.export({type:'pkcs8',format:'pem'}));
  const payload={schemaVersion:1,id:id(5),organizationId:id(2),projectId:id(3),runId:id(4),actorId:id(6),decision:'approved',comment:'private synthetic opinion',createdAt:'2026-10-08T00:00:00.000Z',snapshotHash:'a'.repeat(64),resultHash:'b'.repeat(64)};
  const review={...payload,reviewHash:hash(payload)},artifact={schemaVersion:1,receiptId:id(1),organizationId:id(2),projectId:id(3),checkedAt:'2026-10-08T01:00:00.000Z',request:{candidateRunId:id(4)},result:{runId:id(4),decision:'pass',deploymentAllowed:true,reasons:[],manualApproval:{required:true,status:'approved',reviewId:review.id,reviewHash:review.reviewHash}},evidence:{candidate:{runId:id(4),snapshotHash:review.snapshotHash,resultHash:review.resultHash}}};
  const file=join(dir,'receipt.json'),key=join(dir,'trusted.pem'),opinion=join(dir,'review.json');
  await writeFile(file,JSON.stringify({artifact,artifactHash:hash(artifact),signature:signer.sign(artifact)}));await writeFile(key,pair.publicKey.export({type:'spki',format:'pem'}));await writeFile(opinion,JSON.stringify(review));
  const args=['scripts/inspect-receipt.mjs',file,key,'--review-file',opinion];
  const output=await exec(process.execPath,args),summary=JSON.parse(output.stdout);assert.equal(summary.reviewBodyVerified,true);assert.equal(summary.currentReviewerAuthorityVerified,false);assert.equal(summary.deploymentAllowed,false);assert.ok(!output.stdout.includes(payload.comment));assert.equal(output.stderr,'');
  for(const body of [JSON.stringify({...review,comment:'altered private synthetic opinion'}),'{invalid',Buffer.from([34,255,34]),' '.repeat(inspectionReviewFileLimit+1)]){
   await writeFile(opinion,body);await assert.rejects(exec(process.execPath,args),e=>e.code===2&&!e.stdout&&!e.stderr.includes(dir)&&!e.stderr.includes('private synthetic opinion'));
  }
  // An unauthenticated receipt is refused before attempting to open the review.
  await writeFile(file,JSON.stringify({artifact,artifactHash:hash(artifact),signature:signer.sign({...artifact,receiptId:id(9)})}));
  await assert.rejects(exec(process.execPath,['scripts/inspect-receipt.mjs',file,key,'--review-file',dir]),e=>e.code===2&&!e.stdout&&!e.stderr.includes(dir));
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('opinion reader enforces exact byte limit and strict UTF-8 independently of receipt size',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'agenttrust-review-limit-')),file=join(dir,'review.json');
 try{
  await writeFile(file,'"'+'x'.repeat(inspectionReviewFileLimit-2)+'"');assert.equal((await readInspectionReviewFile(file)).length,inspectionReviewFileLimit-2);
  await writeFile(file,'"'+'x'.repeat(inspectionReviewFileLimit-1)+'"');await assert.rejects(readInspectionReviewFile(file));
  await writeFile(file,Buffer.from([34,255,34]));await assert.rejects(readInspectionReviewFile(file));
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('inspection CLI rejects malformed input, missing files and argument misuse with safe errors',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'agenttrust-inspection-'));
 try{
  const key=join(dir,'trusted.pem'),file=join(dir,'receipt.json');await writeFile(key,generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'}));await writeFile(file,Buffer.from([34,255,34]));
  for(const args of [[],[file],[file,key,'extra'],[file,key],[join(dir,'missing.json'),key]])await assert.rejects(exec(process.execPath,['scripts/inspect-receipt.mjs',...args]),error=>error.code===2&&!error.stdout&&!error.stderr.includes(dir)&&error.stderr.includes('Historical receipt inspection failed.'));
 }finally{await rm(dir,{recursive:true,force:true});}
});
