import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {generateKeyPairSync} from 'node:crypto';
import {hash} from '../packages/contracts/hash.js';
import {ReceiptSigner,verifyReceipt} from '../packages/receipts/signature.js';
const id='00000000-0000-0000-0000-000000000123';
async function fixture(work,mode='pass'){
 const dir=await mkdtemp(join(process.cwd(),'.local','session-process-'));
 const pair=generateKeyPairSync('ed25519'),signer=new ReceiptSigner(pair.privateKey.export({type:'pkcs8',format:'pem'}));
 const key=signer.publicMetadata().publicKey;await writeFile(join(dir,'public.pem'),key);
 const calls=[],violations=[];
 const server=createServer(async(req,res)=>{
  let text='';for await(const chunk of req)text+=chunk;calls.push(req.url);
  res.setHeader('Content-Type','application/json');
  if(req.url==='/v1/auth/login'){
   if(JSON.parse(text).accessKey!=='synthetic-session-only')violations.push('login credential');
   if(mode!=='missing')res.setHeader('Set-Cookie','at_session=synthetic-cookie; HttpOnly; SameSite=Strict');
   res.end('{"loggedIn":true}');return;
  }
  if(req.headers.cookie!=='at_session=synthetic-cookie')violations.push('session cookie');
  if(req.headers.authorization)violations.push('unexpected bearer');
  if(req.url==='/v1/auth/logout'){res.statusCode=mode==='logout-failure'?500:200;res.end('{}');return;}
  if(req.url!=='/v1/release-gate'){violations.push('unexpected path');res.statusCode=404;res.end('{}');return;}
  if(mode==='denied'){res.statusCode=403;res.end('{}');return;}
  const request=JSON.parse(text),allowed=mode!=='block';
  const result={runId:id,decision:allowed?'pass':'block',deploymentAllowed:allowed,reasons:allowed?[]:['Synthetic block']};
  const artifact={receiptId:id,request,result};res.end(JSON.stringify({...result,artifact,artifactHash:mode==='invalid'?'bad':hash(artifact),signature:signer.sign(artifact)}));
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const output=join(dir,'receipt.json');
 async function run(){
  const env=Object.fromEntries(Object.entries(process.env).filter(([name])=>!name.startsWith('AGENTTRUST_')));
  Object.assign(env,{AGENTTRUST_URL:'http://127.0.0.1:'+server.address().port+'/',AGENTTRUST_ACCESS_KEY:'synthetic-session-only',AGENTTRUST_RUN_ID:id,AGENTTRUST_AGENT_VERSION_ID:id,AGENTTRUST_DATASET_VERSION_ID:id,AGENTTRUST_POLICY_VERSION_ID:id,AGENTTRUST_RECEIPT_PUBLIC_KEY_FILE:join(dir,'public.pem'),AGENTTRUST_RECEIPT_OUTPUT_FILE:output});
  const child=spawn(process.execPath,['scripts/release-gate.mjs'],{cwd:process.cwd(),env,windowsHide:true});let stdout='',stderr='';
  child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);
  const [code]=await once(child,'close');assert.deepEqual(violations,[]);
  assert.ok(!stdout.includes('synthetic-session-only')&&!stderr.includes('synthetic-session-only'));
  assert.ok(!stdout.includes('synthetic-cookie')&&!stderr.includes('synthetic-cookie'));
  return {code,stdout,stderr};
 }
 try{await work({run,calls,output,key});}finally{await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
}
test('actual session CLI logs out and saves signed pass and block with correct exit codes',async()=>{
 for(const mode of ['pass','block'])await fixture(async f=>{
  const result=await f.run();assert.equal(result.code,mode==='pass'?0:1);assert.equal(result.stderr,'');
  assert.deepEqual(f.calls,['/v1/auth/login','/v1/release-gate','/v1/auth/logout']);
  const receipt=JSON.parse(await readFile(f.output,'utf8'));assert.equal(verifyReceipt(receipt,f.key).decision,mode);
  assert.equal(JSON.parse(result.stdout).deploymentAllowed,mode==='pass');
 },mode);
});
test('actual session CLI logs out after invalid or denied gates and does not export',async()=>{
 for(const mode of ['invalid','denied'])await fixture(async f=>{
  const result=await f.run();assert.equal(result.code,2);assert.equal(result.stdout,'');assert.match(result.stderr,/could not verify approval/);
  assert.deepEqual(f.calls,['/v1/auth/login','/v1/release-gate','/v1/auth/logout']);await assert.rejects(readFile(f.output),{code:'ENOENT'});
 },mode);
});
test('actual session CLI cannot approve or export when logout fails',async()=>fixture(async f=>{
 const result=await f.run();assert.equal(result.code,2);assert.equal(result.stdout,'');assert.equal(f.calls.at(-1),'/v1/auth/logout');await assert.rejects(readFile(f.output),{code:'ENOENT'});
},'logout-failure'));
test('actual session CLI refuses missing cookie without sending a gate request',async()=>fixture(async f=>{
 const result=await f.run();assert.equal(result.code,2);assert.equal(result.stdout,'');assert.deepEqual(f.calls,['/v1/auth/login']);await assert.rejects(readFile(f.output),{code:'ENOENT'});
},'missing'));
