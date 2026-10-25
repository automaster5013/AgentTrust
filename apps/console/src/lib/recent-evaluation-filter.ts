import type {Run} from './contracts';
export type RecentEvaluationFilter={query:string;decision:'all'|Run['decision'];state:'all'|Run['state']};
export function filterRecentEvaluations(records:readonly Run[],filter:RecentEvaluationFilter):Run[]{
 const query=filter.query.trim().slice(0,64).toLowerCase();
 return records.filter(record=>(filter.decision==='all'||record.decision===filter.decision)&&(filter.state==='all'||record.state===filter.state)&&(!query||[record.id,record.provider,record.scenario].some(value=>value.toLowerCase().includes(query))));
}
