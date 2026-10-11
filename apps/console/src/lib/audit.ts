import type {Identity} from './contracts';
export type AuditEntry={id:string;actorId:string;action:string;resourceId:string;createdAt:string};
export type AuditPage={entries:AuditEntry[];nextCursor:string|null};
export type AuditExport={contentJson:string;contentSha256:string;contentBytes:number;recordCount:number;hasOlderRecords:boolean;entireProjectHistory:boolean};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw Error('INVALID_AUDIT');return value as Record<string,unknown>}
function id(value:unknown):string{if(typeof value!=='string'||!uuid.test(value))throw Error('INVALID_AUDIT');return value}
function time(value:unknown):{text:string;seconds:bigint;nanos:number}{
 if(typeof value!=='string')throw Error('INVALID_AUDIT');const match=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(value);if(!match)throw Error('INVALID_AUDIT');
 const millis=Date.parse(match[1]+'Z'),nanos=Number((match[2]??'').padEnd(9,'0'));if(!Number.isFinite(millis)||millis<0||new Date(millis).toISOString()!==match[1]+'.000Z'||nanos%1000!==0)throw Error('INVALID_AUDIT');
 return {text:match[1]+'.'+String(nanos).padStart(9,'0')+'Z',seconds:BigInt(millis/1000),nanos};
}
function cursor(token:string,user:Identity):{id:string;seconds:bigint;nanos:number}{
 if(!/^[A-Za-z0-9_-]{80}$/.test(token))throw Error('INVALID_AUDIT_CURSOR');const raw=atob(token.replaceAll('-','+').replaceAll('_','/')),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
 const uuidAt=(offset:number)=>{const hex=Array.from(bytes.slice(offset,offset+16),b=>b.toString(16).padStart(2,'0')).join('');return hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20)};
 if(bytes.length!==60||uuidAt(0)!==user.organizationId||uuidAt(16)!==user.projectId)throw Error('INVALID_AUDIT_SCOPE');const view=new DataView(bytes.buffer),seconds=view.getBigInt64(32),nanos=view.getInt32(40);
 if(seconds<0n||seconds>253402300799n||nanos<0||nanos>=1e9||nanos%1000!==0)throw Error('INVALID_AUDIT_CURSOR');return {id:uuidAt(44),seconds,nanos};
}
export function auditPage(value:unknown,user:Identity,requestedCursor:string|null=null):AuditPage{
 const page=object(value);if(Object.keys(page).sort().join(',')!=='deploymentAuthority,entries,limit,nextCursor,ordering,organizationId,projectId')throw Error('INVALID_AUDIT');if(page.organizationId!==user.organizationId||page.projectId!==user.projectId||page.limit!==25||page.ordering!=='created-at-id-desc'||page.deploymentAuthority!==false||!Array.isArray(page.entries)||page.entries.length>25)throw Error('INVALID_AUDIT_SCOPE');
 const seen=new Set<string>();let previous:AuditEntry|null=null;const boundary=requestedCursor===null?null:cursor(requestedCursor,user);
 const entries=page.entries.map(raw=>{const row=object(raw);if(Object.keys(row).sort().join(',')!=='action,actorId,createdAt,id,resourceId'||typeof row.action!=='string'||!/^[a-z][a-z0-9.-]{0,59}$/.test(row.action))throw Error('INVALID_AUDIT');const entry={id:id(row.id),actorId:id(row.actorId),resourceId:id(row.resourceId),action:row.action,createdAt:typeof row.createdAt==='string'?row.createdAt:''},at=time(entry.createdAt);
  if(seen.has(entry.id)||previous&&(at.text>time(previous.createdAt).text||at.text===time(previous.createdAt).text&&entry.id>=previous.id))throw Error('INVALID_AUDIT_ORDER');
  if(boundary&&(at.seconds>boundary.seconds||at.seconds===boundary.seconds&&(at.nanos>boundary.nanos||at.nanos===boundary.nanos&&entry.id>=boundary.id)))throw Error('INVALID_AUDIT_BOUNDARY');seen.add(entry.id);previous=entry;return entry;
 });
 if(page.nextCursor!==null){if(typeof page.nextCursor!=='string'||entries.length!==25)throw Error('INVALID_AUDIT_CURSOR');const next=cursor(page.nextCursor,user),last=entries.at(-1)!,at=time(last.createdAt);if(next.id!==last.id||next.seconds!==at.seconds||next.nanos!==at.nanos)throw Error('INVALID_AUDIT_CURSOR');}
 return {entries,nextCursor:page.nextCursor as string|null};
}

/** Hash checks downloaded bytes; this unsigned export does not authenticate an independent issuer. */
export async function auditExport(value:unknown,user:Identity):Promise<AuditExport>{
 const frame=object(value);if(Object.keys(frame).sort().join(',')!=='contentBytes,contentJson,contentSha256,currentDeploymentAuthority,organizationId,projectId,signed'||frame.organizationId!==user.organizationId||frame.projectId!==user.projectId||frame.signed!==false||frame.currentDeploymentAuthority!==false||typeof frame.contentJson!=='string'||frame.contentJson.length>262144||typeof frame.contentSha256!=='string'||!/^[a-f0-9]{64}$/.test(frame.contentSha256))throw Error('INVALID_AUDIT_EXPORT');
 const bytes=new TextEncoder().encode(frame.contentJson);if(bytes.length<1||bytes.length>262144||bytes.length!==frame.contentBytes)throw Error('INVALID_AUDIT_EXPORT');
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');if(hash!==frame.contentSha256)throw Error('INVALID_AUDIT_EXPORT_HASH');
 const doc=object(JSON.parse(frame.contentJson));if(Object.keys(doc).sort().join(',')!=='currentDeploymentAuthority,entireProjectHistory,entries,hasOlderRecords,kind,limit,newestCursor,oldestCursor,ordering,organizationId,projectId,recordCount,schemaVersion,signed'||doc.schemaVersion!==1||doc.kind!=='project-audit-export'||doc.organizationId!==user.organizationId||doc.projectId!==user.projectId||doc.limit!==500||doc.ordering!=='created-at-id-desc'||doc.signed!==false||doc.currentDeploymentAuthority!==false||!Array.isArray(doc.entries)||doc.entries.length>500||doc.recordCount!==doc.entries.length||typeof doc.hasOlderRecords!=='boolean'||doc.entireProjectHistory!==!doc.hasOlderRecords||doc.hasOlderRecords&&doc.entries.length!==500)throw Error('INVALID_AUDIT_EXPORT');
 const seen=new Set<string>();let previous:AuditEntry|null=null;
 for(let offset=0;offset<doc.entries.length;offset+=25){const parsed=auditPage({organizationId:user.organizationId,projectId:user.projectId,entries:doc.entries.slice(offset,offset+25),nextCursor:null,limit:25,ordering:'created-at-id-desc',deploymentAuthority:false},user);
  for(const entry of parsed.entries){if(seen.has(entry.id)||previous&&(time(entry.createdAt).text>time(previous.createdAt).text||time(entry.createdAt).text===time(previous.createdAt).text&&entry.id>=previous.id))throw Error('INVALID_AUDIT_EXPORT_ORDER');seen.add(entry.id);previous=entry;}
 }
 const bind=(token:unknown,raw:unknown)=>{if(typeof token!=='string')throw Error('INVALID_AUDIT_EXPORT_BOUNDARY');const boundary=cursor(token,user),entry=object(raw),at=time(entry.createdAt);if(boundary.id!==entry.id||boundary.seconds!==at.seconds||boundary.nanos!==at.nanos)throw Error('INVALID_AUDIT_EXPORT_BOUNDARY')};
 if(doc.entries.length){bind(doc.newestCursor,doc.entries[0]);bind(doc.oldestCursor,doc.entries.at(-1))}else if(doc.newestCursor!==null||doc.oldestCursor!==null||doc.hasOlderRecords)throw Error('INVALID_AUDIT_EXPORT_BOUNDARY');
 return {contentJson:frame.contentJson,contentSha256:hash,contentBytes:bytes.length,recordCount:doc.entries.length,hasOlderRecords:doc.hasOlderRecords,entireProjectHistory:doc.entireProjectHistory as boolean};
}
