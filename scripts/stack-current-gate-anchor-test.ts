import test from 'node:test';import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {verifyAnchoredGateCheck} from './stack-current-gate-anchor.ts';
import {createPublicKey} from 'node:crypto';

import {type Campaign,type CampaignArchive} from '../apps/console/src/lib/campaign-contracts.ts';
import {type Identity} from '../apps/console/src/lib/contracts.ts';
const id=(n:number)=>String(n).repeat(8)+'-'+String(n).repeat(4)+'-4'+String(n).repeat(3)+'-8'+String(n).repeat(3)+'-'+String(n).repeat(12);
const user:Identity={username:'fixture',actorId:id(1),organizationId:id(2),projectId:id(3),role:'viewer',identityProvider:'keycloak',runtime:'java21-spring-boot'};
const record={id:id(4),organization_id:id(2),project_id:id(3),requires_approval:true,agent_version_id:id(5),dataset_version_id:id(6),agent_content_sha256:'a'.repeat(64),dataset_content_sha256:'b'.repeat(64),state:'succeeded',decision:'pass',agentVersion:{definition:{provider:'synthetic'}}} as Campaign;
const archive:CampaignArchive={contentSha256:'c'.repeat(64),contentBytes:500,storageVersion:'parent-version',childArchives:[]};
const now=2_000_000_000_000,challenge='d'.repeat(64);
const observedGate={decision:'pass',deploymentAllowed:true,reason:'Current fixture approval',signed:false,currentReviewRequired:true,policyEngine:'opa-rego',policyStatus:'evaluated',policyVersion:'1.1.0',policyDigest:'sha256:'+'e'.repeat(64)};
function fixture(){
 const pair=generateKeyPairSync('ed25519'),der=pair.publicKey.export({type:'spki',format:'der'}),keyId=createHash('sha256').update(der).digest('hex');
 const trust={keyId,publicKeySpkiBase64:der.toString('base64'),signatureAlgorithm:'Ed25519',trustDomain:'agenttrust-local-development',productionKey:false};
 const payload={schemaVersion:1,kind:'campaign-current-gate-check',trustDomain:trust.trustDomain,currentDeploymentAuthority:false,challenge,campaignId:record.id,organizationId:user.organizationId,projectId:user.projectId,actorId:user.actorId,checkedAtEpochMillis:now,expiresAtEpochMillis:now+30000,agentVersionId:record.agent_version_id,datasetVersionId:record.dataset_version_id,agentContentSha256:record.agent_content_sha256,datasetContentSha256:record.dataset_content_sha256,evaluationState:record.state,evaluationDecision:record.decision,observedGate,latestReview:{id:id(9),decision:'approved',sequence:1,policyVersion:observedGate.policyVersion,policyDigest:observedGate.policyDigest,createdAtEpochMillis:now-1},campaignArchive:{contentSha256:archive.contentSha256,contentBytes:archive.contentBytes,storageVersion:archive.storageVersion}};
 function frame(value:unknown){const bytes=Buffer.from(JSON.stringify(value));return {keyId,payloadBase64:bytes.toString('base64'),payloadSha256:createHash('sha256').update(bytes).digest('hex'),payloadBytes:bytes.length,signatureBase64:sign(null,bytes,pair.privateKey).toString('base64'),signatureAlgorithm:'Ed25519',trustDomain:trust.trustDomain,currentDeploymentAuthority:false}}
 return {payload,trust,frame};
}

function pem(f:ReturnType<typeof fixture>){return createPublicKey({key:Buffer.from(f.trust.publicKeySpkiBase64,'base64'),format:'der',type:'spki'}).export({format:'pem',type:'spki'}).toString()}
test('independent PEM trust verifies actual Ed25519 bytes and rejects the response-supplied alternate key',async()=>{const f=fixture(),other=fixture();assert.equal((await verifyAnchoredGateCheck(f.frame(f.payload),pem(f),user,record,archive,challenge,now-10,now)).keyId,f.trust.keyId);await assert.rejects(()=>verifyAnchoredGateCheck(f.frame(f.payload),pem(other),user,record,archive,challenge,now-10,now));});
test('nonce actor scope archive and exact expiry remain mandatory with an independent key',async()=>{const f=fixture(),frame=f.frame(f.payload);for(const value of [{...f.payload,challenge:'a'.repeat(64)},{...f.payload,actorId:id(8)},{...f.payload,projectId:id(8)},{...f.payload,campaignArchive:{...f.payload.campaignArchive,storageVersion:'other'}}])await assert.rejects(()=>verifyAnchoredGateCheck(f.frame(value),pem(f),user,record,archive,challenge,now,now));await assert.rejects(()=>verifyAnchoredGateCheck(frame,pem(f),user,record,archive,challenge,now,now+30000));const bad=Buffer.from(frame.signatureBase64,'base64');bad[0]^=1;await assert.rejects(()=>verifyAnchoredGateCheck({...frame,signatureBase64:bad.toString('base64')},pem(f),user,record,archive,challenge,now,now));});
test('private wrong-algorithm oversized and malformed PEM are not public trust anchors',async()=>{const f=fixture(),rsa=generateKeyPairSync('rsa',{modulusLength:2048}),pair=generateKeyPairSync('ed25519');for(const key of [rsa.publicKey.export({format:'pem',type:'spki'}).toString(),pair.privateKey.export({format:'pem',type:'pkcs8'}).toString(),'x'.repeat(4097),'-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----\n'])await assert.rejects(()=>verifyAnchoredGateCheck(f.frame(f.payload),key,user,record,archive,challenge,now,now));});
