import test from 'node:test';
import assert from 'node:assert/strict';
import { Auth } from '../apps/api/auth.js';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function fixture(){
 const lookups=[],client={query:async sql=>{if(sql.includes('lookup_credential')){const d=deferred();lookups.push(d);return d.promise;}return {rows:[],rowCount:0};},release:()=>{}};
 return {auth:new Auth({connect:async()=>client}),lookups};
}
test('concurrent unknown credentials cannot exceed the failed login budget',async()=>{
 const {auth,lookups}=fixture(),pending=Array.from({length:20},()=>auth.login('a'.repeat(64)).catch(e=>e.status));
 await new Promise(r=>setImmediate(r));assert.equal(lookups.length,20);
 await assert.rejects(auth.login('b'.repeat(64)),e=>e.status===429);assert.equal(lookups.length,20);
 for(const d of lookups)d.resolve({rows:[],rowCount:0});assert.deepEqual(await Promise.all(pending),Array(20).fill(401));
 await assert.rejects(auth.login('c'.repeat(64)),e=>e.status===429);assert.equal(auth.pendingLogins,0);
});
test('database failures release pending login slots without recording invalid credentials',async()=>{
 const {auth,lookups}=fixture();
 const pending=Array.from({length:20},()=>auth.login('a'.repeat(64)).catch(e=>e.message));await new Promise(r=>setImmediate(r));
 for(const d of lookups)d.reject(new Error('Synthetic database failure'));
 assert.deepEqual(await Promise.all(pending),Array(20).fill('Synthetic database failure'));assert.equal(auth.pendingLogins,0);assert.equal(auth.failures.length,0);
 const next=auth.login('b'.repeat(64)).catch(e=>e.status);await new Promise(r=>setImmediate(r));assert.equal(lookups.length,21);lookups.at(-1).resolve({rows:[],rowCount:0});assert.equal(await next,401);
});
