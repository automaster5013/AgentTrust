import type {Identity} from './contracts';
export type Readiness={checkedAt:string;ready:boolean;dependencies:{name:string;available:boolean}[]};
export function evaluationReadiness(value:unknown,user:Identity,status:number):Readiness{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('INVALID_READINESS');
 const v=value as Record<string,unknown>;
 if(Object.keys(v).sort().join(',')!=='checkedAt,contract,dependencies,deploymentAuthority,organizationId,productionReady,projectId,ready'||v.contract!=='agenttrust-evaluation-readiness-v1'||v.organizationId!==user.organizationId||v.projectId!==user.projectId||v.productionReady!==false||v.deploymentAuthority!==false||typeof v.ready!=='boolean'||!Array.isArray(v.dependencies)||v.dependencies.length!==3)throw Error('INVALID_READINESS_SCOPE');
 const names=['database','worker-queue','policy'];
 const dependencies=v.dependencies.map((item,index)=>{if(!item||typeof item!=='object'||Array.isArray(item))throw Error('INVALID_DEPENDENCY');const d=item as Record<string,unknown>;if(Object.keys(d).sort().join(',')!=='available,name'||d.name!==names[index]||typeof d.available!=='boolean')throw Error('INVALID_DEPENDENCY');return {name:names[index],available:d.available}});
 if(v.ready!==dependencies.every(d=>d.available)||status!==(v.ready?200:503)||typeof v.checkedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(v.checkedAt)||!Number.isFinite(Date.parse(v.checkedAt)))throw Error('INVALID_READINESS_STATE');
 return {checkedAt:v.checkedAt,ready:v.ready,dependencies};
}
