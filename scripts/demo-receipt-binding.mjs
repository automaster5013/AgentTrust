import assert from 'node:assert/strict';
import {hash} from '../packages/contracts/hash.js';

// Signatures authenticate the artifact, so every displayed field must come from it.
export function assertDemoReceiptBinding(receipt,request,run,baseline){
  const artifact=receipt.artifact;
  assert.equal(hash(artifact.request),hash(request));
  const result=Object.fromEntries(Object.entries(receipt).filter(([key])=>!['artifact','artifactHash','signature'].includes(key)));
  assert.equal(hash(artifact.result),hash(result));
  assert.equal(result.runId,run.id);
  assert.equal(result.decision,result.deploymentAllowed?'pass':'block');
  assert.ok(Array.isArray(result.reasons)&&result.reasons.every(reason=>typeof reason==='string'));
  if(result.deploymentAllowed)assert.equal(result.reasons.length,0);
  for(const [name,expected] of [['candidate',run],...(baseline?[['baseline',baseline]]:[])]){
    const evidence=artifact.evidence[name];
    assert.equal(evidence.runId,expected.id);
    for(const key of ['snapshotHash','resultHash']){
      assert.ok(typeof expected[key]==='string'&&expected[key].length>0);
      assert.equal(evidence[key],expected[key]);
    }
  }
  if(!baseline)assert.equal(artifact.evidence.baseline,undefined);
}
