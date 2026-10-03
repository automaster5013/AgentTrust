import { assertJsonValue } from '../../packages/contracts/json.js';
import { hash } from '../../packages/contracts/hash.js';
import { runIntegrity } from '../../packages/evaluator/integrity.js';
import { incomplete } from '../../packages/evaluator/outcome.js';

export function trustworthyOutcome(row,outcome){
  try{
    assertJsonValue(outcome,{maximumNodes:60000});
    if(!Number.isInteger(row.case_budget)||row.case_budget<1||row.case_budget>100)return false;
    if(!outcome||Object.keys(outcome).sort().join(',')!=='gate,results,state,summary'||!Array.isArray(outcome.results)||outcome.results.length>row.case_budget)return false;
    if(outcome.state==='failed'&&!outcome.results.length){
      const reason=outcome.gate?.reason;
      return typeof reason==='string'&&reason.length>0&&reason.length<=200&&hash(outcome)===hash(incomplete('failed',reason));
    }
    if(!['succeeded','failed'].includes(outcome.state))return false;
    return runIntegrity({snapshot:row.snapshot,snapshotHash:row.snapshot_hash,
      agentVersionId:row.agent_version_id,datasetVersionId:row.dataset_version_id,policyVersionId:row.policy_version_id,
      state:outcome.state,results:outcome.results,summary:outcome.summary,gate:outcome.gate,resultHash:hash({results:outcome.results,gate:outcome.gate})});
  }catch{return false;}
}
