import test from 'node:test';
import assert from 'node:assert/strict';
import {filterCampaignCases} from '../src/lib/campaign-case-filter.ts';
import type {CaseEvidence} from '../src/lib/campaign-contracts.ts';
const cases:CaseEvidence[]=[
 {caseId:'passed',required:true,runId:'a',scenario:'pass',provider:'synthetic',state:'succeeded',decision:'pass'},
 {caseId:'blocked',required:true,runId:'b',scenario:'block',provider:'synthetic',state:'succeeded',decision:'block'},
 {caseId:'pending',required:true,runId:'c',scenario:'error',provider:'synthetic',state:'queued',decision:'inconclusive'},
 {caseId:'optional-error',required:false,runId:'d',scenario:'error',provider:'synthetic',state:'failed',decision:'inconclusive'}
];
test('case filters intersect requirement and actual decision without promoting pending or errors',()=>{
 assert.deepEqual(filterCampaignCases(cases,{required:'required',decision:'inconclusive'}).map(c=>c.caseId),['pending']);
 assert.deepEqual(filterCampaignCases(cases,{required:'optional',decision:'inconclusive'}).map(c=>c.caseId),['optional-error']);
 assert.deepEqual(filterCampaignCases(cases,{required:'all',decision:'pass'}).map(c=>c.caseId),['passed']);
});
test('hiding failed cases preserves full evidence order and reset restores every case',()=>{
 const original=JSON.stringify(cases);Object.freeze(cases);cases.forEach(Object.freeze);
 assert.deepEqual(filterCampaignCases(cases,{required:'optional',decision:'block'}),[]);
 assert.deepEqual(filterCampaignCases(cases,{required:'all',decision:'all'}),cases);
 assert.equal(JSON.stringify(cases),original);
 assert.deepEqual(filterCampaignCases([],{required:'all',decision:'all'}),[]);
});
test('unknown filter values cannot silently broaden evidence presentation',()=>{
 for(const filter of [{required:'approved',decision:'all'},{required:'all',decision:'allowed'}])assert.throws(()=>filterCampaignCases(cases,filter as Parameters<typeof filterCampaignCases>[1]));
});
