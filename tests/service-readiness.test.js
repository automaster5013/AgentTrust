import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../apps/api/server.js';
import {inspectServiceReadiness} from '../packages/operations/readiness.js';
import {workerReadiness} from '../apps/worker/readiness.js';

function database({service='api',ages=[2],failRole=false,failHeartbeat=false}={}){
 const statements=[];
 return {statements,async query(sql){
  statements.push(sql);
  if(sql.includes('FROM pg_roles')){
   if(failRole)throw Error('postgres://private-password@internal.example/raw-secret');
   return {rows:[{rolname:'agenttrust_'+service,rolcanlogin:true,rolbypassrls:service==='worker',...Object.fromEntries(['rolsuper','rolcreaterole','rolcreatedb','rolreplication','memberships','schema_create','database_create','owns_tables','owns_functions'].map(k=>[k,false]))}]};
  }
  if(sql.includes('service_health')){if(failHeartbeat)throw Error('private heartbeat query details');return {rows:ages.map(age_seconds=>({age_seconds}))};}
  if(sql==='SELECT 1')return {rows:[{value:1}]};
  throw Error('Unexpected query.');
 }};
}
async function server(t,db){const app=createApp({database:db});await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));t.after(async()=>{app.closeAllConnections();await new Promise(resolve=>app.close(resolve));});return 'http://127.0.0.1:'+app.address().port;}

test('readiness requires safe service role and a finite non-future database-clock heartbeat within fifteen seconds',async()=>{
 for(const age of [0,0.001,14.999,15]){const db=database({ages:[age]}),r=await inspectServiceReadiness(db);assert.deepEqual(r,{status:'ready',mode:'local-mock',checks:{database:'ready',worker:'recent'}});assert.ok(db.statements[1].includes('clock_timestamp()'));assert.ok(db.statements.every(s=>s.startsWith('SELECT')));}
 for(const ages of [[],[15.001],[-0.001],[NaN],[Infinity],['2'],[null],[1,2]]){const r=await inspectServiceReadiness(database({ages}));assert.equal(r.status,'not-ready');assert.equal(r.checks.worker,ages.length?'stale':'missing');}
});

test('dependency and role failures are redacted and never report readiness',async()=>{
 for(const options of [{failRole:true},{failHeartbeat:true},{service:'worker'}]){const db=database(options),r=await inspectServiceReadiness(db);assert.deepEqual(r,{status:'not-ready',mode:'local-mock',checks:{database:'unavailable',worker:'unknown'}});assert.doesNotMatch(JSON.stringify(r),/private|postgres|password|internal/);if(options.failRole||options.service)assert.equal(db.statements.length,1);}
 await assert.rejects(inspectServiceReadiness(database(),'owner'));
});

test('worker probe validates worker principal without writing a heartbeat or accepting an API principal',async()=>{
 const db=database({service:'worker'});assert.equal(await workerReadiness(db),true);assert.equal(db.statements.length,2);assert.ok(db.statements.every(s=>s.startsWith('SELECT')));
 assert.equal(await workerReadiness(database()),false);assert.equal(await workerReadiness(database({service:'worker',ages:[16]})),false);assert.equal(await workerReadiness(database({service:'worker',failHeartbeat:true})),false);
});

test('public readiness creates no session and returns retryable 503 for stale worker while existing health stays successful',async t=>{
 const db=database({ages:[16]}),base=await server(t,db),ready=await fetch(base+'/ready');assert.equal(ready.status,503);assert.equal(ready.headers.get('retry-after'),'2');assert.equal(ready.headers.get('set-cookie'),null);assert.equal(ready.headers.get('cache-control'),'no-store');assert.deepEqual(await ready.json(),{status:'not-ready',mode:'local-mock',checks:{database:'ready',worker:'stale'}});
 const health=await fetch(base+'/health');assert.equal(health.status,200);assert.deepEqual(await health.json(),{status:'ok',mode:'local-mock',persistent:true});assert.ok(db.statements.every(s=>!s.includes('sessions')));
});

test('healthy public readiness is bounded by existing host and cross-origin protection and leaks no raw failure',async t=>{
 const base=await server(t,database()),response=await fetch(base+'/ready');assert.equal(response.status,200);assert.equal(response.headers.get('retry-after'),null);assert.equal((await response.json()).status,'ready');
 const foreign=await fetch(base+'/ready',{headers:{Origin:'https://foreign.example'}});assert.equal(foreign.status,403);
 const crossSite=await fetch(base+'/ready',{headers:{'Sec-Fetch-Site':'cross-site'}});assert.equal(crossSite.status,403);
 const failureBase=await server(t,database({failHeartbeat:true})),failed=await fetch(failureBase+'/ready');assert.equal(failed.status,503);assert.doesNotMatch(await failed.text(),/private|password|postgres|SELECT/);
});
