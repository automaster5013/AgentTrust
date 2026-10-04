import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID,createHash} from 'node:crypto';
import {readFile,writeFile,rm,mkdtemp,mkdir} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {ReceiptSigner,verifyReceipt} from '../packages/receipts/signature.js';
import {hash} from '../packages/contracts/hash.js';
import {writePortfolioEvidence,readPortfolioEvidence,verifyPortfolioEvidence,portfolioManifestLimit} from '../scripts/portfolio-evidence.mjs';
const exec=promisify(execFile),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function fixture(compare=false){
  const signer=new ReceiptSigner(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'pem'}));
  const trustedPem=signer.publicMetadata().publicKey,org=randomUUID(),project=randomUUID(),dataset=randomUUID(),policies=[randomUUID(),randomUUID()],candidates=Array.from({length:4},()=>randomUUID()),agents=Array.from({length:3},()=>randomUUID()),baselines=[randomUUID(),randomUUID()];
  const names=['release_compliant','release_regression','release_missing_evidence','approval_required','approval_valid','approval_rejected'];
  const receipts=names.map((name,index)=>{
    const group=index<3?0:1,candidate=candidates[Math.min(index,3)],allowed=[true,false,false,false,true,false][index];
    const request={candidateRunId:candidate,agentVersionId:agents[index<3?index:0],datasetVersionId:dataset,policyVersionId:policies[group],...(compare?{baselineRunId:baselines[group]}:{})};
    const result={runId:candidate,decision:allowed?'pass':'block',deploymentAllowed:allowed,reasons:allowed?[]:['Synthetic block'],...(index>=3?{manualApproval:{required:true,status:['missing','approved','rejected'][index-3]}}:{}),...(compare?{comparison:{baselineRunId:baselines[group],candidateRunId:candidate,comparable:index!==2,evaluationPassed:![1,2].includes(index),regressions:[1,2].includes(index)?[{caseId:'synthetic',ruleId:'required'}]:[]}}:{})};
    const artifact={schemaVersion:1,receiptId:randomUUID(),organizationId:org,projectId:project,checkedAt:'2026-10-05T00:00:00Z',request,result,evidence:{candidate:{runId:candidate,snapshotHash:hash(candidate),resultHash:hash('result-'+candidate)},...(compare?{baseline:{runId:baselines[group],snapshotHash:hash(baselines[group]),resultHash:hash('result-'+baselines[group])}}:{})}};
    return {artifact,artifactHash:hash(artifact),signature:signer.sign(artifact)};
  });
  const report={completed:true,cleanupSucceeded:true,sessionLoggedOut:true,withBaselineComparison:compare,steps:receipts.map((r,index)=>({name:names[index],receiptId:r.artifact.receiptId,runId:r.artifact.request.candidateRunId,...(compare?{baselineRunId:r.artifact.request.baselineRunId}:{})}))};
  return {receipts,report,trustedPem,signer};
}
async function bundle(t,compare=false){
  const f=fixture(compare),written=await writePortfolioEvidence(f);
  t.after(async()=>{assert.ok(resolve(written.directory).startsWith(resolve('.local')+sep));await rm(written.directory,{recursive:true,force:true});});
  const {receipts:count,...output}=written;assert.equal(count,6);
  return {...f,...output,manifest:JSON.parse(await readFile(join(written.directory,'manifest.json'),'utf8'))};
}
test('completed default and comparison demos export six independently signed receipts and pin their inventory digest',async t=>{
  for(const compare of [false,true]){
    const f=await bundle(t,compare),verified=await readPortfolioEvidence(f.directory,f.trustedPem,f.manifestSha256);
    assert.equal(verified.bundleVerified,true);assert.equal(verified.cryptographicSignaturesVerified,6);assert.equal(verified.withBaselineComparison,compare);assert.equal(verified.manifestDigestIndependentlyExpected,true);assert.equal(verified.currentReleasePermissionVerified,false);
    assert.equal((await readPortfolioEvidence(f.directory,f.trustedPem)).manifestDigestIndependentlyExpected,false);
  }
});
test('uncompleted scenarios, failed cleanup or logout and mismatched scenario steps cannot publish a bundle',async()=>{
  for(const field of ['completed','cleanupSucceeded','sessionLoggedOut']){const f=fixture();f.report[field]=false;await assert.rejects(writePortfolioEvidence(f));}
  const f=fixture();f.report.steps[0].runId=randomUUID();await assert.rejects(writePortfolioEvidence(f));
});
test('wrong keys, corrupt receipt bytes and a changed independently expected manifest are rejected',async t=>{
  const f=await bundle(t),other=fixture();await assert.rejects(readPortfolioEvidence(f.directory,other.trustedPem));
  await assert.rejects(readPortfolioEvidence(f.directory,f.trustedPem,'f'.repeat(64)));
  await writeFile(join(f.directory,'receipt-1.json'),JSON.stringify({...f.receipts[0],artifactHash:'f'.repeat(64)}));await assert.rejects(readPortfolioEvidence(f.directory,f.trustedPem));
});
test('valid signatures cannot substitute a different organization, decision sequence or approval evidence',async t=>{
  for(const mutate of [r=>{r[0].artifact.organizationId=randomUUID();},r=>{r[1].artifact.result.decision='pass';r[1].artifact.result.deploymentAllowed=true;r[1].artifact.result.reasons=[];},r=>{r[4].artifact.evidence.candidate.resultHash='f'.repeat(64);},r=>{r[4].artifact.request.agentVersionId=randomUUID();},r=>{r[3].artifact.result.manualApproval.required=false;}]){
    const f=await bundle(t,true);mutate(f.receipts);
    for(const r of f.receipts){r.artifactHash=hash(r.artifact);r.signature=f.signer.sign(r.artifact);assert.equal(verifyReceipt(r,f.trustedPem).signatureVerified,true);}
    for(const [i,r] of f.receipts.entries()){f.manifest.receipts[i].artifactHash=r.artifactHash;f.manifest.receipts[i].resultHash=r.artifact.evidence.candidate.resultHash;}
    assert.throws(()=>verifyPortfolioEvidence(f.manifest,f.receipts,f.trustedPem));
  }
});
test('inventory paths, incomplete directories and unexpected files are rejected before accepting an export',async t=>{
  const f=await bundle(t);f.manifest.receipts[0].file='../credentials.json';await writeFile(join(f.directory,'manifest.json'),JSON.stringify(f.manifest));await assert.rejects(readPortfolioEvidence(f.directory,f.trustedPem));
  const g=await bundle(t);await rm(join(g.directory,'receipt-6.json'));await assert.rejects(readPortfolioEvidence(g.directory,g.trustedPem));
  const h=await bundle(t);await writeFile(join(h.directory,'unexpected.txt'),'Synthetic');await assert.rejects(readPortfolioEvidence(h.directory,h.trustedPem));
  const j=await bundle(t);await mkdir(join(j.directory,'unexpected-directory'));await assert.rejects(readPortfolioEvidence(j.directory,j.trustedPem));
});
test('manifest byte limits and malformed UTF-8 are enforced before parsing',async t=>{
  const f=await bundle(t);await writeFile(join(f.directory,'manifest.json'),' '.repeat(portfolioManifestLimit+1));await assert.rejects(readPortfolioEvidence(f.directory,f.trustedPem));
  await writeFile(join(f.directory,'manifest.json'),Buffer.from([255]));await assert.rejects(readPortfolioEvidence(f.directory,f.trustedPem),TypeError);
});
test('offline evidence CLI verifies six signatures without API access and emits only a generic failure for tampering',async t=>{
  const f=await bundle(t,true),dir=await mkdtemp(join(resolve('.local'),'portfolio-evidence-cli-test-')),key=join(dir,'public.pem');
  t.after(async()=>{assert.ok(resolve(dir).startsWith(resolve('.local')+sep));await rm(dir,{recursive:true,force:true});});await writeFile(key,f.trustedPem);
  const result=await exec(process.execPath,['scripts/verify-portfolio-evidence.mjs',f.directory,key,f.manifestSha256],{timeout:10000,windowsHide:true});
  assert.equal(JSON.parse(result.stdout).bundleVerified,true);
  const bad={...f.manifest,privateCanary:'never-print-this-input'};await writeFile(join(f.directory,'manifest.json'),JSON.stringify(bad));
  await assert.rejects(exec(process.execPath,['scripts/verify-portfolio-evidence.mjs',f.directory,key,f.manifestSha256]),error=>error.code===2&&!error.stdout&&!error.stderr.includes(bad.privateCanary));
  for(const args of [[],[f.directory,key,'bad-sha'],[f.directory,key,f.manifestSha256,'extra']])await assert.rejects(exec(process.execPath,['scripts/verify-portfolio-evidence.mjs',...args]),error=>error.code===2&&!error.stdout);
});
