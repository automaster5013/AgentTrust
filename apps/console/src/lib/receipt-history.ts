import type {Identity} from './contracts.ts';
export type ReceiptHistoryEntry={id:string;campaignId:string;keyId:string;createdAt:string};
export type ReceiptHistoryPage={entries:ReceiptHistoryEntry[];nextCursor:string|null};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw Error('INVALID_RECEIPT_HISTORY');return value as Record<string,unknown>}
function id(value:unknown):string{if(typeof value!=='string'||!uuid.test(value))throw Error('INVALID_RECEIPT_HISTORY');return value}
function time(value:unknown):{text:string;seconds:bigint;nanos:number}{
 if(typeof value!=='string')throw Error('INVALID_RECEIPT_HISTORY');const match=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(value);if(!match)throw Error('INVALID_RECEIPT_HISTORY');
 const millis=Date.parse(match[1]+'Z'),nanos=Number((match[2]??'').padEnd(9,'0'));if(!Number.isFinite(millis)||millis<0||new Date(millis).toISOString()!==match[1]+'.000Z'||nanos%1000!==0)throw Error('INVALID_RECEIPT_HISTORY');
 return {text:match[1]+'.'+String(nanos).padStart(9,'0')+'Z',seconds:BigInt(millis/1000),nanos};
}
function cursor(token:string,user:Identity,campaign:string|null):{id:string;seconds:bigint;nanos:number}{
 if(!/^[A-Za-z0-9_-]{107}$/.test(token))throw Error('INVALID_RECEIPT_HISTORY_CURSOR');const raw=atob(token.replaceAll('-','+').replaceAll('_','/')),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
 if(btoa(raw).replaceAll('+','-').replaceAll('/','_').replaceAll('=','')!==token)throw Error('INVALID_RECEIPT_HISTORY_CURSOR');
 const uuidAt=(offset:number)=>{const hex=Array.from(bytes.slice(offset,offset+16),b=>b.toString(16).padStart(2,'0')).join('');return hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20)};
 if(bytes.length!==80||bytes[0]!==82||bytes[1]!==67||bytes[2]!==80||uuidAt(3)!==user.organizationId||uuidAt(19)!==user.projectId||bytes[35]!==Number(campaign!==null)||uuidAt(36)!==(campaign??'00000000-0000-0000-0000-000000000000'))throw Error('INVALID_RECEIPT_HISTORY_SCOPE');
 const view=new DataView(bytes.buffer),seconds=view.getBigInt64(52),nanos=view.getInt32(60);
 if(seconds<0n||seconds>253402300799n||nanos<0||nanos>=1e9||nanos%1000!==0)throw Error('INVALID_RECEIPT_HISTORY_CURSOR');return {id:uuidAt(64),seconds,nanos};
}
export function receiptHistoryPage(value:unknown,user:Identity,campaign:string|null=null,requestedCursor:string|null=null):ReceiptHistoryPage{
 if(campaign!==null)id(campaign);const page=object(value);
 if(Object.keys(page).sort().join(',')!=='campaignId,contract,deploymentAuthority,entries,limit,nextCursor,ordering,organizationId,projectId,signatureVerificationPerformed'||page.contract!=='project-receipt-history-v1'||page.signatureVerificationPerformed!==false||page.organizationId!==user.organizationId||page.projectId!==user.projectId||page.campaignId!==campaign||page.limit!==25||page.ordering!=='created-at-id-desc'||page.deploymentAuthority!==false||!Array.isArray(page.entries)||page.entries.length>25)throw Error('INVALID_RECEIPT_HISTORY_SCOPE');
 const seen=new Set<string>();let previous:ReceiptHistoryEntry|null=null;const boundary=requestedCursor===null?null:cursor(requestedCursor,user,campaign);
 const entries=page.entries.map(raw=>{const row=object(raw);if(Object.keys(row).sort().join(',')!=='campaignId,createdAt,id,keyId'||typeof row.keyId!=='string'||!/^[a-f0-9]{64}$/.test(row.keyId))throw Error('INVALID_RECEIPT_HISTORY');
  const at=time(row.createdAt),entry={id:id(row.id),campaignId:id(row.campaignId),keyId:row.keyId as string,createdAt:row.createdAt as string};
  if(campaign!==null&&entry.campaignId!==campaign||seen.has(entry.id)||previous&&(at.text>time(previous.createdAt).text||at.text===time(previous.createdAt).text&&entry.id>=previous.id))throw Error('INVALID_RECEIPT_HISTORY_ORDER');
  if(boundary&&(at.seconds>boundary.seconds||at.seconds===boundary.seconds&&(at.nanos>boundary.nanos||at.nanos===boundary.nanos&&entry.id>=boundary.id)))throw Error('INVALID_RECEIPT_HISTORY_BOUNDARY');seen.add(entry.id);previous=entry;return entry;
 });
 if(page.nextCursor!==null){if(typeof page.nextCursor!=='string'||entries.length!==25)throw Error('INVALID_RECEIPT_HISTORY_CURSOR');const next=cursor(page.nextCursor,user,campaign),last=entries.at(-1)!,at=time(last.createdAt);if(next.id!==last.id||next.seconds!==at.seconds||next.nanos!==at.nanos)throw Error('INVALID_RECEIPT_HISTORY_CURSOR');}
 return {entries,nextCursor:page.nextCursor as string|null};
}
