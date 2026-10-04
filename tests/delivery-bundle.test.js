import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {publicDeliveryBundle} from '../scripts/delivery-bundle.mjs';
import {preflightChecks} from '../scripts/preflight-diagnostic.mjs';
const env={GITHUB_SERVER_URL:'https://github.com',GITHUB_REPOSITORY:'automaster5013/AgentTrust',GITHUB_SHA:'a'.repeat(40),GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1',AGENTTRUST_IMAGE:'ghcr.io/automaster5013/agenttrust@sha256:'+'b'.repeat(64)};
function manifest(){return {schemaVersion:1,repository:env.GITHUB_REPOSITORY,revision:env.GITHUB_SHA,image:env.AGENTTRUST_IMAGE,workflow:{runId:'123',attempt:'1',url:'https://github.com/automaster5013/AgentTrust/actions/runs/123'},state:'promoted',verification:{runtimeVerifiedAt:'2026-10-04T00:00:00.000Z',preflightVerifiedAt:'2026-10-04T00:01:00.000Z',checks:preflightChecks.map(({id})=>id)},promotedAt:'2026-10-04T00:02:00.000Z',serverDeployed:false};}
test('public bundle excludes private extras and hashes the exact downloadable bytes',()=>{
 const canary='secret-do-not-upload',input={...manifest(),backup:canary,key:canary};input.verification.private=canary;
 const bundle=publicDeliveryBundle(env,input);assert.deepEqual(Object.keys(bundle.files),['delivery-manifest.json','delivery-manifest.sha256']);
 assert.ok(!JSON.stringify(bundle).includes(canary));assert.equal(JSON.parse(bundle.files['delivery-manifest.json']).state,'promoted');
 assert.equal(createHash('sha256').update(bundle.files['delivery-manifest.json']).digest('hex'),bundle.sha256);
 assert.equal(bundle.files['delivery-manifest.sha256'],bundle.sha256+'  delivery-manifest.json\n');
 assert.notEqual(createHash('sha256').update(bundle.files['delivery-manifest.json']+' ').digest('hex'),bundle.sha256);
});
test('public bundle refuses candidates and mismatched workflow attempts before preparing files',()=>{
 assert.throws(()=>publicDeliveryBundle(env,{...manifest(),state:'runtime_verified'}));
 assert.throws(()=>publicDeliveryBundle({...env,GITHUB_RUN_ATTEMPT:'2'},manifest()));
 assert.throws(()=>publicDeliveryBundle({...env,AGENTTRUST_IMAGE:'latest'},manifest()));
});
