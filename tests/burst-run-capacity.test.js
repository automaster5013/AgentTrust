import test from 'node:test';
import assert from 'node:assert/strict';
import {readBurstRunCapacity} from '../scripts/burst-run-capacity.mjs';
const scope={organizationId:'00000000-0000-4000-8000-000000000001',projectId:'10000000-0000-4000-8000-000000000001'};
async function check(retained,active,runs=12){return readBurstRunCapacity({query:async(text,params)=>{assert.deepEqual(params,[scope.organizationId]);return {rows:[{observed_at:new Date('2026-10-06T00:00:00Z'),retained:String(retained),active:String(active)}]};}},scope,runs);}
test('burst reserves no capacity and counts logical runs rather than duplicate create requests',async()=>{
 for(const runs of [2,12,20]){const r=await check(10000-runs,10-Math.min(4,runs),runs);assert.equal(r.status,'passed');assert.equal(r.requestedRuns,runs);assert.equal(r.retainedRemaining,runs);assert.equal(r.requiredActiveSlots,Math.min(4,runs));}
 assert.equal((await check(9989,0)).status,'insufficient_retained');
});
test('burst requires slots for its bounded parallel width instead of admitting one free slot',async()=>{
 for(const active of [7,8,9])assert.equal((await check(500,active)).status,'insufficient_active');
 assert.equal((await check(500,10)).status,'no_active_slot');assert.equal((await check(500,6)).status,'passed');assert.equal((await check(500,8,2)).status,'passed');
});
test('unavailable or malformed capacity observations block without copying rows or raw database errors',async()=>{
 const result=await readBurstRunCapacity({query:async()=>{throw Error('private-db-canary');}},scope,12);assert.equal(result.status,'unavailable');assert.ok(!JSON.stringify(result).includes('canary'));
 for(const row of [{retained:null,active:'0'},{retained:'private-db-canary',active:'0'},{retained:'2',active:'3'},{retained:'9007199254740992',active:'0'},{retained:'02',active:'0'},{retained:'2',active:'0',observed_at:'private-date-canary'}]){
  const r=await readBurstRunCapacity({query:async()=>({rows:[{observed_at:new Date('2026-10-06T00:00:00Z'),...row}]})},scope,2);assert.equal(r.status,'invalid_capacity');assert.ok(!JSON.stringify(r).includes('canary'));
 }
});
test('bad burst counts and malformed selected scopes fail before any database observation',async()=>{
 let calls=0;const owner={query:async()=>{calls++;return {rows:[]};}};
 for(const runs of [1,21,2.5,NaN])await assert.rejects(readBurstRunCapacity(owner,scope,runs));
 await assert.rejects(readBurstRunCapacity(owner,{...scope,organizationId:'private-scope-canary'},12));assert.equal(calls,0);
});
