import type {CaseEvidence} from './campaign-contracts.ts';
export type CampaignCaseFilter={required:'all'|'required'|'optional';decision:'all'|CaseEvidence['decision'];state:'all'|CaseEvidence['state']};
/** Presentation only: the verified full campaign remains the gate input. */
export function filterCampaignCases(cases:readonly CaseEvidence[],filter:CampaignCaseFilter):CaseEvidence[]{
 if(!['all','queued','succeeded','failed'].includes(filter.state)||!['all','required','optional'].includes(filter.required)||!['all','pass','block','inconclusive'].includes(filter.decision))throw Error('INVALID_CAMPAIGN_CASE_FILTER');
 return cases.filter(row=>(filter.state==='all'||row.state===filter.state)&&(filter.required==='all'||row.required===(filter.required==='required'))&&(filter.decision==='all'||row.decision===filter.decision));
}
