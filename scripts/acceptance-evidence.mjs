import assert from 'node:assert/strict';
import {open,lstat,opendir,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {hash} from '../packages/contracts/hash.js';
import {parseJson} from '../packages/contracts/json.js';
import {runIntegrity} from '../packages/evaluator/integrity.js';
import {compareRuns} from '../packages/evaluator/comparison.js';
import {verifyReceipt,trustedReceiptKey} from '../packages/receipts/signature.js';
import {receiptFileLimit} from '../packages/receipts/limits.js';
import {validateAcceptanceProfile,acceptanceModes} from './acceptance-profile.mjs';
import {assertDemoReviewBinding} from './demo-review-binding.mjs';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const steps=['approval_required','approval_valid','approval_rejected','release_regression','release_forbidden_tool','release_missing_evidence','release_error'];
const fileNames=['profile.json',...Array.from({length:6},(_,i)=>'run-'+(i+1)+'.json'),...Array.from({length:7},(_,i)=>'receipt-'+(i+1)+'.json'),'review-1.json','review-2.json'];
export function verifyAcceptanceEvidence({manifest,profile,runs,receipts,reviews,trustedPem}){
 assert.equal(Object.keys(manifest).sort().join(','),'files,historicalEvidenceOnly,keyId,organizationId,profileHash,projectId,purpose,schemaVersion,serverDeployed,steps,synthetic');assert.equal(hash(manifest.steps),hash(steps));assert.ok(Array.isArray(manifest.files)&&manifest.files.length===fileNames.length);for(const [i,row] of manifest.files.entries()){assert.equal(Object.keys(row).sort().join(','),'bytes,file,sha256');assert.equal(row.file,fileNames[i]);assert.ok(sha(row.sha256)&&Number.isSafeInteger(row.bytes)&&row.bytes>0&&row.bytes<=(i===0||i>=14?65536:receiptFileLimit));}assert.ok(manifest.files.reduce((n,x)=>n+x.bytes,0)<=64*1024*1024);assert.equal(manifest.schemaVersion,1);assert.equal(manifest.purpose,'synthetic-acceptance-evidence');assert.equal(manifest.synthetic,true);assert.equal(manifest.historicalEvidenceOnly,true);assert.equal(manifest.serverDeployed,false);assert.equal(manifest.keyId,trustedReceiptKey(trustedPem).keyId);assert.ok(uuid(manifest.organizationId)&&uuid(manifest.projectId));assert.equal(manifest.profileHash,hash(validateAcceptanceProfile(profile)));assert.ok(Array.isArray(runs)&&runs.length===6&&Array.isArray(receipts)&&receipts.length===7&&Array.isArray(reviews)&&reviews.length===2);
 const modeOrder=['compliant',...acceptanceModes.map(x=>x[0])],runIds=new Set();
 for(const [i,run] of runs.entries()){
  assert.ok(uuid(run.id)&&!runIds.has(run.id));runIds.add(run.id);assert.equal(run.organizationId,manifest.organizationId);assert.equal(run.projectId,manifest.projectId);assert.equal(runIntegrity(run),true);assert.equal(run.snapshot.agent.mode,modeOrder[i]);assert.equal(run.snapshot.dataset.contentHash,hash(profile.dataset));assert.equal(run.snapshot.policy.contentHash,hash(profile.policy));assert.equal(run.datasetVersionId,runs[0].datasetVersionId);assert.equal(run.policyVersionId,runs[0].policyVersionId);
  const expected=acceptanceModes.find(x=>x[0]===modeOrder[i]);assert.equal(run.state,expected[1]);assert.equal(run.gate.decision,expected[2]);assert.equal(run.gate.deploymentAllowed,false);
 }
 const receiptIds=new Set(),linked=new Map();
 for(const [i,receipt] of receipts.entries()){
  assert.equal(verifyReceipt(receipt,trustedPem).signatureVerified,true);const a=receipt.artifact,r=a.result,c=runs[i<3?1:i-1],baseline=runs[0];assert.equal(a.schemaVersion,1);assert.ok(uuid(a.receiptId)&&!receiptIds.has(a.receiptId));receiptIds.add(a.receiptId);assert.equal(a.organizationId,manifest.organizationId);assert.equal(a.projectId,manifest.projectId);assert.ok(Number.isFinite(Date.parse(a.checkedAt)));
  assert.equal(a.request.candidateRunId,c.id);assert.equal(a.request.baselineRunId,baseline.id);for(const kind of ['agent','dataset','policy'])assert.equal(a.request[kind+'VersionId'],c[kind+'VersionId']);for(const [name,run] of [['candidate',c],['baseline',baseline]]){assert.equal(a.evidence[name].runId,run.id);assert.equal(a.evidence[name].snapshotHash,run.snapshotHash);assert.equal(a.evidence[name].resultHash,run.resultHash);}
  assert.equal(r.runId,c.id);assert.equal(r.deploymentAllowed,i===1);assert.equal(r.decision,i===1?'pass':'block');assert.equal(hash(r.comparison),hash(compareRuns(baseline,c)));assert.equal(r.manualApproval.required,true);assert.equal(r.manualApproval.status,['missing','approved','rejected','missing','missing','missing','missing'][i]);assert.ok(Array.isArray(r.reasons)&&r.reasons.every(x=>typeof x==='string'));assert.equal(r.reasons.length===0,i===1);
  if(i===1||i===2){assert.ok(uuid(r.manualApproval.reviewId)&&sha(r.manualApproval.reviewHash));linked.set(r.manualApproval.reviewId,receipt);}else{assert.equal(r.manualApproval.reviewId,undefined);assert.equal(r.manualApproval.reviewHash,undefined);}
 }
 const reviewIds=new Set();for(const [i,review] of reviews.entries()){assert.ok(linked.has(review.id)&&!reviewIds.has(review.id));reviewIds.add(review.id);assert.equal(review.decision,i===0?'approved':'rejected');assertDemoReviewBinding(review,linked.get(review.id));}
 return {schemaVersion:1,purpose:'synthetic-acceptance-evidence-verification',status:'passed',synthetic:true,criteriaBoundToSignedRunEvidence:true,runIntegrityVerified:6,cryptographicSignaturesVerified:7,linkedReviewsVerified:2,historicalEvidenceOnly:true,currentReleasePermissionVerified:false,serverDeployed:false};
}
export async function writeAcceptanceEvidence({profile,runs,receipts,reviews,report,trustedPem}){
 assert.equal(report.completed,true);assert.equal(report.cleanupSucceeded,true);assert.equal(report.sessionLoggedOut,true);
 const values=[profile,...runs,...receipts.map(r=>({artifact:r.artifact,artifactHash:r.artifactHash,signature:r.signature})),...reviews],files=values.map(v=>Buffer.from(JSON.stringify(v,null,2)+'\n'));
 assert.equal(files.length,fileNames.length);assert.ok(files.every((bytes,i)=>bytes.length>0&&bytes.length<=(i===0||i>=14?65536:receiptFileLimit)));assert.ok(files.reduce((n,x)=>n+x.length,0)<=64*1024*1024);
 const manifest={schemaVersion:1,purpose:'synthetic-acceptance-evidence',synthetic:true,historicalEvidenceOnly:true,serverDeployed:false,organizationId:receipts[0].artifact.organizationId,projectId:receipts[0].artifact.projectId,keyId:trustedReceiptKey(trustedPem).keyId,profileHash:hash(profile),steps,files:fileNames.map((file,i)=>({file,bytes:files[i].length,sha256:digest(files[i])}))};verifyAcceptanceEvidence({manifest,profile,runs,receipts,reviews,trustedPem});
 const bytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');assert.ok(bytes.length<=65536);const directory=join('.local','acceptance-evidence-'+randomUUID());await mkdir(directory,{mode:0o700});for(let i=0;i<files.length;i++)await writeFile(join(directory,fileNames[i]),files[i],{flag:'wx',mode:0o600});await writeFile(join(directory,'manifest.json'),bytes,{flag:'wx',mode:0o600});return {directory,manifestSha256:digest(bytes),historicalEvidenceOnly:true,currentReleasePermissionVerified:false};
}
async function readBounded(path,limit){assert.ok((await lstat(path)).isFile());const f=await open(path,'r');try{const stat=await f.stat();assert.ok(stat.isFile()&&Number.isSafeInteger(stat.size)&&stat.size>0&&stat.size<=limit);const bytes=Buffer.alloc(stat.size+1);let used=0;while(used<bytes.length){const r=await f.read(bytes,used,bytes.length-used,null);if(!r.bytesRead)break;used+=r.bytesRead;}assert.equal(used,stat.size);return bytes.subarray(0,used);}finally{await f.close();}}
export async function readAcceptanceEvidence(directory,trustedPem,expectedManifestSha256){
 assert.ok(sha(expectedManifestSha256));assert.ok((await lstat(directory)).isDirectory());const bytes=await readBounded(join(directory,'manifest.json'),65536);assert.equal(digest(bytes),expectedManifestSha256);const manifest=parseJson(bytes);assert.equal(hash(manifest.steps),hash(steps));assert.ok(Array.isArray(manifest.files)&&manifest.files.length===fileNames.length);
 const expected=new Set(['manifest.json',...fileNames]);for await(const entry of await opendir(directory)){assert.ok(expected.has(entry.name)&&entry.isFile());expected.delete(entry.name);}assert.equal(expected.size,0);
 const values=[];let total=0;for(let i=0;i<fileNames.length;i++){const row=manifest.files[i];assert.equal(Object.keys(row).sort().join(','),'bytes,file,sha256');assert.equal(row.file,fileNames[i]);assert.ok(sha(row.sha256));assert.ok(Number.isSafeInteger(row.bytes)&&row.bytes>0);const limit=i===0||i>=14?65536:receiptFileLimit;assert.ok(row.bytes<=limit);total+=row.bytes;assert.ok(total<=64*1024*1024);const file=await readBounded(join(directory,fileNames[i]),Math.min(limit,row.bytes));assert.equal(file.length,row.bytes);assert.equal(digest(file),row.sha256);values.push(parseJson(file));}
 return {...verifyAcceptanceEvidence({manifest,profile:values[0],runs:values.slice(1,7),receipts:values.slice(7,14),reviews:values.slice(14),trustedPem}),expectedManifestDigestMatched:true,manifestSha256:expectedManifestSha256};
}
