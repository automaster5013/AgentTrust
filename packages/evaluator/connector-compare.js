import {analyzeRecordedConnector} from './connector-replay.js';

export function compareRecordedConnectors({dataset,policy,baseline,candidate}){
 const before=analyzeRecordedConnector({dataset,policy,trace:baseline}),after=analyzeRecordedConnector({dataset,policy,trace:candidate});
 const changes=[];let regressions=0,inconclusive=false;
 for(let c=0;c<before.outcome.results.length;c++){
  const left=before.outcome.results[c],right=after.outcome.results[c];
  inconclusive||=Boolean(left.error||right.error);
  for(let r=0;r<left.rules.length;r++){
   const a=left.rules[r].status,b=right.rules[r].status;
   inconclusive||=a==='inconclusive'||b==='inconclusive';
   if(a!==b){const regression=a==='pass'&&b!=='pass';if(regression)regressions++;changes.push({caseNumber:c+1,ruleNumber:r+1,before:a,after:b,regression});}
  }
 }
 const comparable=!inconclusive&&before.outcome.state==='succeeded'&&after.outcome.state==='succeeded';
 const comparisonPassed=comparable&&after.outcome.gate.decision==='pass'&&regressions===0;
 return {schemaVersion:1,purpose:'connector-recorded-comparison',offlineOnly:true,recordedSourceVerified:false,networkRequestsMade:0,comparable,comparisonPassed,comparisonDecision:!comparable?'inconclusive':comparisonPassed?'pass':'block',baselineDecision:before.outcome.gate.decision,candidateDecision:after.outcome.gate.decision,baselineSummary:before.outcome.summary,candidateSummary:after.outcome.summary,regressions,changes,manualApprovalRequired:after.policy.requiresManualApproval===true,releaseGateEvaluated:false,deploymentAllowed:false};
}
