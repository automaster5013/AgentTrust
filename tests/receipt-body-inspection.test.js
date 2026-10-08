import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {ReceiptSigner} from '../packages/receipts/signature.js';
import {hash} from '../packages/contracts/hash.js';
import {inspectHistoricalReceipt} from '../packages/receipts/inspection.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const pair=generateKeyPairSync('ed25519'),key=pair.publicKey.export({type:'spki',format:'pem'}),signer=new ReceiptSigner(pair.privateKey.export({type:'pkcs8',format:'pem'}));
function fixture(baseline=false){
 const body=n=>{const run={id:id(n),organizationId:id(2),projectId:id(3),snapshot:{dataset:{private:'synthetic sensitive input'}},results:[{caseId:'synthetic',evidence:{output:'private synthetic output'}}],gate:{decision:'pass',deploymentAllowed:true}};return {...run,snapshotHash:hash(run.snapshot),resultHash:hash({results:run.results,gate:run.gate})};};
 const candidate=body(4),prior=body(5),ref=r=>({runId:r.id,snapshotHash:r.snapshotHash,resultHash:r.resultHash});
 const artifact={schemaVersion:1,receiptId:id(1),organizationId:id(2),projectId:id(3),checkedAt:'2026-10-08T01:00:00.000Z',request:{candidateRunId:id(4),...(baseline?{baselineRunId:id(5)}:{})},result:{runId:id(4),decision:'pass',deploymentAllowed:true,reasons:[],...(baseline?{comparison:{candidateRunId:id(4),baselineRunId:id(5),comparable:true,passRateDelta:0,changes:[],regressions:[],deploymentAllowed:true}}:{})},evidence:{candidate:ref(candidate),...(baseline?{baseline:ref(prior)}:{})}};
 return {artifact,bodies:{candidate,...(baseline?{baseline:prior}:{})}};
}
const signed=a=>({artifact:a,artifactHash:hash(a),signature:signer.sign(a)});
test('signed snapshot and result body verification grants no current release or metadata authority',()=>{
 for(const baseline of [false,true]){
  const {artifact,bodies}=fixture(baseline),summary=inspectHistoricalReceipt(signed(artifact),key,undefined,undefined,bodies);
  assert.equal(summary.evidenceBodiesVerified,true);assert.equal(summary.candidateEvidenceVerified,true);assert.equal(summary.baselineEvidenceVerified,baseline);assert.equal(summary.evidenceVerificationScope,'signed-snapshot-and-result-bodies');assert.equal(summary.evidenceMetadataAuthenticated,false);
  assert.equal(summary.deploymentAllowed,false);assert.equal(summary.currentReleasePermissionVerified,false);assert.equal(summary.reviewBodyVerified,false);
  assert.ok(!JSON.stringify(summary).includes('private synthetic'));assert.ok(!JSON.stringify(summary).includes('sensitive input'));
 }
 const {artifact}=fixture();assert.equal(inspectHistoricalReceipt(signed(artifact),key).evidenceBodiesVerified,false);
});
test('signed references refuse modified bodies even when export hashes are recomputed',()=>{
 for(const mutate of [r=>r.id=id(9),r=>r.organizationId=id(9),r=>r.projectId=id(9),r=>r.snapshot.dataset.private='changed',r=>r.results[0].evidence.output='changed',r=>r.gate.deploymentAllowed=false,r=>r.snapshotHash='c'.repeat(64),r=>r.resultHash='c'.repeat(64)]){
  for(const recompute of [false,true]){
   const {artifact,bodies}=fixture();mutate(bodies.candidate);if(recompute){bodies.candidate.snapshotHash=hash(bodies.candidate.snapshot);bodies.candidate.resultHash=hash({results:bodies.candidate.results,gate:bodies.candidate.gate});}
   // Changing only a redundant hash and then restoring it is an unchanged export.
   const original=fixture().bodies.candidate;if(hash(bodies.candidate)===hash(original))continue;
   assert.throws(()=>inspectHistoricalReceipt(signed(artifact),key,undefined,undefined,bodies));
  }
 }
});
test('requested baseline requires both bodies and rejects missing result hashes or unknown selections',()=>{
 const {artifact,bodies}=fixture(true),receipt=signed(artifact);
 for(const input of [{},{candidate:bodies.candidate},{baseline:bodies.baseline},{...bodies,extra:true},{candidate:bodies.baseline,baseline:bodies.candidate},null,[]])assert.throws(()=>inspectHistoricalReceipt(receipt,key,undefined,undefined,input));
 const single=fixture();assert.throws(()=>inspectHistoricalReceipt(signed(single.artifact),key,undefined,undefined,{...single.bodies,baseline:bodies.baseline}));
 single.artifact.result={runId:id(4),decision:'block',deploymentAllowed:false,reasons:['Evaluation incomplete.']};single.artifact.evidence.candidate.resultHash=null;
 assert.throws(()=>inspectHistoricalReceipt(signed(single.artifact),key,undefined,undefined,single.bodies));
 const bad=fixture();let cursor=bad.bodies.candidate;for(let i=0;i<65;i++){cursor.extra={};cursor=cursor.extra;}assert.throws(()=>inspectHistoricalReceipt(signed(bad.artifact),key,undefined,undefined,bad.bodies));
});
test('unsigned run annotations remain outside evidence authentication and inputs remain unchanged',()=>{
 const {artifact,bodies}=fixture();bodies.candidate.summary={passRate:99};bodies.candidate.state='untrusted';bodies.candidate.completedAt='untrusted';const before=structuredClone(bodies);
 const summary=inspectHistoricalReceipt(signed(artifact),key,undefined,undefined,bodies);assert.equal(summary.evidenceBodiesVerified,true);assert.equal(summary.evidenceMetadataAuthenticated,false);assert.deepEqual(bodies,before);assert.ok(!JSON.stringify(summary).includes('untrusted'));
});
