import {verifiedCampaign,type Campaign,type Version} from './campaign-contracts.ts';
import {releaseRequirements} from './release-requirements.ts';
import type {Identity} from './contracts.ts';
export type CampaignCreateInput={agentVersionId:string;datasetVersionId:string;requiresApproval:boolean;baselineCampaignId:string|null;evidenceMaxAgeSeconds:number|null};
export type CampaignCreateIntent={requestKey:string;organizationId:string;projectId:string;actorId:string;input:CampaignCreateInput;agentContentSha256:string;datasetContentSha256:string};
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw Error('INVALID_CAMPAIGN_INTENT');return value as Record<string,unknown>}
function uuid(value:unknown):string{if(typeof value!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value))throw Error('INVALID_CAMPAIGN_INTENT');return value}
function hash(value:unknown):string{if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))throw Error('INVALID_CAMPAIGN_INTENT');return value}
export function campaignCreateIntent(user:Identity,agent:Pick<Version,'id'|'content_sha256'>,dataset:Pick<Version,'id'|'content_sha256'>,approval:unknown,baseline:unknown,maxAge:unknown,requestKey=crypto.randomUUID()):CampaignCreateIntent{
 if(typeof requestKey!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(requestKey)||typeof approval!=='boolean'||(baseline===null)!==(maxAge===null)||baseline!==null&&(typeof maxAge!=='number'||!Number.isInteger(maxAge)||maxAge<60||maxAge>86400))throw Error('INVALID_CAMPAIGN_INTENT');
 const input=Object.freeze({agentVersionId:uuid(agent.id),datasetVersionId:uuid(dataset.id),requiresApproval:approval,baselineCampaignId:baseline===null?null:uuid(baseline),evidenceMaxAgeSeconds:maxAge as number|null});
 return Object.freeze({requestKey,organizationId:uuid(user.organizationId),projectId:uuid(user.projectId),actorId:uuid(user.actorId),input,agentContentSha256:hash(agent.content_sha256),datasetContentSha256:hash(dataset.content_sha256)});
}
export function requireCampaignIntent(intent:CampaignCreateIntent,user:Identity):void{
 const i=object(intent),input=object(i.input);
 if(Object.keys(i).sort().join(',')!=='actorId,agentContentSha256,datasetContentSha256,input,organizationId,projectId,requestKey'||Object.keys(input).sort().join(',')!=='agentVersionId,baselineCampaignId,datasetVersionId,evidenceMaxAgeSeconds,requiresApproval'||intent.organizationId!==user.organizationId||intent.projectId!==user.projectId||intent.actorId!==user.actorId)throw Error('INVALID_CAMPAIGN_INTENT');
 campaignCreateIntent(user,{id:input.agentVersionId as string,content_sha256:intent.agentContentSha256},{id:input.datasetVersionId as string,content_sha256:intent.datasetContentSha256},input.requiresApproval,input.baselineCampaignId,input.evidenceMaxAgeSeconds,intent.requestKey);
}
export function verifiedCampaignRequest(value:unknown,intent:CampaignCreateIntent,user:Identity):string{
 requireCampaignIntent(intent,user);const frame=object(value);
 if(Object.keys(frame).sort().join(',')!=='actorId,campaignId,deploymentAuthority,organizationId,projectId,requestKey'||frame.requestKey!==intent.requestKey||frame.organizationId!==user.organizationId||frame.projectId!==user.projectId||frame.actorId!==user.actorId||frame.deploymentAuthority!==false)throw Error('INVALID_CAMPAIGN_REQUEST');return uuid(frame.campaignId);
}
export async function verifiedCreatedCampaign(value:unknown,intent:CampaignCreateIntent,user:Identity,campaignId?:string):Promise<Campaign>{
 requireCampaignIntent(intent,user);const id=campaignId??uuid(object(value).id),record=await verifiedCampaign(value,user,id);
 if(record.agent_version_id!==intent.input.agentVersionId||record.dataset_version_id!==intent.input.datasetVersionId||record.agent_content_sha256!==intent.agentContentSha256||record.dataset_content_sha256!==intent.datasetContentSha256||record.requires_approval!==intent.input.requiresApproval)throw Error('INVALID_CAMPAIGN_REQUEST_INPUT');return record;
}
export function verifiedCampaignRequestRequirements(value:unknown,intent:CampaignCreateIntent,user:Identity,record:Campaign):void{
 requireCampaignIntent(intent,user);const requirements=releaseRequirements(value,user,record);
 if(intent.input.baselineCampaignId===null){if(requirements.enabled)throw Error('INVALID_CAMPAIGN_REQUEST_BASELINE')}
 else if(!requirements.enabled||requirements.baselineCampaignId!==intent.input.baselineCampaignId||requirements.evidenceMaxAgeSeconds!==intent.input.evidenceMaxAgeSeconds)throw Error('INVALID_CAMPAIGN_REQUEST_BASELINE');
}
