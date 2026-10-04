import assert from 'node:assert/strict';
import {readFile,appendFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {preflightChecks} from './preflight-diagnostic.mjs';

function context(env){
  assert.match(env.GITHUB_REPOSITORY||'',/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  assert.match(env.GITHUB_SHA||'',/^[a-f0-9]{40}$/);
  assert.match(env.GITHUB_RUN_ID||'',/^[1-9][0-9]*$/);assert.match(env.GITHUB_RUN_ATTEMPT||'',/^[1-9][0-9]*$/);
  assert.equal(env.GITHUB_SERVER_URL,'https://github.com');
  const image=env.AGENTTRUST_IMAGE;
  assert.match(image||'',/^ghcr\.io\/[a-z0-9_.-]+\/[a-z0-9_.-]+@sha256:[a-f0-9]{64}$/);
  assert.equal(image.split('@')[0],'ghcr.io/'+env.GITHUB_REPOSITORY.toLowerCase());
  return {repository:env.GITHUB_REPOSITORY,revision:env.GITHUB_SHA,image,workflow:{runId:env.GITHUB_RUN_ID,attempt:env.GITHUB_RUN_ATTEMPT,url:`https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`}};
}
function timestamp(value){assert.equal(typeof value,'string');assert.equal(new Date(value).toISOString(),value);return value;}
export function createDeliveryManifest(env,runtime,preflight){
  const identity=context(env);
  for(const report of [runtime,preflight]){assert.equal(report.image,identity.image);assert.equal(report.revision,identity.revision);}
  assert.equal(runtime.imageIdentityVerified,true);assert.equal(runtime.isolationVerified,true);
  assert.equal(preflight.schemaVersion,1);assert.equal(preflight.status,'passed');assert.equal(preflight.readOnly,true);
  for(const flag of ['configurationVerified','cachedImageVerified','migrationLedgerVerified','backupSecurityCatalogVerified','backupMigrationLedgerVerified','backupAuthenticated','priorRestoreEvidenceVerified','signingKeyPairVerified'])assert.equal(preflight[flag],true);
  assert.equal(preflight.securityCatalogVersion,2);assert.ok(Number.isInteger(preflight.migrationCount)&&preflight.migrationCount>0);
  assert.deepEqual(preflight.checks.map(({id,status})=>({id,status})),preflightChecks.map(({id})=>({id,status:'passed'})));
  const runtimeVerifiedAt=timestamp(runtime.verifiedAt),preflightVerifiedAt=timestamp(preflight.checkedAt);
  assert.ok(Date.parse(preflightVerifiedAt)>=Date.parse(runtimeVerifiedAt));
  return {schemaVersion:1,...identity,state:'runtime_verified',verification:{runtimeVerifiedAt,preflightVerifiedAt,checks:preflightChecks.map(({id})=>id)},serverDeployed:false};
}
export function promotedDeliveryManifest(env,manifest){
  const identity=context(env);
  assert.equal(manifest.schemaVersion,1);assert.equal(manifest.state,'runtime_verified');assert.equal(manifest.serverDeployed,false);
  for(const key of ['repository','revision','image'])assert.equal(manifest[key],identity[key]);
  assert.deepEqual(manifest.workflow,identity.workflow);
  assert.deepEqual(manifest.verification.checks,preflightChecks.map(({id})=>id));
  const verification={runtimeVerifiedAt:timestamp(manifest.verification.runtimeVerifiedAt),preflightVerifiedAt:timestamp(manifest.verification.preflightVerifiedAt),checks:preflightChecks.map(({id})=>id)};
  assert.ok(Date.parse(verification.preflightVerifiedAt)>=Date.parse(verification.runtimeVerifiedAt));
  return {schemaVersion:1,...identity,state:'promoted',verification,promotedAt:new Date().toISOString(),serverDeployed:false};
}
export function verifyPromotedDeliveryManifest(env,manifest,now=Date.now()){
  assert.equal(manifest.state,'promoted');
  // Reuse the producer's identity and ordered verification checks, projecting
  // only public fields rather than returning arbitrary input JSON.
  const projected=promotedDeliveryManifest(env,{...manifest,state:'runtime_verified'});
  const promotedAt=timestamp(manifest.promotedAt);
  assert.ok(Number.isFinite(now));
  assert.ok(Date.parse(promotedAt)>=Date.parse(projected.verification.preflightVerifiedAt));
  assert.ok(Date.parse(promotedAt)<=now);
  return {...projected,promotedAt,identityAndStructureVerified:true,ciSuccessChecked:false,signatureVerified:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    let manifest;
    if(process.argv[2]==='runtime'){
      const runtime=JSON.parse(await readFile('.local/image-smoke.json','utf8'));
      const preflight=JSON.parse(await readFile('.local/deployment-preflight.json','utf8'));
      manifest=createDeliveryManifest(process.env,runtime,preflight);
      assert.ok(process.env.GITHUB_OUTPUT);await appendFile(process.env.GITHUB_OUTPUT,'manifest='+JSON.stringify(manifest)+'\n');
    }else{
      assert.ok(['validate','promoted'].includes(process.argv[2]));
      manifest=promotedDeliveryManifest(process.env,JSON.parse(process.env.AGENTTRUST_DELIVERY_MANIFEST));
      if(process.argv[2]==='validate'){console.log('Delivery manifest identity verified.');process.exit(0);}
    }
    assert.ok(process.env.GITHUB_STEP_SUMMARY);
    await appendFile(process.env.GITHUB_STEP_SUMMARY,'## Public delivery manifest\n\n```json\n'+JSON.stringify(manifest,null,2)+'\n```\n\nOperational record only; not a signed attestation. No server deployment performed.\n');
    console.log(JSON.stringify(manifest));
  }catch{console.error('Delivery manifest blocked: inspect workflow identity and successful runtime/preflight evidence.');process.exitCode=1;}
}
