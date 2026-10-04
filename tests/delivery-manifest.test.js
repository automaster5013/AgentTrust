import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeliveryManifest,promotedDeliveryManifest} from '../scripts/delivery-manifest.mjs';
import {preflightChecks} from '../scripts/preflight-diagnostic.mjs';
const env={GITHUB_REPOSITORY:'automaster5013/AgentTrust',GITHUB_SHA:'a'.repeat(40),GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1',GITHUB_SERVER_URL:'https://github.com',AGENTTRUST_IMAGE:'ghcr.io/automaster5013/agenttrust@sha256:'+'b'.repeat(64)};
function evidence(){return {runtime:{image:env.AGENTTRUST_IMAGE,revision:env.GITHUB_SHA,imageIdentityVerified:true,isolationVerified:true,verifiedAt:'2026-10-04T00:00:00.000Z'},preflight:{image:env.AGENTTRUST_IMAGE,revision:env.GITHUB_SHA,schemaVersion:1,status:'passed',readOnly:true,configurationVerified:true,cachedImageVerified:true,migrationLedgerVerified:true,backupSecurityCatalogVerified:true,backupMigrationLedgerVerified:true,backupAuthenticated:true,priorRestoreEvidenceVerified:true,signingKeyPairVerified:true,securityCatalogVersion:2,migrationCount:19,checkedAt:'2026-10-04T00:01:00.000Z',checks:preflightChecks.map(({id})=>({id,status:'passed'}))}};}
test('delivery manifests project only public fields and bind promotion to the same run and digest',()=>{
 const e=evidence(),canary='secret-do-not-publish';e.runtime.secret=canary;e.preflight.backup=canary;e.preflight.connectionString=canary;
 const candidate=createDeliveryManifest(env,e.runtime,e.preflight);assert.equal(candidate.state,'runtime_verified');assert.ok(!JSON.stringify(candidate).includes(canary));
 candidate.extra=canary;const promoted=promotedDeliveryManifest(env,candidate);assert.equal(promoted.state,'promoted');assert.equal(promoted.serverDeployed,false);assert.ok(!JSON.stringify(promoted).includes(canary));
 for(const override of [{GITHUB_RUN_ID:'124'},{GITHUB_RUN_ATTEMPT:'2'},{GITHUB_SHA:'c'.repeat(40)},{AGENTTRUST_IMAGE:env.AGENTTRUST_IMAGE.replace('b'.repeat(64),'d'.repeat(64))}])assert.throws(()=>promotedDeliveryManifest({...env,...override},candidate));
});
test('delivery manifest refuses failed or incomplete evidence and mismatched identities',()=>{
 for(const change of [e=>e.runtime.imageIdentityVerified=false,e=>e.runtime.revision='c'.repeat(40),e=>e.preflight.status='blocked',e=>e.preflight.checks[6].status='not_run',e=>e.preflight.checks.pop(),e=>e.preflight.backupSecurityCatalogVerified=false,e=>e.preflight.checkedAt='invalid',e=>e.preflight.checkedAt='2026-10-03T00:00:00.000Z']){const e=evidence();change(e);assert.throws(()=>createDeliveryManifest(env,e.runtime,e.preflight));}
 const e=evidence();assert.throws(()=>createDeliveryManifest({...env,AGENTTRUST_IMAGE:'ghcr.io/other/repo@sha256:'+'b'.repeat(64)},e.runtime,e.preflight));
 assert.throws(()=>createDeliveryManifest({...env,GITHUB_RUN_ID:'123\nsecret'},e.runtime,e.preflight));
});
