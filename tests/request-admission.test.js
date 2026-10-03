import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { once } from 'node:events';
import { createApp } from '../apps/api/server.js';
const safe={rolname:'agenttrust_api',rolcanlogin:true,rolbypassrls:false,rolsuper:false,rolcreaterole:false,rolcreatedb:false,rolreplication:false,memberships:false,schema_create:false,database_create:false,owns_tables:false,owns_functions:false};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
async function fixture(t,limit=1){
  const calls=[],waiting=[];
  const database={query:async sql=>{calls.push(sql);if(sql==='SELECT 1'){const d=deferred();waiting.push(d);return d.promise;}return {rows:[safe]};}};
  const server=createApp({database,maxConcurrentRequests:limit});server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>{server.closeAllConnections();server.close();});
  const url=`http://127.0.0.1:${server.address().port}`;
  const started=async n=>{for(let i=0;i<100&&waiting.length<n;i++)await new Promise(r=>setTimeout(r,5));assert.equal(waiting.length,n);};
  return {server,url,calls,waiting,started};
}
test('admission bounds DB work, preserves static access and releases completed requests',async t=>{
  const f=await fixture(t,2);
  const a=fetch(f.url+'/health'),b=fetch(f.url+'/health');await f.started(2);
  const count=f.calls.length,busy=await fetch(f.url+'/health');assert.equal(busy.status,503);assert.equal(busy.headers.get('retry-after'),'1');assert.equal(f.calls.length,count);
  assert.equal((await fetch(f.url+'/')).status,200);
  f.waiting[0].resolve({rows:[]});assert.equal((await a).status,200);
  const c=fetch(f.url+'/health');await f.started(3);f.waiting[1].resolve({rows:[]});f.waiting[2].resolve({rows:[]});assert.equal((await b).status,200);assert.equal((await c).status,200);
});
test('a disconnected client retains its admission slot until DB work settles',async t=>{
  const f=await fixture(t);const req=request(f.url+'/health');req.on('error',()=>{});req.end();await f.started(1);const closed=new Promise(r=>req.once('close',r));req.destroy();await closed;
  assert.equal((await fetch(f.url+'/health')).status,503);f.waiting[0].resolve({rows:[]});await new Promise(r=>setTimeout(r,10));
  const next=fetch(f.url+'/health');await f.started(2);f.waiting[1].resolve({rows:[]});assert.equal((await next).status,200);
});
test('failed DB work releases admission after its response',async t=>{
  const f=await fixture(t);const first=fetch(f.url+'/health');await f.started(1);f.waiting[0].reject(new Error('synthetic'));assert.equal((await first).status,503);
  const next=fetch(f.url+'/health');await f.started(2);f.waiting[1].resolve({rows:[]});assert.equal((await next).status,200);
});
test('fetch metadata blocks foreign browser requests before database access',async t=>{
  const f=await fixture(t);
  for(const site of ['cross-site','same-site','unknown','same-origin, none']){assert.equal((await fetch(f.url+'/health',{headers:{'Sec-Fetch-Site':site}})).status,403);assert.equal(f.calls.length,0);}
  for(const site of ['same-origin','none',null]){const result=fetch(f.url+'/health',{headers:site?{'Sec-Fetch-Site':site}:{}});await f.started(f.waiting.length+1);f.waiting.at(-1).resolve({rows:[]});assert.equal((await result).status,200);}
});
test('invalid admission limits fail startup',()=>{
  for(const limit of [0,65,1.5,NaN,'2'])assert.throws(()=>createApp({database:{},maxConcurrentRequests:limit}),/Request limit/);
});
