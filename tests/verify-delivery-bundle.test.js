import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {publicDeliveryBundle} from '../scripts/delivery-bundle.mjs';
import {verifyDeliveryBundle} from '../scripts/verify-delivery-bundle.mjs';
import {preflightChecks} from '../scripts/preflight-diagnostic.mjs';
const env={GITHUB_SERVER_URL:'https://github.com',GITHUB_REPOSITORY:'automaster5013/AgentTrust',GITHUB_SHA:'a'.repeat(40),GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1',AGENTTRUST_IMAGE:'ghcr.io/automaster5013/agenttrust@sha256:'+'b'.repeat(64)};
const expected={AGENTTRUST_DELIVERY_REPOSITORY:env.GITHUB_REPOSITORY,AGENTTRUST_EXPECTED_REVISION:env.GITHUB_SHA,AGENTTRUST_DELIVERY_RUN_ID:'123',AGENTTRUST_DELIVERY_RUN_ATTEMPT:'1',AGENTTRUST_IMAGE:env.AGENTTRUST_IMAGE};
const manifest={schemaVersion:1,repository:env.GITHUB_REPOSITORY,revision:env.GITHUB_SHA,image:env.AGENTTRUST_IMAGE,workflow:{runId:'123',attempt:'1',url:'https://github.com/automaster5013/AgentTrust/actions/runs/123'},state:'promoted',verification:{runtimeVerifiedAt:'2026-10-04T00:00:00.000Z',preflightVerifiedAt:'2026-10-04T00:01:00.000Z',checks:preflightChecks.map(({id})=>id)},promotedAt:'2026-10-04T00:02:00.000Z',serverDeployed:false};
async function fixture(fn){const directory=await mkdtemp('.local/bundle-verify-');try{const bundle=publicDeliveryBundle(env,manifest);for(const [name,bytes] of Object.entries(bundle.files))await writeFile(join(directory,name),bytes);await fn(directory,bundle);}finally{await rm(directory,{recursive:true,force:true});}}
test('bundle verification checks original bytes and independent manifest identity',async()=>fixture(async(directory,bundle)=>{
 const report=await verifyDeliveryBundle(directory,expected);assert.equal(report.manifestChecksumVerified,true);assert.equal(report.manifestSha256,bundle.sha256);assert.equal(report.ciSuccessChecked,false);
 await assert.rejects(verifyDeliveryBundle(directory,{...expected,AGENTTRUST_DELIVERY_RUN_ATTEMPT:'2'}));
}));
test('bundle verification rejects altered bytes, redirected checksum names, oversized and extra files',async()=>{
 for(const mutate of [async(d,b)=>writeFile(join(d,'delivery-manifest.sha256'),b.files['delivery-manifest.sha256']+'\n'),async(d,b)=>writeFile(join(d,'delivery-manifest.json'),b.files['delivery-manifest.json']+' '),async(d,b)=>writeFile(join(d,'delivery-manifest.sha256'),b.sha256+'  ../../private.json\n'),async(d)=>writeFile(join(d,'delivery-manifest.sha256'),'x'.repeat(129)),async(d)=>writeFile(join(d,'private.key'),'secret')])await fixture(async(d,b)=>{await mutate(d,b);await assert.rejects(verifyDeliveryBundle(d,expected));});
});
test('bundle CLI rejects malformed secret-bearing checksums without exposing their contents',async()=>fixture(async(directory)=>{
 const canary='secret-do-not-print';await writeFile(join(directory,'delivery-manifest.sha256'),canary);
 const result=spawnSync(process.execPath,['scripts/verify-delivery-bundle.mjs',directory],{encoding:'utf8',env:{...process.env,...expected},timeout:15000});assert.equal(result.status,1);assert.equal(JSON.parse(result.stdout).code,'DELIVERY_BUNDLE_INVALID');assert.ok(!(result.stdout+result.stderr).includes(canary));
}));
