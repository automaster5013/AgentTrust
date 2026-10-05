import assert from 'node:assert/strict';
import {runLimits} from '../packages/contracts/run-quota-error.js';

// This observation does not reserve slots; the server rechecks atomic limits.
export function checkDemoRunCapacity(operations,scope,requestedRuns){
 assert.ok(Number.isSafeInteger(requestedRuns)&&requestedRuns>=1&&requestedRuns<=270);
 const report={status:'invalid_capacity',requestedRuns};
 try{
  const capacity=operations?.executionCapacity;
  assert.equal(capacity?.scope,'organization');assert.equal(capacity.organizationId,scope.organizationId);assert.ok(Number.isFinite(Date.parse(operations.observedAt)));
  for(const [name,limit] of [['retained',runLimits.history],['active',runLimits.active]]){
   const value=capacity[name];assert.ok(value&&Number.isSafeInteger(value.used)&&value.used>=0);assert.equal(value.limit,limit);assert.equal(value.remaining,Math.max(0,limit-value.used));
  }
  assert.ok(capacity.active.used<=capacity.retained.used);
  Object.assign(report,{observedAt:operations.observedAt,retainedRemaining:capacity.retained.remaining,activeRemaining:capacity.active.remaining});
  report.status=capacity.retained.remaining<requestedRuns?'insufficient_retained':capacity.active.remaining<1?'no_active_slot':'passed';
 }catch{/* Keep bounded failure metadata; never copy an unvalidated response. */}
 return report;
}
