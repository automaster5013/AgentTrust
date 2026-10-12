import {auditPage,type AuditPage,type AuditEntry} from './audit.ts';
import type {Identity} from './contracts.ts';
export const auditActions=['evaluation.queued','evaluation.completed','evaluation.cancelled','review.approved','review.rejected','version.agents.registered','version.datasets.registered','version.agents.retired','version.datasets.retired','campaign.queued','campaign.cancelled','campaign.review.approved','campaign.review.rejected','campaign.observation.signed'] as const;
export type AuditFilters={action:string|null;resourceId:string|null};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function auditRunTarget(entry:Pick<AuditEntry,'action'|'resourceId'>):string|null{
 return ['evaluation.queued','evaluation.completed','evaluation.cancelled','review.approved','review.rejected'].includes(entry.action)&&uuid.test(entry.resourceId)?entry.resourceId:null;
}
export function auditFilters(action:string,resource:string):AuditFilters{
 if(action!=='all'&&!auditActions.some(value=>value===action)||resource!==''&&resource!=='all'&&!uuid.test(resource))throw Error('INVALID_AUDIT_FILTER');
 return {action:action==='all'?null:action,resourceId:resource===''||resource==='all'?null:resource};
}
export function auditSearchPath(filters:AuditFilters,token:string|null=null){
 auditFilters(filters.action??'all',filters.resourceId??'all');if(token!==null&&!/^[A-Za-z0-9_-]{124}$/.test(token))throw Error('INVALID_AUDIT_CURSOR');
 return '/backend/audit-search/'+(filters.action??'all')+'/'+(filters.resourceId??'all')+(token?'/'+token:'');
}
async function boundary(token:string,user:Identity,filters:AuditFilters){
 if(!/^[A-Za-z0-9_-]{124}$/.test(token))throw Error('INVALID_AUDIT_CURSOR');
 const raw=Uint8Array.from(atob(token.replaceAll('-','+').replaceAll('_','/')),character=>character.charCodeAt(0));
 if(raw.length!==93||raw[0]!==1||btoa(String.fromCharCode(...raw)).replaceAll('+','-').replaceAll('/','_')!==token)throw Error('INVALID_AUDIT_CURSOR');
 const expected=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('action='+(filters.action??'all')+';resource='+(filters.resourceId??'all'))));
 if(expected.some((value,index)=>value!==raw[index+1]))throw Error('INVALID_AUDIT_FILTER_BINDING');
 const legacy=btoa(String.fromCharCode(...raw.slice(33))).replaceAll('+','-').replaceAll('/','_');
 // Existing exact microsecond and tenant checks apply to the enclosed boundary.
 auditPage({organizationId:user.organizationId,projectId:user.projectId,entries:[],nextCursor:null,limit:25,ordering:'created-at-id-desc',deploymentAuthority:false},user,legacy);
 return legacy;
}
export async function auditSearchPage(value:unknown,user:Identity,filters:AuditFilters,requestedCursor:string|null=null):Promise<AuditPage>{
 auditFilters(filters.action??'all',filters.resourceId??'all');
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('INVALID_AUDIT_SEARCH');const page=value as Record<string,unknown>;
 if(Object.keys(page).sort().join(',')!=='deploymentAuthority,entries,filters,limit,nextCursor,ordering,organizationId,projectId')throw Error('INVALID_AUDIT_SEARCH');
 const returned=page.filters;if(!returned||typeof returned!=='object'||Array.isArray(returned))throw Error('INVALID_AUDIT_FILTER_BINDING');const actual=returned as Record<string,unknown>;
 if(Object.keys(actual).sort().join(',')!=='action,resourceId'||actual.action!==filters.action||actual.resourceId!==filters.resourceId)throw Error('INVALID_AUDIT_FILTER_BINDING');
 const requested=requestedCursor===null?null:await boundary(requestedCursor,user,filters);
 if(page.nextCursor!==null&&typeof page.nextCursor!=='string')throw Error('INVALID_AUDIT_CURSOR');
 const next=page.nextCursor===null?null:await boundary(page.nextCursor as string,user,filters);
 const {filters:ignored,...legacy}=page;void ignored;const parsed=auditPage({...legacy,nextCursor:next},user,requested);
 if(parsed.entries.some(entry=>filters.action!==null&&entry.action!==filters.action||filters.resourceId!==null&&entry.resourceId!==filters.resourceId))throw Error('INVALID_AUDIT_FILTER_BINDING');
 return {entries:parsed.entries,nextCursor:page.nextCursor as string|null};
}
