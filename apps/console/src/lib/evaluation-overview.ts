import type {Identity} from './contracts.ts';
export type EvaluationOverview={observedAt:string;retainedCount:number;states:{queued:number;succeeded:number;failed:number};decisions:{pass:number;block:number;inconclusive:number}};
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw Error('INVALID_OVERVIEW');return value as Record<string,unknown>}
function counts(value:unknown,keys:string[]):Record<string,number>{const v=object(value);if(Object.keys(v).sort().join(',')!==[...keys].sort().join(',')||keys.some(key=>!Number.isSafeInteger(v[key])||(v[key] as number)<0))throw Error('INVALID_OVERVIEW_COUNTS');return v as Record<string,number>}
export function evaluationOverview(value:unknown,user:Identity):EvaluationOverview{
 const v=object(value);if(Object.keys(v).sort().join(',')!=='contract,decisions,deploymentAuthority,observedAt,organizationId,projectId,retainedCount,scope,states'||v.contract!=='project-evaluation-overview-v1'||v.scope!=='project'||v.organizationId!==user.organizationId||v.projectId!==user.projectId||v.deploymentAuthority!==false)throw Error('INVALID_OVERVIEW_SCOPE');
 const time=v.observedAt;if(typeof time!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(time)||!Number.isFinite(Date.parse(time))||new Date(Date.parse(time)).toISOString().slice(0,19)!==time.slice(0,19))throw Error('INVALID_OVERVIEW_TIME');
 const states=counts(v.states,['queued','succeeded','failed']) as EvaluationOverview['states'],decisions=counts(v.decisions,['pass','block','inconclusive']) as EvaluationOverview['decisions'];
 if(!Number.isSafeInteger(v.retainedCount)||(v.retainedCount as number)<0||v.retainedCount!==states.queued+states.succeeded+states.failed||v.retainedCount!==decisions.pass+decisions.block+decisions.inconclusive||states.queued+states.failed>decisions.inconclusive)throw Error('INVALID_OVERVIEW_TOTAL');
 return {observedAt:time,retainedCount:v.retainedCount as number,states,decisions};
}
