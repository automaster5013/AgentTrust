import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {generateKeyPairSync} from 'node:crypto';
import {hash} from '../packages/contracts/hash.js';
import {ReceiptSigner,verifyReceipt} from '../packages/receipts/signature.js';
const id='00000000-0000-0000-0000-000000000123';
async function fixture(work){
 const dir=await mkdtemp(join(process.cwd(),'.local','cli-process-')),pair=generateKeyPairSync('ed25519'),signer=new ReceiptSigner(pair.privateKey.export({type:'pkcs8',format:'pem'})),key=signer.publicMetadata().publicKey;await writeFile(join(dir,'public.pem'),key);
 let mode='pass',calls=0,lastReceipt;
 const server=createServer(async(req,res)=>{calls++;let body='';for await(const chunk of req)body+=chunk;assert.equal(req.url,'/v1/release-gate');assert.equal(req.headers.authorization,'Bearer atci_synthetic_only');const request=JSON.parse(body),allowed=mode!=='block';const result={runId:id,decision:mode==='invalid'?'block':allowed?'pass':'block',deploymentAllowed:allowed,reasons:allowed?[]:['Synthetic block']};const artifact={receiptId:id,request,result};lastReceipt={...result,artifact,artifactHash:hash(artifact),signature:signer.sign(artifact)};res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(lastReceipt));});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 async function run(overrides={}){const env=Object.fromEntries(Object.entries(process.env).filter(([name])=>!name.startsWith('AGENTTRUST_')));Object.assign(env,{AGENTTRUST_URL:'http://127.0.0.1:'+server.address().port+'/',AGENTTRUST_ACCESS_KEY:'atci_synthetic_only',AGENTTRUST_RUN_ID:id,AGENTTRUST_AGENT_VERSION_ID:id,AGENTTRUST_DATASET_VERSION_ID:id,AGENTTRUST_POLICY_VERSION_ID:id,AGENTTRUST_RECEIPT_PUBLIC_KEY_FILE:join(dir,'public.pem'),...overrides});const child=spawn(process.execPath,['scripts/release-gate.mjs'],{cwd:process.cwd(),env,windowsHide:true});let stdout='',stderr='';child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);const [code]=await once(child,'close');return {code,stdout,stderr};}
 try{await work({dir,key,run,setMode:value=>mode=value,calls:()=>calls,receipt:()=>lastReceipt});}finally{await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
}
test('actual release command saves verified passing receipt and exits zero',async()=>fixture(async f=>{
 const path=join(f.dir,'pass.json'),result=await f.run({AGENTTRUST_RECEIPT_OUTPUT_FILE:path});assert.equal(result.code,0);assert.equal(result.stderr,'');const receipt=JSON.parse(await readFile(path,'utf8'));assert.deepEqual(receipt.artifact,f.receipt().artifact);assert.equal(verifyReceipt(receipt,f.key).signatureVerified,true);assert.equal(JSON.parse(result.stdout).deploymentAllowed,true);assert.ok(!result.stdout.includes('atci_synthetic_only'));
}));
test('actual release command saves blocked receipt and retains exit one',async()=>fixture(async f=>{
 f.setMode('block');const path=join(f.dir,'block.json'),result=await f.run({AGENTTRUST_RECEIPT_OUTPUT_FILE:path});assert.equal(result.code,1);assert.equal(verifyReceipt(JSON.parse(await readFile(path,'utf8')),f.key).decision,'block');assert.equal(JSON.parse(result.stdout).deploymentAllowed,false);
}));
test('actual release command exits two and preserves existing file when export fails',async()=>fixture(async f=>{
 const path=join(f.dir,'existing.json');await writeFile(path,'previous artifact');const result=await f.run({AGENTTRUST_RECEIPT_OUTPUT_FILE:path});assert.equal(result.code,2);assert.equal(result.stdout,'');assert.match(result.stderr,/could not verify approval/);assert.equal(await readFile(path,'utf8'),'previous artifact');
}));
test('actual release command never exports inconsistent response or requests malformed input',async()=>fixture(async f=>{
 const path=join(f.dir,'invalid.json');f.setMode('invalid');let result=await f.run({AGENTTRUST_RECEIPT_OUTPUT_FILE:path});assert.equal(result.code,2);await assert.rejects(readFile(path),{code:'ENOENT'});const calls=f.calls();result=await f.run({AGENTTRUST_RUN_ID:'invalid',AGENTTRUST_RECEIPT_OUTPUT_FILE:path});assert.equal(result.code,2);assert.equal(f.calls(),calls);assert.equal(result.stdout,'');
}));

test('actual release command rejects ambiguous and oversized trusted key files before authentication',async()=>fixture(async f=>{
 const path=join(f.dir,'invalid-trust.pem'),privatePem=generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'pem'});
 for(const text of [f.key+privatePem,f.key+f.key,f.key+'synthetic-canary',' '.repeat(1025)+f.key]){
  await writeFile(path,text);const before=f.calls(),result=await f.run({AGENTTRUST_RECEIPT_PUBLIC_KEY_FILE:path});assert.equal(result.code,2);assert.equal(result.stdout,'');assert.equal(f.calls(),before);assert.ok(!result.stderr.includes('synthetic-canary'));assert.ok(!result.stderr.includes(privatePem));
 }
 const result=await f.run();assert.equal(result.code,0);assert.equal(f.calls(),1);
}));
