import type {Identity} from './contracts.ts';
import {versionHistoryPage,type VersionHistoryPage,type VersionKind} from './version-history.ts';
export type RegisteredCatalog={agents:VersionHistoryPage;datasets:VersionHistoryPage};
export function registeredCatalog(value:unknown,user:Identity):RegisteredCatalog{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('INVALID_CATALOG');
 const v=value as Record<string,unknown>;
 if(Object.keys(v).sort().join(',')!=='agents,catalogKind,datasets,deploymentAuthority,organizationId,projectId'||v.organizationId!==user.organizationId||v.projectId!==user.projectId||v.catalogKind!=='registered-agent-dataset-versions-v1'||v.deploymentAuthority!==false)throw Error('INVALID_CATALOG_SCOPE');
 return {agents:versionHistoryPage(v.agents,user,'agents'),datasets:versionHistoryPage(v.datasets,user,'datasets')};
}
export function catalogEntries(catalog:RegisteredCatalog,kind:VersionKind|'all',name:string){
 if(name.length>64)throw Error('INVALID_CATALOG_FILTER');
 return (['agents','datasets'] as const).filter(k=>kind==='all'||k===kind).flatMap(k=>catalog[k].entries.filter(row=>row.resource_key.includes(name)).map(row=>({kind:k,row})));
}
