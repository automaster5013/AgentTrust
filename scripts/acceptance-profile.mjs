import assert from 'node:assert/strict';
import {validate,InputError} from '../packages/contracts/index.js';
import {hash} from '../packages/contracts/hash.js';
import {evaluate} from '../packages/evaluator/index.js';
export const acceptanceModes=[['compliant','succeeded','pass'],['regression','succeeded','block'],['forbidden_tool','succeeded','block'],['missing_evidence','succeeded','inconclusive'],['error','failed','inconclusive']];
export function validateAcceptanceProfile(input){
 if(!input||Array.isArray(input)||typeof input!=='object'||Object.keys(input).some(key=>!['schemaVersion','synthetic','dataset','policy'].includes(key))||input.schemaVersion!==1||input.synthetic!==true)throw new InputError('A synthetic acceptance profile is required.');
 const dataset=validate('dataset',input.dataset),policy=validate('policy',input.policy);
 if(policy.minimumPassRate!==1||policy.requiresManualApproval!==true)throw new InputError('Acceptance demonstration requires complete evaluation and administrator approval.');
 for(const [mode,state,decision] of acceptanceModes){const result=evaluate({agent:{mode},dataset,policy});if(result.state!==state||result.gate.decision!==decision)throw new InputError('Synthetic profile does not distinguish the required acceptance outcomes.');}
 return {schemaVersion:1,synthetic:true,dataset,policy};
}
export async function ensureAcceptanceVersion({call,catalog,kind,data}){
 assert.ok(['dataset','policy'].includes(kind));assert.ok(Array.isArray(catalog)&&catalog.length<=1000);data=validate(kind,data);const contentHash=hash(data);
 const existing=catalog.find(row=>row?.contentHash===contentHash&&row.name===data.name);
 const row=existing||await call('/v1/'+kind+'-versions',data);
 assert.match(row?.id||'',/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);assert.equal(row.contentHash,contentHash);
 const stored=await call('/v1/versions/'+row.id);assert.equal(stored.id,row.id);assert.equal(stored.kind,kind);assert.equal(stored.contentHash,contentHash);assert.equal(hash(validate(kind,stored.data)),contentHash);
 return {id:row.id,contentHash,reused:Boolean(existing)};
}
