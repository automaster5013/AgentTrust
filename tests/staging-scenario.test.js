import test from 'node:test';
import assert from 'node:assert/strict';
import {stagingOptions} from '../scripts/staging-target.mjs';
import {stagingScenario} from '../scripts/staging-scenario.mjs';
import {evaluate} from '../packages/evaluator/index.js';
import {sampleDataset} from '../packages/contracts/samples.js';
test('staging scenario selector preserves default and rejects unknown, duplicate or missing selectors',()=>{
 assert.equal(stagingOptions([]).scenario,'pass');assert.equal(stagingOptions(['--scenario','mixed']).scenario,'mixed');for(const args of [['--scenario','unknown'],['--scenario'],['--scenario','mixed','--scenario','pass']])assert.throws(()=>stagingOptions(args));
});
test('mixed staging round covers pass, required failure, missing evidence, execution error and manual approval in both organizations',()=>{
 const counts={pass:0,block:0,inconclusive:0};let manual=0;for(let organization=0;organization<2;organization++)for(let i=0;i<10;i++){const item=stagingScenario('mixed',i);counts[item.decision]++;manual+=Number(item.manual);}assert.deepEqual(counts,{pass:8,block:4,inconclusive:8});assert.equal(manual,4);
});
test('mixed scenarios have the expected evaluator state and permission for both asymmetric datasets',()=>{
 for(const cases of [sampleDataset.cases,sampleDataset.cases.slice(0,2)])for(let index=0;index<10;index++){const expected=stagingScenario('mixed',index),r=evaluate({agent:{mode:expected.mode},dataset:{...sampleDataset,cases},policy:{minimumPassRate:1,requiresManualApproval:expected.manual}});assert.equal(r.state,expected.state);assert.equal(r.gate.decision,expected.decision);assert.equal(r.gate.deploymentAllowed,expected.decision==='pass'&&!expected.manual);}
});
test('staging scenarios are immutable selections and reject out-of-bounds or ambiguous indices',()=>{
 const first=stagingScenario('mixed',0);first.mode='unsafe_output';assert.equal(stagingScenario('mixed',0).mode,'compliant');for(const index of [-1,10,1.5,'1',NaN])assert.throws(()=>stagingScenario('mixed',index));assert.throws(()=>stagingScenario('other',0));for(let index=0;index<10;index++)assert.deepEqual(stagingScenario('pass',index),{mode:'compliant',state:'succeeded',decision:'pass',manual:false});
});
