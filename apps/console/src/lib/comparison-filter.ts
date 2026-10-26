import type {Comparison} from './campaign-contracts';
export type ComparisonGroup='all'|'failed'|'unresolved'|'improved';
export function comparisonGroups(value:Comparison,kind:ComparisonGroup,query:string){
 const term=query.trim().slice(0,64).toLowerCase();
 return [{kind:'failed',title:'새 필수 실패',ids:value.newlyFailedRequiredCases},{kind:'unresolved',title:'미확인 필수 사례',ids:value.unresolvedRequiredCases},{kind:'improved',title:'개선된 필수 사례',ids:value.improvedRequiredCases}].filter(group=>kind==='all'||group.kind===kind).map(group=>({...group,total:group.ids.length,ids:group.ids.filter(id=>!term||id.toLowerCase().includes(term))}));
}
