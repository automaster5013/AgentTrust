import assert from 'node:assert/strict';
import {open,mkdir,writeFile,opendir,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {verifyReceipt,trustedReceiptKey} from '../packages/receipts/signature.js';
import {receiptFileLimit} from '../packages/receipts/limits.js';

const names=['release_compliant','release_regression','release_missing_evidence','approval_required','approval_valid','approval_rejected'];
const allowed=[true,false,false,false,true,false];
const statuses=['not_required','not_required','not_required','missing','approved','rejected'];
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export const portfolioManifestLimit=65536;

export function verifyPortfolioEvidence(manifest,receipts,trustedPem){
  const key=trustedReceiptKey(trustedPem);
  assert.equal(manifest?.schemaVersion,1);assert.equal(manifest.synthetic,true);
  assert.equal(manifest.historicalEvidenceOnly,true);assert.equal(manifest.serverDeployed,false);
  assert.equal(typeof manifest.withBaselineComparison,'boolean');assert.equal(manifest.keyId,key.keyId);
  assert.ok(uuid(manifest.organizationId)&&uuid(manifest.projectId));
  assert.ok(Array.isArray(manifest.receipts)&&manifest.receipts.length===6);
  assert.ok(Array.isArray(receipts)&&receipts.length===6);
  const ids=new Set(),candidates=[],baselines=[];
  for(const [index,receipt] of receipts.entries()){
    const descriptor=manifest.receipts[index],artifact=receipt.artifact,result=artifact?.result,request=artifact?.request;
    assert.equal(verifyReceipt(receipt,trustedPem).signatureVerified,true);
    assert.equal(artifact.schemaVersion,1);assert.equal(artifact.organizationId,manifest.organizationId);assert.equal(artifact.projectId,manifest.projectId);
    assert.ok(Number.isFinite(Date.parse(artifact.checkedAt)));
    assert.ok(uuid(artifact.receiptId)&&!ids.has(artifact.receiptId));ids.add(artifact.receiptId);
    assert.equal(descriptor.file,`receipt-${index+1}.json`);assert.equal(descriptor.step,names[index]);
    assert.equal(descriptor.receiptId,artifact.receiptId);assert.equal(descriptor.artifactHash,receipt.artifactHash);
    assert.ok(sha(descriptor.sha256));assert.equal(descriptor.candidateRunId,request.candidateRunId);
    assert.ok(uuid(request.candidateRunId));assert.equal(result.runId,request.candidateRunId);
    assert.equal(result.deploymentAllowed,allowed[index]);assert.equal(result.decision,allowed[index]?'pass':'block');
    assert.equal(result.manualApproval?.status??'not_required',statuses[index]);
    if(index>=3)assert.equal(result.manualApproval.required,true);
    assert.ok(Array.isArray(result.reasons)&&result.reasons.every(reason=>typeof reason==='string'));
    assert.equal(result.reasons.length===0,allowed[index]);
    for(const version of ['agentVersionId','datasetVersionId','policyVersionId'])assert.ok(uuid(request[version]));
    const candidate=artifact.evidence?.candidate;
    assert.equal(candidate?.runId,request.candidateRunId);assert.ok(sha(candidate.snapshotHash)&&sha(candidate.resultHash));
    assert.equal(descriptor.snapshotHash,candidate.snapshotHash);assert.equal(descriptor.resultHash,candidate.resultHash);
    assert.equal(descriptor.baselineRunId,request.baselineRunId??null);
    if(manifest.withBaselineComparison){
      const baseline=artifact.evidence?.baseline,comparison=result.comparison;
      assert.ok(uuid(request.baselineRunId)&&request.baselineRunId!==request.candidateRunId);
      assert.equal(baseline?.runId,request.baselineRunId);assert.ok(sha(baseline.snapshotHash)&&sha(baseline.resultHash));
      assert.equal(comparison?.candidateRunId,request.candidateRunId);assert.equal(comparison.baselineRunId,request.baselineRunId);
      assert.equal(comparison.comparable,index!==2);assert.equal(comparison.evaluationPassed??comparison.deploymentAllowed,![1,2].includes(index));
      assert.ok(Array.isArray(comparison.regressions));
      if(index===1)assert.ok(comparison.regressions.length>0);
      if(![1,2].includes(index))assert.equal(comparison.regressions.length,0);
      baselines.push(request.baselineRunId);
    }else{assert.equal(request.baselineRunId,undefined);assert.equal(artifact.evidence.baseline,undefined);assert.equal(result.comparison,undefined);}
    candidates.push(request.candidateRunId);
  }
  assert.equal(new Set(candidates).size,4);assert.equal(new Set(candidates.slice(3)).size,1);
  assert.equal(new Set(receipts.slice(0,3).map(r=>r.artifact.request.policyVersionId)).size,1);
  assert.equal(new Set(receipts.slice(3).map(r=>r.artifact.request.policyVersionId)).size,1);
  assert.notEqual(receipts[0].artifact.request.policyVersionId,receipts[3].artifact.request.policyVersionId);
  assert.equal(new Set(receipts.map(r=>r.artifact.request.datasetVersionId)).size,1);
  for(const receipt of receipts.slice(4)){
    assert.deepEqual(receipt.artifact.evidence,receipts[3].artifact.evidence);
    assert.deepEqual(receipt.artifact.request,receipts[3].artifact.request);
  }
  if(manifest.withBaselineComparison){
    assert.equal(new Set(baselines.slice(0,3)).size,1);assert.equal(new Set(baselines.slice(3)).size,1);assert.equal(new Set(baselines).size,2);
    assert.ok(baselines.every(id=>!candidates.includes(id)));
    for(const group of [receipts.slice(0,3),receipts.slice(3)])for(const receipt of group.slice(1))assert.deepEqual(receipt.artifact.evidence.baseline,group[0].artifact.evidence.baseline);
  }
  return {bundleVerified:true,receipts:6,cryptographicSignaturesVerified:6,withBaselineComparison:manifest.withBaselineComparison,historicalEvidenceOnly:true,currentReleasePermissionVerified:false,serverDeployed:false};
}

export async function writePortfolioEvidence({receipts,report,trustedPem}){
  assert.equal(report.completed,true);assert.equal(report.cleanupSucceeded,true);assert.equal(report.sessionLoggedOut,true);
  const steps=report.steps.filter(step=>step.receiptId);assert.equal(steps.length,6);assert.equal(receipts.length,6);
  const files=receipts.map(receipt=>Buffer.from(JSON.stringify({artifact:receipt.artifact,artifactHash:receipt.artifactHash,signature:receipt.signature},null,2)+'\n'));
  assert.ok(files.every(bytes=>bytes.length<=receiptFileLimit));
  const manifest={schemaVersion:1,synthetic:true,historicalEvidenceOnly:true,serverDeployed:false,withBaselineComparison:report.withBaselineComparison,organizationId:receipts[0].artifact.organizationId,projectId:receipts[0].artifact.projectId,keyId:trustedReceiptKey(trustedPem).keyId,
    receipts:receipts.map((r,index)=>({file:`receipt-${index+1}.json`,step:steps[index].name,receiptId:steps[index].receiptId,artifactHash:r.artifactHash,candidateRunId:steps[index].runId,baselineRunId:steps[index].baselineRunId??null,snapshotHash:r.artifact.evidence.candidate.snapshotHash,resultHash:r.artifact.evidence.candidate.resultHash,sha256:digest(files[index])}))};
  verifyPortfolioEvidence(manifest,receipts,trustedPem);
  const bytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');assert.ok(bytes.length<=portfolioManifestLimit);
  const directory=join('.local','portfolio-evidence-'+randomUUID());await mkdir(directory,{mode:0o700});
  for(const [index,file] of files.entries())await writeFile(join(directory,`receipt-${index+1}.json`),file,{flag:'wx',mode:0o600});
  // Write the inventory last; a failed write leaves an incomplete, unverifiable directory.
  await writeFile(join(directory,'manifest.json'),bytes,{flag:'wx',mode:0o600});
  return {directory,manifestSha256:digest(bytes),receipts:6,historicalEvidenceOnly:true};
}

async function readBounded(path,limit){
  assert.ok((await lstat(path)).isFile());const file=await open(path,'r');
  try{
    assert.ok((await file.stat()).isFile());const bytes=Buffer.alloc(limit+1);let used=0;
    while(used<bytes.length){const {bytesRead}=await file.read(bytes,used,bytes.length-used,null);if(!bytesRead)break;used+=bytesRead;}
    assert.ok(used>0&&used<=limit);return bytes.subarray(0,used);
  }finally{await file.close();}
}
export async function readPortfolioEvidence(directory,trustedPem,expectedManifestSha256){
  if(expectedManifestSha256!==undefined)assert.ok(sha(expectedManifestSha256));
  const expected=new Set(['manifest.json',...Array.from({length:6},(_,index)=>`receipt-${index+1}.json`)]);
  assert.ok((await lstat(directory)).isDirectory());
  for await(const entry of await opendir(directory)){assert.ok(expected.has(entry.name)&&entry.isFile());expected.delete(entry.name);}
  assert.equal(expected.size,0);
  const bytes=await readBounded(join(directory,'manifest.json'),portfolioManifestLimit),manifestSha256=digest(bytes);
  if(expectedManifestSha256!==undefined)assert.equal(manifestSha256,expectedManifestSha256);
  const parse=value=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(value));
  const manifest=parse(bytes),receipts=[];
  assert.equal(manifest.keyId,trustedReceiptKey(trustedPem).keyId);
  assert.ok(Array.isArray(manifest.receipts)&&manifest.receipts.length===6);
  for(let index=0;index<6;index++){
    assert.equal(manifest.receipts[index].file,`receipt-${index+1}.json`);
    const file=await readBounded(join(directory,`receipt-${index+1}.json`),receiptFileLimit);
    assert.equal(digest(file),manifest.receipts[index].sha256);
    const receipt=parse(file);verifyReceipt(receipt,trustedPem);receipts.push(receipt);
  }
  return {...verifyPortfolioEvidence(manifest,receipts,trustedPem),manifestSha256,expectedManifestDigestMatched:expectedManifestSha256!==undefined};
}
