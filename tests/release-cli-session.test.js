import test from 'node:test';
import assert from 'node:assert/strict';
import {checkRelease} from '../scripts/release-gate.mjs';
import {hash} from '../packages/contracts/hash.js';
const id='00000000-0000-0000-0000-000000000123';
const input={base:'http://127.0.0.1:4310/',accessKey:'synthetic-only',candidateRunId:id,agentVersionId:id,datasetVersionId:id,policyVersionId:id};
async function fixture(work,{allowed=true,invalid=false,status=200,cookie=true,logoutStatus=200}={}){
 const original=globalThis.fetch,calls=[],cancelled=[];
 function unused(path,status,headers={}){
  return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('unused synthetic response'));},cancel(){cancelled.push(path);}}),{status,headers});
 }
 globalThis.fetch=async(url,options)=>{
  const path=new URL(url).pathname;calls.push(path);
  if(path==='/v1/auth/login')return unused(path,200,cookie?{'set-cookie':'at_session=synthetic; HttpOnly'}:{});
  assert.equal(options.headers.Cookie,'at_session=synthetic');
  if(path==='/v1/auth/logout')return unused(path,logoutStatus);
  if(status!==200)return unused(path,status);
  const request=JSON.parse(options.body),result={runId:id,decision:allowed?'pass':'block',deploymentAllowed:allowed,reasons:allowed?[]:['Synthetic block']},artifact={request,result};
  return new Response(JSON.stringify({...result,artifact,artifactHash:invalid?'bad':hash(artifact)}));
 };
 try{await work({calls,cancelled});}finally{globalThis.fetch=original;}
}
test('session release checks dispose login and logout bodies for both pass and block',async()=>{
 for(const allowed of [true,false])await fixture(async f=>{
  assert.equal((await checkRelease(input)).deploymentAllowed,allowed);
  assert.deepEqual(f.calls,['/v1/auth/login','/v1/release-gate','/v1/auth/logout']);
  assert.deepEqual(f.cancelled,['/v1/auth/login','/v1/auth/logout']);
 },{allowed});
});
test('session cleanup follows integrity failure and cancels HTTP rejection bodies',async()=>{
 for(const options of [{invalid:true},{status:403}])await fixture(async f=>{
  await assert.rejects(checkRelease(input));assert.equal(f.calls.at(-1),'/v1/auth/logout');
  assert.ok(f.cancelled.includes('/v1/auth/login'));assert.ok(f.cancelled.includes('/v1/auth/logout'));
  if(options.status)assert.ok(f.cancelled.includes('/v1/release-gate'));
 },options);
});
test('missing session and failed logout remain errors while unused bodies are cancelled',async()=>{
 await fixture(async f=>{await assert.rejects(checkRelease(input),/Session is missing/);assert.deepEqual(f.calls,['/v1/auth/login']);assert.deepEqual(f.cancelled,f.calls);},{cookie:false});
 await fixture(async f=>{await assert.rejects(checkRelease(input),/rejected request/);assert.ok(f.cancelled.includes('/v1/auth/logout'));},{logoutStatus:500});
});
