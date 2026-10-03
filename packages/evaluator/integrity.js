import { hash } from '../contracts/hash.js';

// Validate stored evidence relationships; this does not call the agent again.
export function runIntegrity(run){
  try{
    if(run.snapshotHash!==hash(run.snapshot)||run.resultHash!==hash({results:run.results,gate:run.gate}))return false;
    for(const kind of ['agent','dataset','policy']){
      const {id,contentHash,createdAt,...data}=run.snapshot[kind];
      if(id!==run[kind+'VersionId']||!/^[a-f0-9]{64}$/.test(contentHash)||hash(data)!==contentHash)return false;
    }
    const cases=run.snapshot.dataset.cases,counts={pass:0,fail:0,inconclusive:0};
    if(!Array.isArray(run.results)||run.results.length!==cases.length||new Set(run.results.map(item=>item.caseId)).size!==cases.length)return false;
    const byId=new Map(cases.map(item=>[item.id,item]));let total=0,requiredFailure=false,requiredUnknown=false,error=false;
    for(const result of run.results){
      const source=byId.get(result.caseId);
      if(!source||result.input!==source.input||!Array.isArray(result.rules)||result.rules.length!==source.rules.length||new Set(result.rules.map(rule=>rule.ruleId)).size!==source.rules.length)return false;
      if(result.error!==undefined&&typeof result.error!=='string')return false;
      error ||= Boolean(result.error);
      const rules=new Map(source.rules.map(rule=>[rule.id,rule]));
      for(const resultRule of result.rules){
        const rule=rules.get(resultRule.ruleId);
        if(!rule||resultRule.type!==rule.type||resultRule.required!==(rule.required!==false)||!Object.hasOwn(counts,resultRule.status))return false;
        counts[resultRule.status]++;total++;
        if(resultRule.required){requiredFailure ||= resultRule.status==='fail';requiredUnknown ||= resultRule.status==='inconclusive';}
      }
    }
    const passRate=total?counts.pass/total:0,summary={cases:cases.length,rules:total,...counts,passRate};
    if(hash(summary)!==hash(run.summary))return false;
    const policy=run.snapshot.policy,threshold=policy.minimumPassRate,manual=policy.requiresManualApproval===true;
    if(!Number.isFinite(threshold)||threshold<0||threshold>1||policy.requiresManualApproval!==undefined&&typeof policy.requiresManualApproval!=='boolean')return false;
    const decision=requiredFailure?'block':!total||error||requiredUnknown?'inconclusive':passRate<threshold?'block':'pass';
    if(run.gate.decision!==decision||run.gate.deploymentAllowed!==(decision==='pass'&&!manual))return false;
    if(manual&&(run.gate.requiresManualApproval!==true||run.gate.evaluationPassed!==(decision==='pass')))return false;
    return run.state===(error?'failed':'succeeded');
  }catch{return false;}
}
