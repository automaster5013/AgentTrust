import type {Identity} from './contracts.ts';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
type Status='pass'|'fail'|'inconclusive'|'missing';
export type ComparisonRule={ruleId:string;before:Status;after:Status;baselineRequired:boolean|null;candidateRequired:boolean|null;changed:boolean};
export type RunComparison={baselineRunId:string;candidateRunId:string;baselineDecision:'pass'|'block'|'inconclusive';candidateDecision:'pass'|'block'|'inconclusive';rules:ComparisonRule[];changedRules:number};
export function runComparisonPath(candidate:string,baseline:string):string{
 if(!uuid.test(candidate)||!uuid.test(baseline)||candidate===baseline)throw Error('INVALID_COMPARISON_IDS');
 return 'runs/'+candidate+'/comparison/'+baseline;
}
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw Error('INVALID_COMPARISON');return value as Record<string,unknown>}
function status(value:unknown):Status{if(!['pass','fail','inconclusive','missing'].includes(value as string))throw Error('INVALID_COMPARISON');return value as Status}
function decision(value:unknown):'pass'|'block'|'inconclusive'{if(!['pass','block','inconclusive'].includes(value as string))throw Error('INVALID_COMPARISON');return value as 'pass'|'block'|'inconclusive'}
export function runComparison(value:unknown,user:Identity,candidate:string,baseline:string):RunComparison{
 runComparisonPath(candidate,baseline);const v=object(value);
 if(v.organizationId!==user.organizationId||v.projectId!==user.projectId||v.baselineRunId!==baseline||v.candidateRunId!==candidate||v.comparisonKind!=='observed-rule-results-v1'||v.deploymentAuthority!==false||v.regressionAuthority!==false||!Array.isArray(v.rules)||v.rules.length<1||v.rules.length>200)throw Error('INVALID_COMPARISON_SCOPE');
 let previous='';const rules=v.rules.map(raw=>{
  const r=object(raw),before=status(r.before),after=status(r.after);
  if(typeof r.ruleId!=='string'||!r.ruleId.trim()||r.ruleId.length>100||r.ruleId<=previous)throw Error('INVALID_COMPARISON_RULE');previous=r.ruleId;
  for(const [state,required] of [[before,r.baselineRequired],[after,r.candidateRequired]])if(state==='missing'?required!==null:typeof required!=='boolean')throw Error('INVALID_COMPARISON_RULE');
  if(before==='missing'&&after==='missing')throw Error('INVALID_COMPARISON_RULE');
  const changed=before!==after||r.baselineRequired!==r.candidateRequired;
  if(r.changed!==changed)throw Error('INVALID_COMPARISON_RULE');
  return {ruleId:r.ruleId,before,after,baselineRequired:r.baselineRequired as boolean|null,candidateRequired:r.candidateRequired as boolean|null,changed};
 });
 const count=rules.filter(r=>r.changed).length;if(v.changedRules!==count)throw Error('INVALID_COMPARISON_COUNT');
 return {baselineRunId:baseline,candidateRunId:candidate,baselineDecision:decision(v.baselineDecision),candidateDecision:decision(v.candidateDecision),rules,changedRules:count};
}
