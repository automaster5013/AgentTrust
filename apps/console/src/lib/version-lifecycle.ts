import type {Identity,Gate} from './contracts.ts';
import type {Campaign} from './campaign-contracts.ts';
import type {ReleaseRequirements} from './release-requirements.ts';
export type VersionLifecycle={kind:'agents'|'datasets';versionId:string;contentSha256:string;state:'active'|'retired';retiredBy?:string;reason?:string;retiredAt?:string};
export type CampaignLifecycle={versions:VersionLifecycle[]};
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw Error('INVALID_VERSION_LIFECYCLE');return value as Record<string,unknown>}
function uuid(value:unknown):string{if(typeof value!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value))throw Error('INVALID_VERSION_LIFECYCLE');return value}
function retirementTime(value:unknown):boolean{
 if(typeof value!=='string')return false;
 const match=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d{1,9})?Z$/.exec(value);
 if(!match)return false;
 const millis=Date.parse(match[1]+'Z');
 return Number.isFinite(millis)&&new Date(millis).toISOString()===match[1]+'.000Z';
}
export function versionLifecycle(value:unknown,user:Identity,kind:'agents'|'datasets',versionId:string,contentSha256:string):VersionLifecycle{
 const doc=object(value);
 if(doc.contract!=='version-lifecycle-v1'||doc.organizationId!==user.organizationId||doc.projectId!==user.projectId||doc.kind!==kind||doc.versionId!==versionId||doc.contentSha256!==contentSha256||doc.deploymentAuthority!==false||!['active','retired'].includes(String(doc.state))||!/^[a-f0-9]{64}$/.test(contentSha256))throw Error('INVALID_VERSION_LIFECYCLE_SCOPE');
 uuid(doc.versionId);
 if(doc.state==='active'){if(Object.keys(doc).length!==8)throw Error('INVALID_VERSION_LIFECYCLE');return {kind,versionId,contentSha256,state:'active'}}
 if(Object.keys(doc).length!==11||typeof doc.reason!=='string'||!doc.reason.trim()||doc.reason.length>500||typeof doc.retiredAt!=='string'||!retirementTime(doc.retiredAt))throw Error('INVALID_VERSION_LIFECYCLE');
 return {kind,versionId,contentSha256,state:'retired',retiredBy:uuid(doc.retiredBy),reason:doc.reason,retiredAt:doc.retiredAt};
}
export function campaignLifecycle(value:unknown,user:Identity,record:Campaign,requirements?:ReleaseRequirements):CampaignLifecycle{
 const doc=object(value),bound=requirements?.enabled===true;
 if(Object.keys(doc).length!==6||doc.contract!=='campaign-version-lifecycle-v1'||doc.campaignId!==record.id||doc.organizationId!==user.organizationId||doc.projectId!==user.projectId||doc.deploymentAuthority!==false||!Array.isArray(doc.versions)||doc.versions.length!==(bound?4:2))throw Error('INVALID_CAMPAIGN_LIFECYCLE');
 const expected:[ 'agents'|'datasets',string,string][]=[['agents',record.agent_version_id,record.agent_content_sha256],['datasets',record.dataset_version_id,record.dataset_content_sha256]];
 if(bound)expected.push(['agents',requirements.baselineAgentVersionId,requirements.baselineAgentContentSha256],['datasets',record.dataset_version_id,record.dataset_content_sha256]);
 const versions=doc.versions.map((item,i)=>versionLifecycle(item,user,...expected[i]));
 const states=new Map<string,string>();for(const item of versions){const key=item.kind+'/'+item.versionId,prior=states.get(key);if(prior!==undefined&&prior!==JSON.stringify(item))throw Error('INCONSISTENT_VERSION_LIFECYCLE');states.set(key,JSON.stringify(item));}
 return {versions};
}
export function verifyLifecyclePermission(lifecycle:CampaignLifecycle,gate:Gate,observedAt:number){for(const version of lifecycle.versions){if(version.state==='retired'&&(Date.parse(version.retiredAt!)>observedAt||gate.deploymentAllowed))throw Error('INVALID_VERSION_LIFECYCLE_PERMISSION')}}
