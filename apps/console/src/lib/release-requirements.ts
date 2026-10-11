import {comparison,type Campaign,type Comparison} from './campaign-contracts.ts';
import type {Identity,Gate} from './contracts.ts';
export type ReleaseRequirements={enabled:false}|{enabled:true;baselineCampaignId:string;evidenceMaxAgeSeconds:number;candidateCreatedAtEpochMillis:number;baselineCreatedAtEpochMillis:number;evidenceExpiresAtEpochMillis:number;baselineAgentVersionId:string;baselineAgentContentSha256:string;comparison:Comparison};
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw Error('INVALID_RELEASE_REQUIREMENTS');return value as Record<string,unknown>}
function uuid(value:unknown):string{if(typeof value!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value))throw Error('INVALID_RELEASE_REQUIREMENTS');return value}
function epoch(value:unknown):number{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<1)throw Error('INVALID_RELEASE_REQUIREMENTS');return value}
export function releaseRequirements(value:unknown,user:Identity,record:Campaign):ReleaseRequirements{
 const r=object(value);
 if(r.contract!=='campaign-release-requirements-v1'||r.campaignId!==record.id||r.organizationId!==user.organizationId||r.projectId!==user.projectId||r.deploymentAuthority!==false||typeof r.enabled!=='boolean')throw Error('INVALID_RELEASE_REQUIREMENTS_SCOPE');
 if(!r.enabled){if(Object.keys(r).length!==6)throw Error('INVALID_RELEASE_REQUIREMENTS');return {enabled:false}}
 if(Object.keys(r).length!==16||r.datasetVersionId!==record.dataset_version_id||r.datasetContentSha256!==record.dataset_content_sha256)throw Error('INVALID_RELEASE_REQUIREMENTS');
 const baselineCampaignId=uuid(r.baselineCampaignId),baselineAgentVersionId=uuid(r.baselineAgentVersionId),baselineAgentContentSha256=r.baselineAgentContentSha256;
 if(baselineCampaignId===record.id||typeof baselineAgentContentSha256!=='string'||!/^[a-f0-9]{64}$/.test(baselineAgentContentSha256)||typeof r.evidenceMaxAgeSeconds!=='number'||!Number.isInteger(r.evidenceMaxAgeSeconds)||r.evidenceMaxAgeSeconds<60||r.evidenceMaxAgeSeconds>86400)throw Error('INVALID_RELEASE_REQUIREMENTS');
 const evidenceMaxAgeSeconds=r.evidenceMaxAgeSeconds,candidateCreatedAtEpochMillis=epoch(r.candidateCreatedAtEpochMillis),baselineCreatedAtEpochMillis=epoch(r.baselineCreatedAtEpochMillis),evidenceExpiresAtEpochMillis=epoch(r.evidenceExpiresAtEpochMillis);
 if(candidateCreatedAtEpochMillis!==Date.parse(record.created_at)||baselineCreatedAtEpochMillis>candidateCreatedAtEpochMillis||evidenceExpiresAtEpochMillis!==Math.min(candidateCreatedAtEpochMillis,baselineCreatedAtEpochMillis)+evidenceMaxAgeSeconds*1000)throw Error('INVALID_RELEASE_REQUIREMENTS_TIME');
 const result=comparison({...r,baselineCampaignId},user,record,baselineCampaignId);
 return {enabled:true,baselineCampaignId,evidenceMaxAgeSeconds,candidateCreatedAtEpochMillis,baselineCreatedAtEpochMillis,evidenceExpiresAtEpochMillis,baselineAgentVersionId,baselineAgentContentSha256,comparison:result};
}
export function verifyReleasePermission(requirements:ReleaseRequirements,gate:Gate,observedAt:number,expiresAt?:number){
 if(!requirements.enabled||!gate.deploymentAllowed)return;
 if(requirements.comparison.status!=='no-regression'||observedAt<requirements.candidateCreatedAtEpochMillis||observedAt<requirements.baselineCreatedAtEpochMillis||observedAt>=requirements.evidenceExpiresAtEpochMillis||expiresAt!==undefined&&expiresAt>requirements.evidenceExpiresAtEpochMillis)throw Error('INVALID_RELEASE_REQUIREMENTS_PERMISSION');
}
