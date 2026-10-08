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
const exec=promisify(execFile),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function setup(dir,baseline){
 const pair=generateKeyPairSync('ed25519'),signer=new ReceiptSigner(pair.privateKey.export({type:'pkcs8',format:'pem'}));
 const body=n=>{const run={id:id(n),organizationId:id(2),projectId:id(3),snapshot:{private:'synthetic private snapshot'},results:[{private:'synthetic private output'}],gate:{decision:'pass',deploymentAllowed:true}};return {...run,snapshotHash:hash(run.snapshot),resultHash:hash({results:run.results,gate:run.gate})};};
 const candidate=body(4),prior=body(5),reference=r=>({runId:r.id,snapshotHash:r.snapshotHash,resultHash:r.resultHash});
 const artifact={schemaVersion:1,receiptId:id(1),organizationId:id(2),projectId:id(3),checkedAt:'2026-10-08T01:00:00.000Z',request:{candidateRunId:id(4),...(baseline?{baselineRunId:id(5)}:{})},result:{runId:id(4),decision:'pass',deploymentAllowed:true,reasons:[],...(baseline?{comparison:{candidateRunId:id(4),baselineRunId:id(5),comparable:true,passRateDelta:0,changes:[],regressions:[],deploymentAllowed:true}}:{})},evidence:{candidate:reference(candidate),...(baseline?{baseline:reference(prior)}:{})}};
 const file=join(dir,'receipt.json'),key=join(dir,'trusted.pem'),candidateFile=join(dir,'candidate.json'),baselineFile=join(dir,'baseline.json');
 await writeFile(key,pair.publicKey.export({type:'spki',format:'pem'}));await writeFile(file,JSON.stringify({artifact,artifactHash:hash(artifact),signature:signer.sign(artifact)}));await writeFile(candidateFile,JSON.stringify(candidate));await writeFile(baselineFile,JSON.stringify(prior));
 return {file,key,candidateFile,baselineFile,candidate,artifact,signer};
}
test('actual inspection CLI authenticates paired evidence without publishing sensitive bodies',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'agenttrust-body-cli-'));
 try{
  for(const baseline of [false,true]){
   const f=await setup(dir,baseline),args=['scripts/inspect-receipt.mjs',f.file,f.key,'--candidate-evidence-file',f.candidateFile,...(baseline?['--baseline-evidence-file',f.baselineFile]:[])];
   const output=await exec(process.execPath,args),summary=JSON.parse(output.stdout);assert.equal(summary.evidenceBodiesVerified,true);assert.equal(summary.baselineEvidenceVerified,baseline);assert.equal(summary.evidenceMetadataAuthenticated,false);assert.equal(summary.deploymentAllowed,false);assert.ok(!output.stdout.includes('synthetic private'));assert.equal(output.stderr,'');
   const changed={...f.candidate,results:[{private:'altered synthetic private output'}]};changed.resultHash=hash({results:changed.results,gate:changed.gate});await writeFile(f.candidateFile,JSON.stringify(changed));
   await assert.rejects(exec(process.execPath,args),e=>e.code===2&&!e.stdout&&!e.stderr.includes(dir)&&!e.stderr.includes('synthetic private'));
  }
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('actual body CLI refuses incomplete selection malformed input and unauthenticated receipts',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'agenttrust-body-failure-'));
 try{
  const f=await setup(dir,true),base=['scripts/inspect-receipt.mjs',f.file,f.key];
  for(const options of [['--candidate-evidence-file',f.candidateFile],['--baseline-evidence-file',f.baselineFile],['--candidate-evidence-file',f.candidateFile,'--baseline-evidence-file',join(dir,'missing.json')]])await assert.rejects(exec(process.execPath,[...base,...options]),e=>e.code===2&&!e.stdout&&!e.stderr.includes(dir));
  const args=[...base,'--candidate-evidence-file',f.candidateFile,'--baseline-evidence-file',f.baselineFile];
  for(const body of ['{invalid',Buffer.from([34,255,34]),'null']){await writeFile(f.candidateFile,body);await assert.rejects(exec(process.execPath,args),e=>e.code===2&&!e.stdout&&!e.stderr.includes(dir));}
  f.artifact.organizationId=id(9);await writeFile(f.file,JSON.stringify({artifact:f.artifact,artifactHash:hash(f.artifact),signature:f.signer.sign({...f.artifact,organizationId:id(2)})}));
  await assert.rejects(exec(process.execPath,[...base,'--candidate-evidence-file',dir,'--baseline-evidence-file',dir]),e=>e.code===2&&!e.stdout&&!e.stderr.includes(dir));
 }finally{await rm(dir,{recursive:true,force:true});}
});
