import {InputError,validate} from '../contracts/index.js';
import {evaluate} from './index.js';
import {validateEvidence} from './https-adapter.js';

export function analyzeRecordedConnector({dataset,policy,trace}){
 const checkedDataset=validate('dataset',dataset),checkedPolicy=validate('policy',policy),checkedTrace=validate('connectorTrace',trace);
 const cases=new Map(checkedDataset.cases.map(item=>[item.id,item])),recorded=new Map();
 for(const entry of checkedTrace.entries){
  const request=entry.request,testCase=cases.get(request.caseId);
  if(!testCase||request.input!==testCase.input||request.agentVersionId!==checkedTrace.agentVersionId||recorded.has(request.caseId))throw new InputError('Recorded request is not uniquely bound to the evaluation input.');
  recorded.set(request.caseId,entry);
 }
 const snapshot={agent:{id:checkedTrace.agentVersionId,mode:'https'},dataset:checkedDataset,policy:checkedPolicy};
 const outcome=evaluate(snapshot,(_agent,testCase)=>{
  const entry=recorded.get(testCase.id);if(!entry||!Object.hasOwn(entry,'response'))throw Error('Recorded evidence is unavailable');
  return validateEvidence(entry.response);
 });
 return {dataset:checkedDataset,policy:checkedPolicy,agentVersionId:checkedTrace.agentVersionId,outcome};
}
export function evaluateRecordedConnector(input){
 const {outcome,policy}=analyzeRecordedConnector(input);
 return {schemaVersion:1,purpose:'connector-recorded-evaluation',offlineOnly:true,recordedSourceVerified:false,networkRequestsMade:0,state:outcome.state,evaluationDecision:outcome.gate.decision,evaluationPassed:outcome.gate.decision==='pass',summary:outcome.summary,manualApprovalRequired:policy.requiresManualApproval===true,releaseGateEvaluated:false,deploymentAllowed:false,caseResults:outcome.results.map((item,index)=>{const counts={pass:0,fail:0,inconclusive:0};for(const rule of item.rules)counts[rule.status]++;return {caseNumber:index+1,adapterFailed:Boolean(item.error),rules:counts};})};
}
