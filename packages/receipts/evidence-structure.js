import {hash} from '../contracts/hash.js';
import {runIntegrity} from '../evaluator/integrity.js';
import {compareRuns} from '../evaluator/comparison.js';
const invalid=()=>{throw Error('Historical evidence structure failed.');};

// Called only after the snapshot and result bodies match authenticated references.
// State, summary and version IDs are derived from those bodies, never from the
// unsigned run annotations. Stored rules are checked without calling an agent.
function derivedRun(receipt,body,name){
 const counts={pass:0,fail:0,inconclusive:0};let total=0,error=false;
 for(const result of body.results){
  if(!result||!Array.isArray(result.rules))invalid();error ||= Boolean(result.error);
  for(const rule of result.rules){if(!rule||!Object.hasOwn(counts,rule.status))invalid();counts[rule.status]++;total++;}
 }
 const artifact=receipt.artifact,reference=artifact.evidence[name];
 const run={id:reference.runId,organizationId:artifact.organizationId,projectId:artifact.projectId,snapshot:body.snapshot,snapshotHash:reference.snapshotHash,results:body.results,gate:body.gate,resultHash:reference.resultHash,
  state:error?'failed':'succeeded',summary:{cases:body.results.length,rules:total,...counts,passRate:total?counts.pass/total:0}};
 for(const kind of ['agent','dataset','policy'])run[kind+'VersionId']=body.snapshot[kind]?.id;
 if(!runIntegrity(run))invalid();return run;
}

export function checkHistoricalEvidenceStructure(receipt,bodies){
 const candidate=derivedRun(receipt,bodies.candidate,'candidate'),baseline=bodies.baseline===undefined?undefined:derivedRun(receipt,bodies.baseline,'baseline'),artifact=receipt.artifact;
 if((candidate.snapshot.policy.requiresManualApproval===true)!==(artifact.result.manualApproval?.required===true))invalid();
 if(artifact.result.deploymentAllowed){
  for(const field of ['agentVersionId','datasetVersionId','policyVersionId'])if(artifact.request[field]!==undefined&&artifact.request[field]!==candidate[field])invalid();
  if(candidate.gate.decision!=='pass')invalid();
 }
 if(baseline&&hash(compareRuns(baseline,candidate))!==hash(artifact.result.comparison))invalid();
 return {evidenceStructuresVerified:true,candidateEvidenceStructureVerified:true,baselineEvidenceStructureVerified:baseline!==undefined,
  evidenceStructureSource:'authenticated-snapshot-and-result-bodies',unsignedMetadataUsedForStructure:false,rulesRecheckedFromRecordedEvidence:true,agentReexecuted:false};
}
