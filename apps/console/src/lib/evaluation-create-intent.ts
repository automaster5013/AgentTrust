import {detail,type Identity,type Detail} from './contracts.ts';
export type EvaluationCreateInput={scenario:'pass'|'block'|'missing_evidence'|'error';provider:'synthetic'|'ollama'|'openai'|'openai-compatible';requiresApproval:boolean};
export type EvaluationCreateIntent={requestKey:string;organizationId:string;projectId:string;actorId:string;input:EvaluationCreateInput};
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw Error('INVALID_EVALUATION_INTENT');return value as Record<string,unknown>}
function uuid(value:unknown):string{if(typeof value!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value))throw Error('INVALID_EVALUATION_INTENT');return value}
export function evaluationCreateIntent(user:Identity,scenario:unknown,provider:unknown,requiresApproval:unknown,requestKey=crypto.randomUUID()):EvaluationCreateIntent{
 if(typeof requestKey!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(requestKey)||typeof scenario!=='string'||!['pass','block','missing_evidence','error'].includes(scenario)||typeof provider!=='string'||!['synthetic','ollama','openai','openai-compatible'].includes(provider)||typeof requiresApproval!=='boolean')throw Error('INVALID_EVALUATION_INTENT');
 return Object.freeze({requestKey,organizationId:uuid(user.organizationId),projectId:uuid(user.projectId),actorId:uuid(user.actorId),input:Object.freeze({scenario:scenario as EvaluationCreateInput['scenario'],provider:provider as EvaluationCreateInput['provider'],requiresApproval})});
}
export function requireEvaluationIntent(intent:EvaluationCreateIntent,user:Identity):void{
 const i=object(intent),input=object(i.input);
 if(Object.keys(i).sort().join(',')!=='actorId,input,organizationId,projectId,requestKey'||Object.keys(input).sort().join(',')!=='provider,requiresApproval,scenario'||intent.organizationId!==user.organizationId||intent.projectId!==user.projectId||intent.actorId!==user.actorId)throw Error('INVALID_EVALUATION_INTENT');
 evaluationCreateIntent(user,input.scenario,input.provider,input.requiresApproval,intent.requestKey);
}
export function verifiedEvaluationRequest(value:unknown,intent:EvaluationCreateIntent,user:Identity):string{
 requireEvaluationIntent(intent,user);const frame=object(value);
 if(Object.keys(frame).sort().join(',')!=='actorId,deploymentAuthority,organizationId,projectId,requestKey,runId'||frame.requestKey!==intent.requestKey||frame.organizationId!==user.organizationId||frame.projectId!==user.projectId||frame.actorId!==user.actorId||frame.deploymentAuthority!==false)throw Error('INVALID_EVALUATION_REQUEST');return uuid(frame.runId);
}
export function verifiedCreatedEvaluation(value:unknown,intent:EvaluationCreateIntent,user:Identity,runId?:string):Detail{
 requireEvaluationIntent(intent,user);const id=runId??uuid(object(value).id),result=detail(value,user,id);
 if(result.scenario!==intent.input.scenario||result.provider!==intent.input.provider||result.requires_approval!==intent.input.requiresApproval)throw Error('INVALID_EVALUATION_REQUEST_INPUT');return result;
}
export function verifiedReviewReceipt(value:unknown,decision:unknown):void{
 const receipt=object(value);uuid(receipt.id);
 if(typeof decision!=='string'||!['approved','rejected'].includes(decision)||Object.keys(receipt).sort().join(',')!=='decision,id'||receipt.decision!==decision)throw Error('INVALID_EVALUATION_REVIEW_RECEIPT');
}
