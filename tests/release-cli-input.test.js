import test from 'node:test';
import assert from 'node:assert/strict';
import {checkRelease} from '../scripts/release-gate.mjs';
const id='00000000-0000-0000-0000-000000000123';
const valid={base:'http://127.0.0.1:4310/',accessKey:'synthetic-only',candidateRunId:id,agentVersionId:id,datasetVersionId:id,policyVersionId:id};
async function withoutNetwork(work){const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('Network must not be called');};try{await work();assert.equal(calls,0);}finally{globalThis.fetch=original;}}
test('release CLI refuses missing or malformed required IDs before authentication',async()=>withoutNetwork(async()=>{
 for(const key of ['candidateRunId','agentVersionId','datasetVersionId','policyVersionId'])for(const value of [undefined,'','../private',' '+id])await assert.rejects(checkRelease({...valid,[key]:value}),/UUID/);
}));
test('release CLI rejects invalid optional scope and duplicate baseline before any request',async()=>withoutNetwork(async()=>{
 for(const baselineRunId of ['',id,id.toUpperCase(),'invalid'])await assert.rejects(checkRelease({...valid,baselineRunId}),/Baseline/);
 await assert.rejects(checkRelease({...valid,projectId:'invalid'}),/project UUID/);
 for(const checkKey of ['','short','contains space','x'.repeat(101)])await assert.rejects(checkRelease({...valid,checkKey}),/check key/);
}));
test('release CLI refuses empty credentials and invalid validity windows without leaking values',async()=>withoutNetwork(async()=>{
 for(const accessKey of [undefined,'','   '])await assert.rejects(checkRelease({...valid,accessKey}),/access key is required/);
 for(const maxAgeSeconds of [0,86401,NaN,1.5])await assert.rejects(checkRelease({...valid,maxAgeSeconds}),/validity window/);
 await assert.rejects(checkRelease({...valid,candidateRunId:'private-canary'}),error=>!error.message.includes('private-canary'));
}));
