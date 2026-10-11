import test from 'node:test';
import assert from 'node:assert/strict';
import {verifierServer} from './quality-server.mjs';
import {profileHash} from './quality-policy.mjs';

const token='a'.repeat(64);
async function fixture(grader,callback){
 const server=verifierServer(token,grader);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{await callback(`http://127.0.0.1:${server.address().port}`)}finally{await new Promise(resolve=>server.close(resolve))}
}
function request(base,body,override={}){return fetch(base+'/grade',{method:'POST',headers:{'Content-Type':'application/json','X-AgentTrust-Worker-Token':token,...override},body:JSON.stringify(body)})}
const sample={actual:'{"answer":"READY"}',expected:'READY',validatorProfileSha256:profileHash()};
test('real SDK verification is authenticated and does not echo raw sample',async()=>{
 await fixture(undefined,async base=>{
  assert.equal((await fetch(base+'/health')).status,200);
  const response=await request(base,sample);assert.equal(response.status,200);
  const value=await response.json();assert.equal(value.pass,true);assert.equal(value.assertions,2);assert.equal(value.validatorProfileSha256,profileHash());
  assert.equal(Object.hasOwn(value,'actual'),false);assert.equal(Object.hasOwn(value,'expected'),false);
  assert.equal((await request(base,sample,{'X-AgentTrust-Worker-Token':'é'.repeat(64)})).status,401);
 });
});
test('untrusted options and profile mismatches are refused before grading',async()=>{
 let calls=0;await fixture(async()=>{calls++;throw Error('should not execute')},async base=>{
  for(const body of [{...sample,url:'http://example.com'},{...sample,code:'x'},{...sample,actual:'x'.repeat(2049)},{...sample,expected:''}])assert.equal((await request(base,body)).status,400);
  assert.equal((await request(base,{...sample,validatorProfileSha256:'b'.repeat(64)})).status,409);
  assert.equal((await request(base,sample,{'Content-Type':'text/plain'})).status,415);
  assert.equal(calls,0);
 });
});
test('malformed UTF8, oversized bodies and unrelated paths fail before grading',async()=>{
 let calls=0;await fixture(async()=>{calls++;throw Error('forbidden')},async base=>{
  const headers={'Content-Type':'application/json','X-AgentTrust-Worker-Token':token};
  assert.equal((await fetch(base+'/grade',{method:'POST',headers,body:Buffer.from([0xff,0xfe])})).status,400);
  assert.equal((await fetch(base+'/grade',{method:'POST',headers,body:'x'.repeat(8193)})).status,413);
  assert.equal((await fetch(base+'/other',{method:'POST',headers,body:'{}'})).status,404);
  assert.equal(calls,0);
 });
});
test('busy verifier rejects overlap and internal errors expose no input',async()=>{
 let release,entered;const enteredPromise=new Promise(resolve=>entered=resolve);
 await fixture(async()=>{entered();await new Promise(resolve=>release=resolve);throw Error('PRIVATE_SAMPLE_CANARY')},async base=>{
  const first=request(base,sample);await enteredPromise;
  assert.equal((await request(base,sample)).status,503);release();
  const response=await first;assert.equal(response.status,503);assert.equal(await response.text(),'{"error":"VERIFIER_UNAVAILABLE"}');
 });
});
