import test from 'node:test';import assert from 'node:assert/strict';
import {createPublicKey,createHash} from 'node:crypto';
import {observationFixture} from './observation-fixtures.ts';
import {verifiedObservationBundle} from '../src/lib/observation-bundles.ts';
import type {Identity} from '../src/lib/contracts.ts';
function fixture(){const f=observationFixture(true,true),record=f.bundle.campaign,der=createPublicKey(f.pem).export({type:'spki',format:'der'});const trust={keyId:createHash('sha256').update(der).digest('hex'),publicKeySpkiBase64:der.toString('base64'),signatureAlgorithm:'Ed25519',trustDomain:'agenttrust-local-development',productionKey:false};const user={organizationId:record.organization_id,projectId:record.project_id,actorId:record.id} as Identity;return {...f,user,trust}}
test('actual Ed25519 signature binds both complete candidate and comparison baseline archive chains',async()=>{const f=fixture(),proof=await verifiedObservationBundle(f.bundle,f.trust,f.user,f.bundle.campaign.id,f.bundle.receipt.receiptId);assert.equal(proof.baselineBytesVerified,true);assert.equal(proof.childArchives,1);assert.equal(proof.baseline?.childArchives,1);assert.equal(proof.baseline?.record.id,f.bundle.baseline!.campaign.id);assert.equal(proof.receipt.currentDeploymentAuthority,false)});
test('baseline bytes omission modified child and substituted storage versions cannot reuse a valid signature',async()=>{
 const f=fixture();const verify=(bundle:unknown)=>verifiedObservationBundle(bundle,f.trust,f.user,f.bundle.campaign.id,f.bundle.receipt.receiptId);
 const omitted={...f.bundle,schemaVersion:1};delete omitted.baseline;await assert.rejects(verify(omitted));
 const child=structuredClone(f.bundle);child.baseline!.children[0].archive.contentBase64=Buffer.from('changed baseline bytes').toString('base64');await assert.rejects(verify(child));
 const parent=structuredClone(f.bundle);parent.baseline!.parent.storageVersion='shadow-baseline';await assert.rejects(verify(parent));
 const swapped=structuredClone(f.bundle);swapped.baseline!.children=swapped.children;await assert.rejects(verify(swapped));
});
test('even signed metadata must bind the actual baseline scope state version comparison and unique children',async()=>{
 const f=fixture();const payload=JSON.parse(Buffer.from(f.bundle.receipt.payloadBase64,'base64').toString('utf8'));
 const variants=[{...payload,baselineArchives:{...payload.baselineArchives,campaignId:f.bundle.campaign.id}},{...payload,baselineArchives:{...payload.baselineArchives,evaluationDecision:'block'}},{...payload,baselineArchives:{...payload.baselineArchives,childArchives:[{...payload.baselineArchives.childArchives[0],runId:f.bundle.children[0].run.id}]}},{...payload,releaseRequirements:{...payload.releaseRequirements,comparison:{...payload.releaseRequirements.comparison,improvedRequiredCases:['required-pass']}}}];
 for(const value of variants)await assert.rejects(verifiedObservationBundle({...f.bundle,receipt:f.signed(value)},f.trust,f.user,f.bundle.campaign.id,f.bundle.receipt.receiptId));
 const foreign=structuredClone(f.bundle);foreign.baseline!.campaign.organization_id=f.bundle.campaign.id;await assert.rejects(verifiedObservationBundle(foreign,f.trust,f.user,f.bundle.campaign.id,f.bundle.receipt.receiptId));
});
