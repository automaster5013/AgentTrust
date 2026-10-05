import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {hash} from '../packages/contracts/hash.js';
import {planAcceptanceVersions,checkAcceptanceVersionCapacity} from '../scripts/acceptance-version-capacity.mjs';
import {runAcceptanceScenario} from '../scripts/acceptance-scenario.mjs';
async function profile(){return JSON.parse(await readFile(new URL('../examples/connector-contract/acceptance-profile.json',import.meta.url),'utf8'));}
const scope={organizationId:'00000000-0000-4000-8000-000000000001',projectId:'10000000-0000-4000-8000-000000000001'};
const operations=used=>({observedAt:'2026-10-06T00:00:00Z',versionCapacity:{scope:'organization',organizationId:scope.organizationId,used,limit:1000,remaining:Math.max(0,1000-used)}});
test('acceptance version planning counts only criteria not exactly reusable by name and hash',async()=>{
 const p=await profile(),catalog={dataset:[],policy:[]};assert.equal(planAcceptanceVersions(catalog,p),2);catalog.dataset.push({name:p.dataset.name,contentHash:hash(p.dataset)});assert.equal(planAcceptanceVersions(catalog,p),1);catalog.policy.push({name:p.policy.name,contentHash:hash(p.policy)});assert.equal(planAcceptanceVersions(catalog,p),0);catalog.policy[0].contentHash=hash({...p.policy,minimumPassRate:0.8});assert.equal(planAcceptanceVersions(catalog,p),1);catalog.dataset[0].name='Different criteria';assert.equal(planAcceptanceVersions(catalog,p),2);
});
test('acceptance version capacity admits exact observed boundaries and reusing criteria at a full quota',()=>{
 assert.equal(checkAcceptanceVersionCapacity(operations(998),scope,2).status,'passed');assert.equal(checkAcceptanceVersionCapacity(operations(999),scope,2).status,'insufficient_versions');assert.equal(checkAcceptanceVersionCapacity(operations(999),scope,1).status,'passed');assert.equal(checkAcceptanceVersionCapacity(operations(1000),scope,0).status,'passed');assert.equal(checkAcceptanceVersionCapacity(operations(1000),scope,1).status,'insufficient_versions');
});
test('invalid, foreign or missing version capacity cannot grant registration permission',()=>{
 for(const change of [x=>delete x.versionCapacity,x=>x.versionCapacity.organizationId='other',x=>x.versionCapacity.scope='project',x=>x.versionCapacity.used=-1,x=>x.versionCapacity.used='998',x=>x.versionCapacity.limit=2000,x=>x.versionCapacity.remaining=3,x=>x.observedAt='invalid']){const x=operations(998);change(x);const result=checkAcceptanceVersionCapacity(x,scope,2);assert.equal(result.status,'invalid_capacity');assert.ok(!JSON.stringify(result).includes('other'));}for(const n of [-1,3,1.2,'2'])assert.throws(()=>checkAcceptanceVersionCapacity(operations(0),scope,n));
});
test('insufficient or unavailable version capacity stops the actual scenario before reads and version writes',async()=>{
 for(const observation of [operations(999),{}]){const calls=[];const r=await runAcceptanceScenario({profile:await profile(),scope,operations:observation,call:async path=>{calls.push(path);assert.equal(path,'/v1/catalog');return {agent:[],dataset:[],policy:[]};},wait:()=>assert.fail(),verify:()=>assert.fail()});assert.equal(r.completed,false);assert.equal(r.cleanupSucceeded,true);assert.deepEqual(calls,['/v1/catalog']);assert.notEqual(r.versionCapacityPreflight.status,'passed');assert.equal(r.versionCapacityPreflight.requestedVersions,2);}
});
