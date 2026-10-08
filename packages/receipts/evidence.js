import {hash} from '../contracts/hash.js';
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const invalid=()=>{throw new Error('Historical evidence binding failed.');};

// The caller authenticates the receipt first. Only the signed payload hashes are
// checked here; unsigned run annotations and current authority are not inferred.
export function bindHistoricalRunBodies(receipt,bodies){
 const artifact=receipt.artifact,withBaseline=artifact.request.baselineRunId!==undefined;
 if(!object(bodies)||Object.keys(bodies).sort().join(',')!==(withBaseline?'baseline,candidate':'candidate'))invalid();
 for(const name of withBaseline?['candidate','baseline']:['candidate']){
  const run=bodies[name],reference=artifact.evidence[name];
  if(!object(run)||run.id!==reference.runId||run.organizationId!==artifact.organizationId||run.projectId!==artifact.projectId||!object(run.snapshot)||!Array.isArray(run.results)||!object(run.gate)||!digest(reference.resultHash)||run.snapshotHash!==reference.snapshotHash||run.resultHash!==reference.resultHash)invalid();
  if(hash(run.snapshot)!==reference.snapshotHash||hash({results:run.results,gate:run.gate})!==reference.resultHash)invalid();
 }
 return {evidenceBodiesVerified:true,candidateEvidenceVerified:true,baselineEvidenceVerified:withBaseline,evidenceVerificationScope:'signed-snapshot-and-result-bodies',evidenceMetadataAuthenticated:false};
}
