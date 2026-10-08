import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {hash} from '../packages/contracts/hash.js';
import {evaluate} from '../packages/evaluator/index.js';
import {compareRuns} from '../packages/evaluator/comparison.js';
import {ReceiptSigner} from '../packages/receipts/signature.js';
import {inspectHistoricalReceipt} from '../packages/receipts/inspection.js';
import {parseReceiptInspectionArguments} from '../scripts/inspect-receipt.mjs';
const exec=promisify(execFile),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const pair=generateKeyPairSync('ed25519'),key=pair.publicKey.export({type:'spki',format:'pem'}),signer=new ReceiptSigner(pair.privateKey.export({type:'pkcs8',format:'pem'}));
function fixture(withBaseline=false,mode='compliant',manual=false){
 const version=(n,data)=>({id:id(n),contentHash:hash(data),createdAt:'2026-10-08T00:00:00.000Z',...data});
 const body=(n,mode)=>{
  const snapshot={agent:version(n+10,{name:'Synthetic agent',mode}),dataset:version(20,{name:'Synthetic criteria',cases:[{id:'case',input:'private-structure-input',mock:{output:'refund private-structure-output',toolEvents:[]},rules:[{id:'required',type:'contains',value:'refund'}]}]}),policy:version(21,{name:'Synthetic policy',minimumPassRate:1,...(manual?{requiresManualApproval:true}:{})})};
  const run={id:id(n),organizationId:id(2),projectId:id(3),snapshot,snapshotHash:hash(snapshot),agentVersionId:snapshot.agent.id,datasetVersionId:snapshot.dataset.id,policyVersionId:snapshot.policy.id,...evaluate(snapshot)};run.resultHash=hash({results:run.results,gate:run.gate});return run;
 };
 const candidate=body(4,mode),baseline=body(5,'compliant'),comparison=withBaseline?compareRuns(baseline,candidate):undefined;
 const allowed=candidate.gate.deploymentAllowed&&(!comparison||comparison.deploymentAllowed),artifact={schemaVersion:1,receiptId:id(1),organizationId:id(2),projectId:id(3),checkedAt:'2026-10-08T01:00:00.000Z',request:{candidateRunId:id(4),agentVersionId:candidate.agentVersionId,datasetVersionId:candidate.datasetVersionId,policyVersionId:candidate.policyVersionId,...(withBaseline?{baselineRunId:id(5)}:{})},result:{runId:id(4),decision:allowed?'pass':'block',deploymentAllowed:allowed,reasons:allowed?[]:['private-structure-reason'],...(comparison?{comparison}:{}),...(manual?{manualApproval:{required:true,status:'missing'}}:{})},evidence:{}};
 const bodies={candidate,...(withBaseline?{baseline}:{})};
 const resign=()=>{for(const [name,run] of Object.entries(bodies)){run.snapshotHash=hash(run.snapshot);run.resultHash=hash({results:run.results,gate:run.gate});artifact.evidence[name]={runId:run.id,snapshotHash:run.snapshotHash,resultHash:run.resultHash};}return {artifact,artifactHash:hash(artifact),signature:signer.sign(artifact)};};
 return {artifact,bodies,resign,receipt:resign()};
}
const inspect=(f,strict=true)=>inspectHistoricalReceipt(f.receipt,key,undefined,undefined,f.bodies,strict);

test('authenticated body structure uses only signed data and never authenticates unsigned run annotations',()=>{
 for(const baseline of [false,true]){
  const f=fixture(baseline);for(const body of Object.values(f.bodies)){body.summary={passRate:99};body.state='forged-state';body.agentVersionId=id(99);body.datasetVersionId=id(99);body.policyVersionId=id(99);body.completedAt='forged-time';}
  const before=structuredClone(f.bodies),summary=inspect(f);assert.equal(summary.evidenceStructuresVerified,true);assert.equal(summary.baselineEvidenceStructureVerified,baseline);assert.equal(summary.unsignedMetadataUsedForStructure,false);assert.equal(summary.rulesRecheckedFromRecordedEvidence,true);assert.equal(summary.agentReexecuted,false);assert.equal(summary.evidenceMetadataAuthenticated,false);assert.equal(summary.deploymentAllowed,false);assert.equal(summary.currentReleasePermissionVerified,false);assert.equal(JSON.stringify(summary).includes('private-structure'),false);assert.equal(JSON.stringify(summary).includes('forged-'),false);assert.deepEqual(f.bodies,before);
  assert.equal(inspect(f,false).evidenceStructuresVerified,false);
 }
});

test('signed body hashes alone cannot disguise contradictory versions rules coverage or gates in strict inspection',()=>{
 for(const mutate of [f=>{f.bodies.candidate.snapshot.dataset.contentHash='f'.repeat(64);},f=>{f.bodies.candidate.results[0].rules[0].status='fail';},f=>{f.bodies.candidate.results[0].input='substituted';},f=>{f.bodies.candidate.results=[];},f=>{f.bodies.candidate.gate.deploymentAllowed=false;},f=>{f.artifact.request.agentVersionId=id(99);},f=>{f.bodies.candidate.snapshot.policy.requiresManualApproval=true;f.bodies.candidate.snapshot.policy.contentHash=hash({name:'Synthetic policy',minimumPassRate:1,requiresManualApproval:true});}]){
  const f=fixture();mutate(f);f.receipt=f.resign();assert.equal(inspect(f,false).evidenceBodiesVerified,true);assert.throws(()=>inspect(f));
 }
});

test('strict inspection cross-checks the signed historical comparison against the two authenticated bodies',()=>{
 const f=fixture(true);f.artifact.result.comparison.passRateDelta=0.5;f.receipt=f.resign();assert.equal(inspect(f,false).evidenceBodiesVerified,true);assert.throws(()=>inspect(f));
 const valid=fixture(true,'regression');const summary=inspect(valid);assert.equal(summary.historicalDecision,'block');assert.equal(summary.comparison.regressions,1);assert.equal(summary.evidenceStructuresVerified,true);
});

test('consistent recorded failure missing evidence and pending approval retain historical denial',()=>{
 for(const mode of ['error','missing_evidence','regression']){
  const f=fixture(true,mode),summary=inspect(f);assert.equal(summary.historicalDecision,'block');assert.equal(summary.evidenceStructuresVerified,true);assert.equal(summary.deploymentAllowed,false);
 }
 const manual=fixture(true,'compliant',true),summary=inspect(manual);assert.equal(summary.manualApprovalStatus,'missing');assert.equal(summary.evidenceStructuresVerified,true);assert.equal(summary.deploymentAllowed,false);
 for(const value of [null,1,'true',{},[]])assert.throws(()=>inspectHistoricalReceipt(manual.receipt,key,undefined,undefined,manual.bodies,value));
 assert.throws(()=>inspectHistoricalReceipt(manual.receipt,key,undefined,undefined,undefined,true));
});

test('the structure flag requires body files and composes with every existing receipt option',()=>{
 const base=['receipt','key'],all=['--organization-id',id(2),'--project-id',id(3),'--candidate-run-id',id(4),'--baseline-run-id',id(5),'--review-file','review','--candidate-evidence-file','candidate','--baseline-evidence-file','baseline'];
 assert.equal(parseReceiptInspectionArguments([...base,...all,'--check-evidence-structure']).checkEvidenceStructure,true);assert.equal(parseReceiptInspectionArguments([...base,'--check-evidence-structure',...all]).checkEvidenceStructure,true);
 for(const args of [[...base,'--check-evidence-structure'],[...base,'--candidate-evidence-file','candidate','--check-evidence-structure','--check-evidence-structure'],[...base,'--candidate-evidence-file','candidate','--check-evidence-structure','true'],[...base,'--check-evidence-structure','--candidate-evidence-file']])assert.throws(()=>parseReceiptInspectionArguments(args));
});

test('actual structure CLI redacts original evidence and rejects signed contradictions without partial output',async t=>{
 const dir=await mkdtemp(join(resolve('.local'),'receipt-structure-cli-test-'));t.after(async()=>{assert.ok(resolve(dir).startsWith(resolve('.local')+sep));await rm(dir,{recursive:true,force:true});});
 const f=fixture(true),receipt=join(dir,'receipt.json'),candidate=join(dir,'candidate.json'),baseline=join(dir,'baseline.json'),trusted=join(dir,'trusted.pem');await writeFile(trusted,key);
 const save=async()=>{await writeFile(receipt,JSON.stringify(f.receipt));await writeFile(candidate,JSON.stringify(f.bodies.candidate));await writeFile(baseline,JSON.stringify(f.bodies.baseline));};await save();
 const args=[receipt,trusted,'--candidate-evidence-file',candidate,'--baseline-evidence-file',baseline,'--check-evidence-structure'];
 const result=await exec(process.execPath,['scripts/inspect-receipt.mjs',...args],{windowsHide:true,timeout:15000});assert.equal(JSON.parse(result.stdout).evidenceStructuresVerified,true);assert.equal(result.stdout.includes('private-structure'),false);
 f.artifact.result.comparison.passRateDelta=0.5;f.receipt=f.resign();await save();const original=await readFile(receipt);
 await assert.rejects(exec(process.execPath,['scripts/inspect-receipt.mjs',...args],{windowsHide:true,timeout:15000}),e=>e.code===2&&!e.stdout&&!e.stderr.includes('private-structure'));assert.deepEqual(await readFile(receipt),original);
});
