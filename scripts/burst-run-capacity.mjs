import assert from 'node:assert/strict';
import {runLimits} from '../packages/contracts/run-quota-error.js';
import {seededDemoScope} from './demo-session-scope.mjs';
import {checkDemoRunCapacity} from './demo-run-capacity.mjs';

// Local synthetic tooling already uses this owner connection for accounting.
// Count the entire selected organization, including its other projects.
export async function readBurstRunCapacity(owner,scope,requestedRuns){
 assert.ok(Number.isInteger(requestedRuns)&&requestedRuns>=2&&requestedRuns<=20);
 scope=seededDemoScope(scope);
 const requiredActiveSlots=Math.min(4,requestedRuns);
 let result;
 try{
  result=await owner.query("SELECT clock_timestamp() AS observed_at,count(*) AS retained,count(*) FILTER(WHERE state IN ('queued','running')) AS active FROM agenttrust.runs WHERE organization_id=$1",[scope.organizationId]);
 }catch{return {status:'unavailable',requestedRuns,requiredActiveSlots};}
 const invalid={status:'invalid_capacity',requestedRuns,requiredActiveSlots};
 try{
  if(result.rows.length!==1)return {status:'invalid_capacity',requestedRuns,requiredActiveSlots};
  const row=result.rows[0];
  for(const name of ['retained','active'])assert.ok(typeof row[name]==='string'&&/^(0|[1-9][0-9]*)$/.test(row[name]));
  const retained=Number(row.retained),active=Number(row.active);
  const observation={observedAt:row.observed_at?.toISOString(),executionCapacity:{scope:'organization',organizationId:scope.organizationId,retained:{used:retained,limit:runLimits.history,remaining:Math.max(0,runLimits.history-retained)},active:{used:active,limit:runLimits.active,remaining:Math.max(0,runLimits.active-active)}}};
  const report={...checkDemoRunCapacity(observation,scope,requestedRuns),requiredActiveSlots};
  if(report.status==='passed'&&report.activeRemaining<requiredActiveSlots)report.status='insufficient_active';
  return report;
 }catch{return invalid;}
}
