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
  artifact.result.decision='pass';await save();
  await assert.rejects(exec(process.execPath,['scripts/inspect-receipt.mjs',file,key]),error=>error.code===2&&!error.stdout&&error.stderr.includes('Historical receipt inspection failed.')&&!error.stderr.includes('sensitive synthetic')&&!error.stderr.includes(dir));
  artifact.result.decision='block';await save();await writeFile(key,pair.privateKey.export({type:'pkcs8',format:'pem'}));
  await assert.rejects(exec(process.execPath,['scripts/inspect-receipt.mjs',file,key]),error=>error.code===2&&!error.stdout&&!error.stderr.includes('PRIVATE KEY'));
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('inspection CLI rejects malformed input, missing files and argument misuse with safe errors',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'agenttrust-inspection-'));
 try{
  const key=join(dir,'trusted.pem'),file=join(dir,'receipt.json');await writeFile(key,generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'}));await writeFile(file,Buffer.from([34,255,34]));
  for(const args of [[],[file],[file,key,'extra'],[file,key],[join(dir,'missing.json'),key]])await assert.rejects(exec(process.execPath,['scripts/inspect-receipt.mjs',...args]),error=>error.code===2&&!error.stdout&&!error.stderr.includes(dir)&&error.stderr.includes('Historical receipt inspection failed.'));
 }finally{await rm(dir,{recursive:true,force:true});}
});
