import {runs,type Run,type Identity} from './contracts.ts';
export type RunHistoryEntry=Run;
export type RunHistoryPage={entries:RunHistoryEntry[];nextCursor:string|null};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw Error('INVALID_RUN_HISTORY');return value as Record<string,unknown>}
function id(value:unknown):string{if(typeof value!=='string'||!uuid.test(value))throw Error('INVALID_RUN_HISTORY');return value}
function time(value:unknown):{text:string;seconds:bigint;nanos:number}{
 if(typeof value!=='string')throw Error('INVALID_RUN_HISTORY');const match=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(value);if(!match)throw Error('INVALID_RUN_HISTORY');
 const millis=Date.parse(match[1]+'Z'),nanos=Number((match[2]??'').padEnd(9,'0'));if(!Number.isFinite(millis)||millis<0||new Date(millis).toISOString()!==match[1]+'.000Z'||nanos%1000!==0)throw Error('INVALID_RUN_HISTORY');
 return {text:match[1]+'.'+String(nanos).padStart(9,'0')+'Z',seconds:BigInt(millis/1000),nanos};
}
function cursor(token:string,user:Identity):{id:string;seconds:bigint;nanos:number}{
 if(!/^[A-Za-z0-9_-]{84}$/.test(token))throw Error('INVALID_RUN_HISTORY_CURSOR');const raw=atob(token.replaceAll('-','+').replaceAll('_','/')),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
 const uuidAt=(offset:number)=>{const hex=Array.from(bytes.slice(offset,offset+16),b=>b.toString(16).padStart(2,'0')).join('');return hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20)};
 if(bytes.length!==63||bytes[0]!==82||bytes[1]!==85||bytes[2]!==78||uuidAt(3)!==user.organizationId||uuidAt(19)!==user.projectId)throw Error('INVALID_RUN_HISTORY_SCOPE');const view=new DataView(bytes.buffer),seconds=view.getBigInt64(35),nanos=view.getInt32(43);
 if(seconds<0n||seconds>253402300799n||nanos<0||nanos>=1e9||nanos%1000!==0)throw Error('INVALID_RUN_HISTORY_CURSOR');return {id:uuidAt(47),seconds,nanos};
}
export function runHistoryPage(value:unknown,user:Identity,requestedCursor:string|null=null):RunHistoryPage{
 const page=object(value);if(Object.keys(page).sort().join(',')!=='deploymentAuthority,entries,limit,nextCursor,ordering,organizationId,projectId')throw Error('INVALID_RUN_HISTORY');if(page.organizationId!==user.organizationId||page.projectId!==user.projectId||page.limit!==25||page.ordering!=='created-at-id-desc'||page.deploymentAuthority!==false||!Array.isArray(page.entries)||page.entries.length>25)throw Error('INVALID_RUN_HISTORY_SCOPE');
 const seen=new Set<string>();let previous:RunHistoryEntry|null=null;const boundary=requestedCursor===null?null:cursor(requestedCursor,user);
 const entries=page.entries.map(raw=>{const row=object(raw);if(Object.keys(row).sort().join(',')!=='createdAt,decision,id,provider,requiresApproval,scenario,state')throw Error('INVALID_RUN_HISTORY');const entry=runs([{id:row.id,provider:row.provider,scenario:row.scenario,requires_approval:row.requiresApproval,state:row.state,decision:row.decision,created_at:row.createdAt}])[0],at=time(entry.created_at);
  if(seen.has(entry.id)||previous&&(at.text>time(previous.created_at).text||at.text===time(previous.created_at).text&&entry.id>=previous.id))throw Error('INVALID_RUN_HISTORY_ORDER');
  if(boundary&&(at.seconds>boundary.seconds||at.seconds===boundary.seconds&&(at.nanos>boundary.nanos||at.nanos===boundary.nanos&&entry.id>=boundary.id)))throw Error('INVALID_RUN_HISTORY_BOUNDARY');seen.add(entry.id);previous=entry;return entry;
 });
 if(page.nextCursor!==null){if(typeof page.nextCursor!=='string'||entries.length!==25)throw Error('INVALID_RUN_HISTORY_CURSOR');const next=cursor(page.nextCursor,user),last=entries.at(-1)!,at=time(last.created_at);if(next.id!==last.id||next.seconds!==at.seconds||next.nanos!==at.nanos)throw Error('INVALID_RUN_HISTORY_CURSOR');}
 return {entries,nextCursor:page.nextCursor as string|null};
}
