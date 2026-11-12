import type {Identity} from './contracts.ts';
export type EvaluationRecent={windowStart:string;observedAt:string;completedCount:number;executionErrorCount:number;unknownCompletionTimeCount:number};
function instant(value:unknown):bigint{
 if(typeof value!=='string')throw Error('INVALID_RECENT_TIME');
 const match=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z$/.exec(value);
 if(!match)throw Error('INVALID_RECENT_TIME');
 const seconds=Date.parse(match[1]+'Z');
 if(!Number.isFinite(seconds)||new Date(seconds).toISOString().slice(0,19)!==match[1])throw Error('INVALID_RECENT_TIME');
 return BigInt(seconds)*1000n+BigInt((match[2]||'').padEnd(6,'0'));
}
export function evaluationRecent(value:unknown,user:Identity):EvaluationRecent{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('INVALID_RECENT');
 const v=value as Record<string,unknown>;
 if(Object.keys(v).sort().join(',')!=='completedCount,contract,deploymentAuthority,executionErrorCount,observedAt,organizationId,projectId,scope,unknownCompletionTimeCount,windowStart'||v.contract!=='project-evaluation-recent-v1'||v.scope!=='project'||v.organizationId!==user.organizationId||v.projectId!==user.projectId||v.deploymentAuthority!==false)throw Error('INVALID_RECENT_SCOPE');
 for(const key of ['completedCount','executionErrorCount','unknownCompletionTimeCount'])if(!Number.isSafeInteger(v[key])||(v[key] as number)<0)throw Error('INVALID_RECENT_COUNT');
 if((v.executionErrorCount as number)>(v.completedCount as number)||instant(v.observedAt)-instant(v.windowStart)!==86_400_000_000n)throw Error('INVALID_RECENT_WINDOW');
 return {windowStart:v.windowStart as string,observedAt:v.observedAt as string,completedCount:v.completedCount as number,executionErrorCount:v.executionErrorCount as number,unknownCompletionTimeCount:v.unknownCompletionTimeCount as number};
}
