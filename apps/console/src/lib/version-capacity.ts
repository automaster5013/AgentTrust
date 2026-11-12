import type {Identity} from './contracts.ts';
export type CapacityCount={used:number;limit:200;remaining:number;exhausted:boolean};
export type VersionCapacity={observedAt:string;agents:CapacityCount;datasets:CapacityCount};
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw Error('INVALID_CAPACITY');return value as Record<string,unknown>}
function count(value:unknown):CapacityCount{const v=object(value);if(Object.keys(v).sort().join(',')!=='exhausted,limit,remaining,used'||!Number.isSafeInteger(v.used)||(v.used as number)<0||v.limit!==200||v.remaining!==Math.max(0,200-(v.used as number))||v.exhausted!==((v.used as number)>=200))throw Error('INVALID_CAPACITY_COUNT');return {used:v.used as number,limit:200,remaining:v.remaining as number,exhausted:v.exhausted as boolean}}
export function versionCapacity(value:unknown,user:Identity):VersionCapacity{
 const v=object(value);if(Object.keys(v).sort().join(',')!=='agents,contract,datasets,deploymentAuthority,observedAt,organizationId,projectId,reservationGranted,scope'||v.contract!=='project-version-capacity-v1'||v.scope!=='project'||v.organizationId!==user.organizationId||v.projectId!==user.projectId||v.reservationGranted!==false||v.deploymentAuthority!==false)throw Error('INVALID_CAPACITY_SCOPE');
 const time=v.observedAt;if(typeof time!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(time)||!Number.isFinite(Date.parse(time))||new Date(Date.parse(time)).toISOString().slice(0,19)!==time.slice(0,19))throw Error('INVALID_CAPACITY_TIME');
 return {observedAt:time,agents:count(v.agents),datasets:count(v.datasets)};
}
