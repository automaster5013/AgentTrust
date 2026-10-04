import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {verifyPromotedDeliveryManifest} from '../scripts/delivery-manifest.mjs';
import {readDeliveryManifest} from '../scripts/verify-delivery.mjs';
import {preflightChecks} from '../scripts/preflight-diagnostic.mjs';
const env={GITHUB_SERVER_URL:'https://github.com',GITHUB_REPOSITORY:'automaster5013/AgentTrust',GITHUB_SHA:'a'.repeat(40),GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1',AGENTTRUST_IMAGE:'ghcr.io/automaster5013/agenttrust@sha256:'+'b'.repeat(64)};
function manifest(){return {schemaVersion:1,repository:env.GITHUB_REPOSITORY,revision:env.GITHUB_SHA,image:env.AGENTTRUST_IMAGE,workflow:{runId:'123',attempt:'1',url:'https://github.com/automaster5013/AgentTrust/actions/runs/123'},state:'promoted',verification:{runtimeVerifiedAt:'2026-10-04T00:00:00.000Z',preflightVerifiedAt:'2026-10-04T00:01:00.000Z',checks:preflightChecks.map(({id})=>id)},promotedAt:'2026-10-04T00:02:00.000Z',serverDeployed:false};}
test('manual delivery verification binds independent expectations and rejects candidates or invalid promotion times',()=>{
 const report=verifyPromotedDeliveryManifest(env,manifest(),Date.parse('2026-10-04T00:03:00.000Z'));assert.equal(report.identityAndStructureVerified,true);assert.equal(report.ciSuccessChecked,false);assert.equal(report.signatureVerified,false);
 for(const patch of [{state:'runtime_verified'},{promotedAt:'2026-10-04T00:00:00.000Z'},{promotedAt:'2026-10-05T00:00:00.000Z'},{schemaVersion:2},{serverDeployed:true},{revision:'c'.repeat(40)}])assert.throws(()=>verifyPromotedDeliveryManifest(env,{...manifest(),...patch},Date.parse('2026-10-04T00:03:00.000Z')));
 for(const patch of [{GITHUB_RUN_ID:'124'},{GITHUB_RUN_ATTEMPT:'2'},{GITHUB_REPOSITORY:'other/AgentTrust'},{AGENTTRUST_IMAGE:env.AGENTTRUST_IMAGE.replace('b'.repeat(64),'c'.repeat(64))}])assert.throws(()=>verifyPromotedDeliveryManifest({...env,...patch},manifest()));
});
test('manifest reader bounds bytes and rejects invalid UTF-8 and malformed JSON',async()=>{
 const directory=await mkdtemp('.local/delivery-reader-'),path=join(directory,'manifest.json');
 try{
  for(const content of [Buffer.alloc(65537,32),Buffer.from([0xff]),Buffer.from('{broken')]){await writeFile(path,content);await assert.rejects(readDeliveryManifest(path));}
  await writeFile(path,JSON.stringify(manifest()));assert.equal((await readDeliveryManifest(path)).state,'promoted');
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('manual verification CLI reports success and failure without exposing unknown secret fields',async()=>{
 const directory=await mkdtemp('.local/delivery-cli-'),path=join(directory,'manifest.json'),canary='secret-do-not-print';
 const cliEnv={...process.env,AGENTTRUST_DELIVERY_REPOSITORY:env.GITHUB_REPOSITORY,AGENTTRUST_DELIVERY_RUN_ID:env.GITHUB_RUN_ID,AGENTTRUST_DELIVERY_RUN_ATTEMPT:env.GITHUB_RUN_ATTEMPT,AGENTTRUST_EXPECTED_REVISION:env.GITHUB_SHA,AGENTTRUST_IMAGE:env.AGENTTRUST_IMAGE};
 try{
  await writeFile(path,JSON.stringify({...manifest(),secret:canary}));
  const run=()=>spawnSync(process.execPath,['scripts/verify-delivery.mjs',path],{env:cliEnv,encoding:'utf8',timeout:15000});
  const passed=run();assert.equal(passed.status,0);assert.equal(JSON.parse(passed.stdout).status,'passed');assert.ok(!passed.stdout.includes(canary));
  await writeFile(path,JSON.stringify({...manifest(),revision:canary}));const blocked=run();assert.equal(blocked.status,1);assert.equal(JSON.parse(blocked.stdout).code,'DELIVERY_MANIFEST_INVALID');assert.ok(!(blocked.stdout+blocked.stderr).includes(canary));
 }finally{await rm(directory,{recursive:true,force:true});}
});
