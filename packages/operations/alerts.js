import assert from 'node:assert/strict';
import {runLimits} from '../contracts/run-quota-error.js';
import {versionLimit} from '../contracts/index.js';

const id=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const count=value=>Number.isSafeInteger(value)&&value>=0;
function capacity(value,limit){assert.ok(value&&count(value.used)&&value.limit===limit&&value.remaining===Math.max(0,limit-value.used));}
export function assessOperationalAlerts(operations,scope){
 assert.ok(scope&&id(scope.organizationId)&&id(scope.projectId));assert.equal(operations.projectId,scope.projectId);
 assert.equal(operations.executionCapacity.scope,'organization');assert.equal(operations.executionCapacity.organizationId,scope.organizationId);
 assert.equal(operations.versionCapacity.scope,'organization');assert.equal(operations.versionCapacity.organizationId,scope.organizationId);
 capacity(operations.executionCapacity.retained,runLimits.history);capacity(operations.executionCapacity.active,runLimits.active);capacity(operations.versionCapacity,versionLimit);
 assert.equal(typeof operations.observedAt,'string');assert.ok(Number.isFinite(Date.parse(operations.observedAt)));assert.equal(new Date(operations.observedAt).toISOString(),operations.observedAt);
 for(const key of ['queued','running','overdue','expiredLeases'])assert.ok(count(operations.queue[key]));
 const worker=operations.worker;assert.ok(['recent','stale','missing'].includes(worker.state));
 if(worker.state==='missing')assert.equal(worker.ageSeconds,null);else assert.ok(typeof worker.ageSeconds==='number'&&Number.isFinite(worker.ageSeconds));
 if(worker.state==='recent')assert.ok(worker.ageSeconds>=0&&worker.ageSeconds<=15);
 if(worker.state==='stale')assert.ok(worker.ageSeconds<0||worker.ageSeconds>15);
 const alerts=[];const add=(code,severity,scope)=>alerts.push({code,severity,scope});
 if(worker.state!=='recent')add('worker-not-recent','critical','service');
 if(operations.queue.overdue>0)add('execution-deadline-exceeded','critical','project');
 if(operations.queue.expiredLeases>0)add('worker-lease-expired','critical','project');
 for(const [name,value] of [['retained',operations.executionCapacity.retained],['versions',operations.versionCapacity]]){
  if(value.used>=value.limit)add(name+'-capacity-full','critical','organization');
  else if(value.used/value.limit>=0.95)add(name+'-capacity-high','warning','organization');
 }
 if(operations.executionCapacity.active.used>=runLimits.active)add('active-capacity-full','warning','organization');
 return {schemaVersion:1,status:alerts.some(a=>a.severity==='critical')?'critical':alerts.length?'warning':'ok',organizationId:scope.organizationId,projectId:scope.projectId,observedAt:operations.observedAt,alerts,readOnly:true,automatedRemediationPerformed:false,releasePermissionVerified:false,continuousMonitoringProven:false};
}
