import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {generateKeyPairSync} from 'node:crypto';
import {ReceiptSigner} from '../packages/receipts/signature.js';
import {hash} from '../packages/contracts/hash.js';
import {readReceiptFile,receiptFileLimit} from '../scripts/verify-receipt.mjs';

const exec=promisify(execFile);
test('offline CLI refuses a matching signing private key as its trusted public key',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'agenttrust-receipt-'));
 try{
  const pair=generateKeyPairSync('ed25519'),privatePem=pair.privateKey.export({type:'pkcs8',format:'pem'}),signer=new ReceiptSigner(privatePem);
  const artifact={result:{decision:'pass'}},receipt={artifact,artifactHash:hash(artifact),signature:signer.sign(artifact)};
  const file=join(dir,'receipt.json'),key=join(dir,'synthetic-key.pem');
  await writeFile(file,JSON.stringify(receipt));await writeFile(key,privatePem,{mode:0o600});
  await assert.rejects(exec(process.execPath,['scripts/verify-receipt.mjs',file,key]),error=>error.code===2&&!error.stdout&&error.stderr.includes('Signed receipt verification failed.')&&!error.stderr.includes(privatePem));
  await writeFile(key,pair.publicKey.export({type:'spki',format:'pem'}));
  const result=await exec(process.execPath,['scripts/verify-receipt.mjs',file,key]);assert.equal(JSON.parse(result.stdout).signatureVerified,true);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('offline CLI verifies large exported receipts and rejects tampering',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'agenttrust-receipt-'));
 try{
  const pair=generateKeyPairSync('ed25519'),signer=new ReceiptSigner(pair.privateKey.export({type:'pkcs8',format:'pem'}));
  const artifact={receiptId:'synthetic',organizationId:'synthetic',projectId:'synthetic',result:{decision:'block',evidence:'합성'.repeat(100000)}};
  const receipt={artifact,artifactHash:hash(artifact),signature:signer.sign(artifact)};
  const file=join(dir,'receipt.json'),key=join(dir,'public.pem');
  await writeFile(file,JSON.stringify(receipt,null,2));await writeFile(key,pair.publicKey.export({type:'spki',format:'pem'}));
  const result=await exec(process.execPath,['scripts/verify-receipt.mjs',file,key]);
  assert.equal(JSON.parse(result.stdout).signatureVerified,true);assert.equal(JSON.parse(result.stdout).historicalEvidenceOnly,true);
  receipt.artifact.result.decision='pass';await writeFile(file,JSON.stringify(receipt));
  await assert.rejects(exec(process.execPath,['scripts/verify-receipt.mjs',file,key]),error=>error.code===2&&!error.stdout&&error.stderr.includes('Signed receipt verification failed.'));
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('receipt file reader enforces byte boundary before JSON parsing',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'agenttrust-receipt-')),file=join(dir,'receipt.json');
 try{
  await writeFile(file,'0'+' '.repeat(receiptFileLimit-1));assert.equal(await readReceiptFile(file),0);
  await writeFile(file,'0'+' '.repeat(receiptFileLimit));await assert.rejects(readReceiptFile(file),/size limit/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('receipt file reader rejects malformed UTF-8, JSON and missing files',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'agenttrust-receipt-')),file=join(dir,'receipt.json');
 try{
  await writeFile(file,Buffer.from([34,255,34]));await assert.rejects(readReceiptFile(file),TypeError);
  await writeFile(file,'invalid JSON');await assert.rejects(readReceiptFile(file),SyntaxError);
  await assert.rejects(readReceiptFile(join(dir,'missing.json')),error=>error.code==='ENOENT');
 }finally{await rm(dir,{recursive:true,force:true});}
});
