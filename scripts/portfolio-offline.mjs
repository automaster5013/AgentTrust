import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {readConnectorJson,checkConnectorContract} from './check-connector-contract.mjs';
import {validateAcceptanceProfile,acceptanceModes} from '../packages/evaluator/acceptance-profile.js';
import {evaluate} from '../packages/evaluator/index.js';
import {evaluateRecordedConnector} from '../packages/evaluator/connector-replay.js';
import {compareRecordedConnectors} from '../packages/evaluator/connector-compare.js';

export function parseOfflineOptions(args){
  if(args.length===0)return {json:false};
  if(args.length===1&&args[0]==='--json')return {json:true};
  throw Error('Invalid offline demonstration options.');
}

export function demonstrateOffline(input){
  checkConnectorContract(input.request,input.response);
  const profile=validateAcceptanceProfile(input.profile);
  const evaluations=acceptanceModes.map(([mode,state,decision])=>{
    const result=evaluate({agent:{mode},dataset:profile.dataset,policy:profile.policy});
    assert.equal(result.state,state);assert.equal(result.gate.decision,decision);
    return {scenario:mode,state:result.state,evaluationDecision:result.gate.decision};
  });
  const variants=Object.fromEntries(['compliant','regression','forbidden_tool','missing_evidence'].map(name=>[name,structuredClone(input.trace)]));
  variants.regression.entries[0].response.output='Synthetic response omits required information.';
  variants.forbidden_tool.entries[0].response.toolEvents.push({name:'transfer_funds',args:{amount:1}});
  delete variants.missing_evidence.entries[0].response;
  const recordedEvaluations=Object.entries(variants).map(([scenario,trace])=>{
    const result=evaluateRecordedConnector({dataset:input.dataset,policy:input.policy,trace});
    assert.equal(result.evaluationDecision,scenario==='compliant'?'pass':scenario==='missing_evidence'?'inconclusive':'block');
    assert.equal(result.manualApprovalRequired,true);assert.equal(result.deploymentAllowed,false);
    return {scenario,state:result.state,evaluationDecision:result.evaluationDecision,manualApprovalRequired:true};
  });
  const comparisons=['compliant','regression','missing_evidence'].map(scenario=>{
    const result=compareRecordedConnectors({dataset:input.dataset,policy:input.policy,baseline:input.trace,candidate:variants[scenario]});
    assert.equal(result.comparisonDecision,scenario==='compliant'?'pass':scenario==='regression'?'block':'inconclusive');
    assert.equal(result.manualApprovalRequired,true);assert.equal(result.deploymentAllowed,false);
    return {scenario,comparisonDecision:result.comparisonDecision,comparable:result.comparable,regressions:result.regressions,manualApprovalRequired:true};
  });
  return {schemaVersion:1,purpose:'portfolio-offline-demonstration',status:'passed',synthetic:true,offlineOnly:true,networkRequestsMade:0,businessDataWrites:false,credentialsRead:false,recordedSourceVerified:false,releaseGateEvaluated:false,administratorApprovalPerformed:false,deploymentAllowed:false,contractValidated:true,cases:profile.dataset.cases.length,rules:profile.dataset.cases.reduce((n,c)=>n+c.rules.length,0),evaluations,recordedEvaluations,comparisons};
}

export async function loadOfflineExamples(){
  const names=['request','response','dataset','policy','trace'];
  const input=Object.fromEntries(await Promise.all(names.map(async name=>[name,(await readConnectorJson(fileURLToPath(new URL('../examples/connector-contract/'+name+'.json',import.meta.url)))).value])));
  input.profile=(await readConnectorJson(fileURLToPath(new URL('../examples/connector-contract/acceptance-profile.json',import.meta.url)))).value;
  return input;
}

export function formatOfflineReport(report){
  const labels={compliant:'정상 응답',regression:'업무 회귀',forbidden_tool:'금지 도구',missing_evidence:'근거 누락',error:'실행 오류'};
  return ['AgentTrust 오프라인 합성 시연',...report.evaluations.map(row=>`${labels[row.scenario]}: ${row.evaluationDecision} (${row.state})`),'기록 응답 비교: '+report.comparisons.map(row=>`${labels[row.scenario]} ${row.comparisonDecision}`).join(' · '),'시연 검증: passed (기대한 통과·차단·판정 불가 확인)','관리자 승인은 별도입니다. 이 시연은 최종 게이트·승인·배포를 수행하지 않습니다.','합성 예제만 사용하며 Docker·접근 키·네트워크·업무 데이터 저장 없이 실행했습니다.'].join('\n');
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  let stage='inputs';
  try{
    const options=parseOfflineOptions(process.argv.slice(2));stage='examples';const input=await loadOfflineExamples();
    stage='demonstration';const report=demonstrateOffline(input);console.log(options.json?JSON.stringify(report):formatOfflineReport(report));
  }catch{
    console.log(JSON.stringify({schemaVersion:1,purpose:'portfolio-offline-demonstration',status:'blocked',failedStage:stage,releaseGateEvaluated:false,deploymentAllowed:false}));process.exitCode=1;
  }
}
