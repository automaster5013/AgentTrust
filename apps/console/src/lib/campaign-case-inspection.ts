import {verifiedCampaign,type Campaign,type CaseEvidence} from './campaign-contracts.ts';
import {detail,type Detail,type Identity} from './contracts.ts';
export function selectedCampaignCase(record:Campaign,user:Identity,caseId:string):CaseEvidence{
 if(record.organization_id!==user.organizationId||record.project_id!==user.projectId)throw Error('INVALID_CASE_SCOPE');
 const selected=record.cases.find(c=>c.caseId===caseId);if(!selected||selected.state==='queued')throw Error('CASE_NOT_COMPLETE');return selected;
}
export async function verifiedCaseParent(value:unknown,user:Identity,record:Campaign,caseId:string):Promise<CaseEvidence>{
 const selected=selectedCampaignCase(record,user,caseId),fresh=await verifiedCampaign(value,user,record.id),current=selectedCampaignCase(fresh,user,caseId);
 for(const key of ['id','organization_id','project_id','created_at','requires_approval','agent_version_id','dataset_version_id','agent_content_sha256','dataset_content_sha256','agentVersion','datasetVersion'] as const)if(JSON.stringify(fresh[key])!==JSON.stringify(record[key]))throw Error('CHANGED_CASE_PARENT');
 if(JSON.stringify(current)!==JSON.stringify(selected))throw Error('CHANGED_CASE_BINDING');return current;
}
export function verifiedCaseDetail(value:unknown,user:Identity,record:Campaign,selected:CaseEvidence):Detail{
 const expected=selectedCampaignCase(record,user,selected.caseId);if(JSON.stringify(expected)!==JSON.stringify(selected))throw Error('CHANGED_CASE_BINDING');
 const result=detail(value,user,selected.runId);if(result.provider!==selected.provider||result.scenario!==selected.scenario||result.state!==selected.state||result.decision!==selected.decision||result.requires_approval!==record.requires_approval)throw Error('CHANGED_CASE_RESULT');return result;
}
