import {auditPage,type AuditPage} from './audit.ts';
import {auditActor,auditFilters,type AuditFilters} from './audit-search.ts';
import type {Identity} from './contracts.ts';
export type AuditPeriod={startDay:string;endDay:string;actorId:string|null;filters:AuditFilters};
const dayMs=86400000;
function day(value:string):number{
 if(!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)||value<'1970-01-01'||value>'9999-12-30')throw Error('INVALID_AUDIT_PERIOD');
 const ms=Date.parse(value+'T00:00:00Z');if(!Number.isFinite(ms)||new Date(ms).toISOString().slice(0,10)!==value)throw Error('INVALID_AUDIT_PERIOD');return ms;
}
export function auditPeriod(startDay:string,endDay:string,actorId:string|null,filters:AuditFilters):AuditPeriod{
 const a=day(startDay),b=day(endDay);if(b<a||(b-a)/dayMs>=366)throw Error('INVALID_AUDIT_PERIOD');
 auditFilters(filters.action??'all',filters.resourceId??'all');if(actorId!==null)auditActor(actorId);return {startDay,endDay,actorId,filters};
}
export function auditPeriodSearchPath(period:AuditPeriod,token:string|null=null):string{
 auditPeriod(period.startDay,period.endDay,period.actorId,period.filters);if(token!==null&&!/^[A-Za-z0-9_-]{124}$/.test(token))throw Error('INVALID_AUDIT_PERIOD_CURSOR');
 return '/backend/audit-period-search/'+period.startDay+'/'+period.endDay+'/'+(period.actorId??'all')+'/'+(period.filters.action??'all')+'/'+(period.filters.resourceId??'all')+(token?'/'+token:'');
}
async function boundary(token:string,user:Identity,period:AuditPeriod):Promise<string>{
 if(!/^[A-Za-z0-9_-]{124}$/.test(token))throw Error('INVALID_AUDIT_PERIOD_CURSOR');
 const raw=Uint8Array.from(atob(token.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
 const text='audit-period-start='+period.startDay+';end='+period.endDay+';actor='+(period.actorId??'all')+';action='+(period.filters.action??'all')+';resource='+(period.filters.resourceId??'all');
 const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)));
 if(raw.length!==93||raw[0]!==2||hash.some((v,i)=>v!==raw[i+1])||btoa(String.fromCharCode(...raw)).replaceAll('+','-').replaceAll('/','_')!==token)throw Error('INVALID_AUDIT_PERIOD_BINDING');
 const seconds=new DataView(raw.buffer).getBigInt64(65);if(seconds<BigInt(day(period.startDay)/1000)||seconds>=BigInt((day(period.endDay)+dayMs)/1000))throw Error('INVALID_AUDIT_PERIOD_BOUNDARY');
 const legacy=btoa(String.fromCharCode(...raw.slice(33))).replaceAll('+','-').replaceAll('/','_');
 auditPage({organizationId:user.organizationId,projectId:user.projectId,entries:[],nextCursor:null,limit:25,ordering:'created-at-id-desc',deploymentAuthority:false},user,legacy);return legacy;
}
export async function auditPeriodSearchPage(value:unknown,user:Identity,period:AuditPeriod,requestedCursor:string|null=null):Promise<AuditPage>{
 auditPeriod(period.startDay,period.endDay,period.actorId,period.filters);
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('INVALID_AUDIT_PERIOD_PAGE');const page=value as Record<string,unknown>;
 if(Object.keys(page).sort().join(',')!=='actorId,deploymentAuthority,endDay,entries,filters,limit,nextCursor,ordering,organizationId,projectId,startDay'||page.actorId!==period.actorId||page.startDay!==period.startDay||page.endDay!==period.endDay)throw Error('INVALID_AUDIT_PERIOD_BINDING');
 const actual=page.filters;if(!actual||typeof actual!=='object'||Array.isArray(actual))throw Error('INVALID_AUDIT_FILTER_BINDING');const f=actual as Record<string,unknown>;
 if(Object.keys(f).sort().join(',')!=='action,resourceId'||f.action!==period.filters.action||f.resourceId!==period.filters.resourceId)throw Error('INVALID_AUDIT_FILTER_BINDING');
 if(page.nextCursor!==null&&typeof page.nextCursor!=='string')throw Error('INVALID_AUDIT_PERIOD_CURSOR');
 const requested=requestedCursor===null?null:await boundary(requestedCursor,user,period),next=page.nextCursor===null?null:await boundary(page.nextCursor as string,user,period);
 const parsed=auditPage({organizationId:page.organizationId,projectId:page.projectId,entries:page.entries,nextCursor:next,limit:page.limit,ordering:page.ordering,deploymentAuthority:page.deploymentAuthority},user,requested);
 const start=day(period.startDay),end=day(period.endDay)+dayMs;
 if(parsed.entries.some(e=>Date.parse(e.createdAt)<start||Date.parse(e.createdAt)>=end||period.actorId!==null&&e.actorId!==period.actorId||f.action!==null&&e.action!==f.action||f.resourceId!==null&&e.resourceId!==f.resourceId))throw Error('INVALID_AUDIT_PERIOD_ROWS');
 return {entries:parsed.entries,nextCursor:page.nextCursor as string|null};
}
