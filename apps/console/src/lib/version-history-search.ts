import type {Identity} from './contracts.ts';
import {versionHistoryPage,type VersionKind,type VersionHistoryPage} from './version-history.ts';
export function versionResourceKey(value:string):string{if(typeof value!=='string'||!/^[a-z][a-z0-9-]{2,63}$/.test(value))throw Error('INVALID_VERSION_SEARCH_NAME');return value;}
export function versionHistorySearchPath(kind:VersionKind,name:string,token:string|null=null):string{
 if(!['agents','datasets'].includes(kind)||token!==null&&!/^[A-Za-z0-9_-]{128}$/.test(token))throw Error('INVALID_VERSION_SEARCH_PATH');
 return 'version-history-search/'+kind+'/'+versionResourceKey(name)+(token?'/'+token:'');
}
async function boundary(token:string,name:string):Promise<string>{
 if(!/^[A-Za-z0-9_-]{128}$/.test(token))throw Error('INVALID_VERSION_SEARCH_CURSOR');
 const raw=Uint8Array.from(atob(token.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
 if(raw.length!==96||raw[0]!==1||btoa(String.fromCharCode(...raw)).replaceAll('+','-').replaceAll('/','_')!==token)throw Error('INVALID_VERSION_SEARCH_CURSOR');
 const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('version-resource-key='+versionResourceKey(name))));
 if(hash.some((v,i)=>raw[i+1]!==v))throw Error('INVALID_VERSION_SEARCH_BINDING');
 return btoa(String.fromCharCode(...raw.slice(33))).replaceAll('+','-').replaceAll('/','_');
}
export async function versionHistorySearchPage(value:unknown,user:Identity,kind:VersionKind,name:string,token:string|null=null):Promise<VersionHistoryPage>{
 versionResourceKey(name);
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('INVALID_VERSION_SEARCH');
 const page=value as Record<string,unknown>;
 if(Object.keys(page).sort().join(',')!=='deploymentAuthority,entries,kind,limit,nextCursor,ordering,organizationId,projectId,resourceKey'||page.resourceKey!==name||page.nextCursor!==null&&typeof page.nextCursor!=='string')throw Error('INVALID_VERSION_SEARCH_BINDING');
 const requested=token===null?null:await boundary(token,name),next=page.nextCursor===null?null:await boundary(page.nextCursor as string,name);
 const {resourceKey:ignored,...legacy}=page;void ignored;
 const parsed=versionHistoryPage({...legacy,nextCursor:next},user,kind,requested);
 if(parsed.entries.some(row=>row.resource_key!==name))throw Error('INVALID_VERSION_SEARCH_BINDING');
 return {entries:parsed.entries,nextCursor:page.nextCursor as string|null};
}
