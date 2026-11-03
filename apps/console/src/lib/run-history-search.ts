import {runHistoryPage,filterRunHistoryPage,type RunHistoryPage,type RunHistoryFilter} from './run-history.ts';
import type {Identity} from './contracts.ts';
export type RunHistorySearchFilters=Required<RunHistoryFilter>;
export const allRunHistorySearchFilters:RunHistorySearchFilters={scenario:'all',approval:'all',state:'all',decision:'all',provider:'all'};
export function runHistorySearchFilters(value:unknown):RunHistorySearchFilters{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('INVALID_RUN_SEARCH_FILTERS');
 const raw=value as Record<string,unknown>;
 if(Object.keys(raw).sort().join(',')!=='approval,decision,provider,scenario,state')throw Error('INVALID_RUN_SEARCH_FILTERS');
 const filters=raw as RunHistorySearchFilters;filterRunHistoryPage({entries:[],nextCursor:null},filters);
 if(Object.values(filters).some(value=>typeof value!=='string'))throw Error('INVALID_RUN_SEARCH_FILTERS');
 return {scenario:filters.scenario,approval:filters.approval,state:filters.state,decision:filters.decision,provider:filters.provider};
}
/** Relative BFF path; every condition has a fixed enum grammar and no query. */
export function runHistorySearchPath(value:RunHistorySearchFilters,token:string|null=null):string{
 const filters=runHistorySearchFilters(value);
 if(token!==null&&!/^[A-Za-z0-9_-]{128}$/.test(token))throw Error('INVALID_RUN_SEARCH_CURSOR');
 return 'run-history-search/'+[filters.scenario,filters.approval,filters.state,filters.decision,filters.provider].join('/')+(token?'/'+token:'');
}
async function boundary(token:string,user:Identity,filters:RunHistorySearchFilters):Promise<string>{
 if(!/^[A-Za-z0-9_-]{128}$/.test(token))throw Error('INVALID_RUN_SEARCH_CURSOR');
 const raw=Uint8Array.from(atob(token.replaceAll('-','+').replaceAll('_','/')),character=>character.charCodeAt(0));
 if(raw.length!==96||raw[0]!==1||btoa(String.fromCharCode(...raw)).replaceAll('+','-').replaceAll('/','_')!==token)throw Error('INVALID_RUN_SEARCH_CURSOR');
 const canonical='scenario='+filters.scenario+';approval='+filters.approval+';state='+filters.state+';decision='+filters.decision+';provider='+filters.provider;
 const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical)));
 if(hash.some((value,index)=>raw[index+1]!==value))throw Error('INVALID_RUN_SEARCH_BINDING');
 const legacy=btoa(String.fromCharCode(...raw.slice(33))).replaceAll('+','-').replaceAll('/','_');
 runHistoryPage({organizationId:user.organizationId,projectId:user.projectId,entries:[],nextCursor:null,limit:25,ordering:'created-at-id-desc',deploymentAuthority:false},user,legacy);
 return legacy;
}
export async function runHistorySearchPage(value:unknown,user:Identity,requested:RunHistorySearchFilters,requestedCursor:string|null=null):Promise<RunHistoryPage>{
 const filters=runHistorySearchFilters(requested);
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('INVALID_RUN_SEARCH');
 const page=value as Record<string,unknown>;
 if(Object.keys(page).sort().join(',')!=='deploymentAuthority,entries,filters,limit,nextCursor,ordering,organizationId,projectId')throw Error('INVALID_RUN_SEARCH');
 const actual=runHistorySearchFilters(page.filters);
 if(Object.keys(filters).some(key=>actual[key as keyof typeof filters]!==filters[key as keyof typeof filters]))throw Error('INVALID_RUN_SEARCH_BINDING');
 const requestedBoundary=requestedCursor===null?null:await boundary(requestedCursor,user,filters);
 if(page.nextCursor!==null&&typeof page.nextCursor!=='string')throw Error('INVALID_RUN_SEARCH_CURSOR');
 const next=page.nextCursor===null?null:await boundary(page.nextCursor as string,user,filters);
 const {filters:ignored,...legacy}=page;void ignored;
 const parsed=runHistoryPage({...legacy,nextCursor:next},user,requestedBoundary);
 if(filterRunHistoryPage(parsed,filters).length!==parsed.entries.length)throw Error('INVALID_RUN_SEARCH_BINDING');
 return {entries:parsed.entries,nextCursor:page.nextCursor as string|null};
}
