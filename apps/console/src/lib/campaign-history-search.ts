import {campaignHistoryPage,filterCampaignHistoryPage,type CampaignHistoryFilter,type CampaignHistoryPage} from './campaign-history.ts';
import type {Identity} from './contracts.ts';
export type CampaignHistorySearchFilters=CampaignHistoryFilter;
export const allCampaignHistorySearchFilters:CampaignHistorySearchFilters={approval:'all',agentVersionId:null};
export function campaignHistorySearchFilters(value:unknown):CampaignHistorySearchFilters{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='agentVersionId,approval')throw Error('INVALID_CAMPAIGN_SEARCH_FILTER');
 const filters=value as CampaignHistorySearchFilters;filterCampaignHistoryPage({entries:[],nextCursor:null},filters);return {approval:filters.approval,agentVersionId:filters.agentVersionId};
}
function datasetId(value:string|null){if(value!==null&&!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value))throw Error('INVALID_CAMPAIGN_SEARCH_DATASET');return value;}
export function campaignHistorySearchPath(filters:CampaignHistorySearchFilters,dataset:string|null,token:string|null=null){
 const valid=campaignHistorySearchFilters(filters);datasetId(dataset);
 if(token!==null&&!/^[A-Za-z0-9_-]{151}$/.test(token))throw Error('INVALID_CAMPAIGN_SEARCH_CURSOR');
 return 'campaign-history-search/'+[dataset??'all',valid.approval,valid.agentVersionId??'all'].join('/')+(token?'/'+token:'');
}
async function boundary(token:string,user:Identity,dataset:string|null,filters:CampaignHistorySearchFilters){
 if(!/^[A-Za-z0-9_-]{151}$/.test(token))throw Error('INVALID_CAMPAIGN_SEARCH_CURSOR');
 const raw=Uint8Array.from(atob(token.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
 if(raw.length!==113||raw[0]!==1||btoa(String.fromCharCode(...raw)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','')!==token)throw Error('INVALID_CAMPAIGN_SEARCH_CURSOR');
 const canonical='campaign-search-v1;approval='+filters.approval+';agent='+(filters.agentVersionId??'all');
 const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical)));
 if(digest.some((value,index)=>value!==raw[index+1]))throw Error('INVALID_CAMPAIGN_SEARCH_BINDING');
 const legacy=btoa(String.fromCharCode(...raw.slice(33))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
 campaignHistoryPage({organizationId:user.organizationId,projectId:user.projectId,datasetVersionId:dataset,entries:[],nextCursor:null,limit:25,ordering:'created-at-id-desc',deploymentAuthority:false},user,dataset,legacy);
 return legacy;
}
export async function campaignHistorySearchPage(value:unknown,user:Identity,requested:CampaignHistorySearchFilters,dataset:string|null,requestedCursor:string|null=null):Promise<CampaignHistoryPage>{
 const filters=campaignHistorySearchFilters(requested);datasetId(dataset);
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('INVALID_CAMPAIGN_SEARCH');
 const page=value as Record<string,unknown>;
 if(Object.keys(page).sort().join(',')!=='datasetVersionId,deploymentAuthority,entries,filters,limit,nextCursor,ordering,organizationId,projectId')throw Error('INVALID_CAMPAIGN_SEARCH');
 const actual=campaignHistorySearchFilters(page.filters);
 if(actual.approval!==filters.approval||actual.agentVersionId!==filters.agentVersionId)throw Error('INVALID_CAMPAIGN_SEARCH_BINDING');
 const requestedBoundary=requestedCursor===null?null:await boundary(requestedCursor,user,dataset,filters);
 if(page.nextCursor!==null&&typeof page.nextCursor!=='string')throw Error('INVALID_CAMPAIGN_SEARCH_CURSOR');
 const next=page.nextCursor===null?null:await boundary(page.nextCursor as string,user,dataset,filters);
 const {filters:ignored,...legacy}=page;void ignored;
 const result=campaignHistoryPage({...legacy,nextCursor:next},user,dataset,requestedBoundary);
 if(filterCampaignHistoryPage(result,filters).length!==result.entries.length)throw Error('INVALID_CAMPAIGN_SEARCH_BINDING');
 return {entries:result.entries,nextCursor:page.nextCursor as string|null};
}
