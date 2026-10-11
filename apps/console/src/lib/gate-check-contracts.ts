import {campaignGate,type Campaign,type CampaignArchive} from './campaign-contracts.ts';
import {type Identity,type Gate} from './contracts.ts';
import {releaseRequirements,verifyReleasePermission,type ReleaseRequirements} from './release-requirements.ts';
export type GateCheck={checkedAtEpochMillis:number;expiresAtEpochMillis:number;keyId:string;observedGate:Gate;currentDeploymentAuthority:false;releaseRequirements?:ReleaseRequirements};
const domain='agenttrust-local-development';
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw Error('INVALID_GATE_CHECK');return value as Record<string,unknown>}
function hash(value:unknown){if(typeof value!=='string'||! /^[a-f0-9]{64}$/.test(value))throw Error('INVALID_GATE_CHECK');return value}
function bytes(value:unknown,max:number){if(typeof value!=='string'||value.length>22000||! /^[A-Za-z0-9+/]+={0,2}$/.test(value))throw Error('INVALID_GATE_CHECK');const result=Uint8Array.from(atob(value),x=>x.charCodeAt(0));if(!result.length||result.length>max||btoa(String.fromCharCode(...result))!==value)throw Error('INVALID_GATE_CHECK');return result}
async function digest(value:Uint8Array<ArrayBuffer>){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',value)),x=>x.toString(16).padStart(2,'0')).join('')}
function epoch(value:unknown):number{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<1)throw Error('INVALID_GATE_CHECK');return value}
export function newGateChallenge(){return Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('')}
export async function verifiedGateCheck(value:unknown,trustValue:unknown,user:Identity,record:Campaign,archive:CampaignArchive,challenge:string,requestStartedAt:number,now=Date.now()):Promise<GateCheck>{
 hash(challenge);epoch(requestStartedAt);epoch(now);
 const frame=object(value),trust=object(trustValue),keyId=hash(trust.keyId),publicKey=bytes(trust.publicKeySpkiBase64,44);
 if(publicKey.length!==44||await digest(publicKey)!==keyId||trust.signatureAlgorithm!=='Ed25519'||trust.trustDomain!==domain||trust.productionKey!==false||frame.keyId!==keyId||frame.signatureAlgorithm!=='Ed25519'||frame.trustDomain!==domain||frame.currentDeploymentAuthority!==false)throw Error('INVALID_GATE_CHECK_TRUST');
 const payload=bytes(frame.payloadBase64,16384),signature=bytes(frame.signatureBase64,64);
 if(payload.length!==frame.payloadBytes||signature.length!==64||await digest(payload)!==hash(frame.payloadSha256))throw Error('INVALID_GATE_CHECK');
 const key=await crypto.subtle.importKey('spki',publicKey,{name:'Ed25519'},false,['verify']);
 if(!await crypto.subtle.verify('Ed25519',key,signature,payload))throw Error('INVALID_GATE_CHECK_SIGNATURE');
 const doc=object(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(payload)));
 if(!(doc.schemaVersion===1&&Object.keys(doc).length===20||doc.schemaVersion===2&&Object.keys(doc).length===21)||doc.kind!=='campaign-current-gate-check'||doc.trustDomain!==domain||doc.currentDeploymentAuthority!==false||doc.challenge!==challenge||doc.campaignId!==record.id||doc.organizationId!==user.organizationId||doc.projectId!==user.projectId||doc.actorId!==user.actorId||doc.agentVersionId!==record.agent_version_id||doc.datasetVersionId!==record.dataset_version_id||doc.agentContentSha256!==record.agent_content_sha256||doc.datasetContentSha256!==record.dataset_content_sha256||doc.evaluationState!==record.state||doc.evaluationDecision!==record.decision||record.state==='queued')throw Error('INVALID_GATE_CHECK_BINDING');
 const checkedAt=epoch(doc.checkedAtEpochMillis),expiresAt=epoch(doc.expiresAtEpochMillis);
 if(now<requestStartedAt||checkedAt<requestStartedAt-5000||checkedAt>now+5000||expiresAt<=checkedAt||expiresAt-checkedAt>30000||now>=expiresAt)throw Error('EXPIRED_GATE_CHECK');
 const stored=object(doc.campaignArchive);
 if(Object.keys(stored).length!==3||stored.contentSha256!==archive.contentSha256||stored.contentBytes!==archive.contentBytes||stored.storageVersion!==archive.storageVersion)throw Error('INVALID_GATE_CHECK_ARCHIVE');
 const observedGate=campaignGate(doc.observedGate,record);
 if(observedGate.policyStatus!=='evaluated')throw Error('INVALID_GATE_CHECK_POLICY');
 if(doc.latestReview!==null){
  const review=object(doc.latestReview),created=epoch(review.createdAtEpochMillis);
  if(Object.keys(review).length!==6||typeof review.id!=='string'||! /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(review.id)||!['approved','rejected'].includes(String(review.decision))||!Number.isSafeInteger(review.sequence)||(review.sequence as number)<1||typeof review.policyVersion!=='string'||typeof review.policyDigest!=='string'||review.decision==='rejected'&&observedGate.deploymentAllowed)throw Error('INVALID_GATE_CHECK_REVIEW');
  if(observedGate.deploymentAllowed&&record.requires_approval&&(review.decision!=='approved'||review.policyVersion!==observedGate.policyVersion||review.policyDigest!==observedGate.policyDigest||created>checkedAt||checkedAt-created>=3600000||expiresAt>created+3600000))throw Error('INVALID_GATE_CHECK_REVIEW');
 }else if(observedGate.deploymentAllowed&&record.requires_approval)throw Error('INVALID_GATE_CHECK_REVIEW');
 const requirements=doc.schemaVersion===2?releaseRequirements(doc.releaseRequirements,user,record):undefined;
 if(requirements){if(!requirements.enabled)throw Error('INVALID_GATE_CHECK_BINDING');verifyReleasePermission(requirements,observedGate,checkedAt,expiresAt)}
 return {checkedAtEpochMillis:checkedAt,expiresAtEpochMillis:expiresAt,keyId,observedGate,currentDeploymentAuthority:false,...(requirements?{releaseRequirements:requirements}:{})};
}
