import {validate,InputError} from '../contracts/index.js';
import {evaluate} from './index.js';
export const acceptanceModes=[['compliant','succeeded','pass'],['regression','succeeded','block'],['forbidden_tool','succeeded','block'],['missing_evidence','succeeded','inconclusive'],['error','failed','inconclusive']];
export function validateAcceptanceProfile(input){
 if(!input||Array.isArray(input)||typeof input!=='object'||Object.keys(input).some(key=>!['schemaVersion','synthetic','dataset','policy'].includes(key))||input.schemaVersion!==1||input.synthetic!==true)throw new InputError('A synthetic acceptance profile is required.');
 const dataset=validate('dataset',input.dataset),policy=validate('policy',input.policy);
 if(policy.minimumPassRate!==1||policy.requiresManualApproval!==true)throw new InputError('Acceptance demonstration requires complete evaluation and administrator approval.');
 for(const [mode,state,decision] of acceptanceModes){const result=evaluate({agent:{mode},dataset,policy});if(result.state!==state||result.gate.decision!==decision)throw new InputError('Synthetic profile does not distinguish the required acceptance outcomes.');}
 return {schemaVersion:1,synthetic:true,dataset,policy};
}
