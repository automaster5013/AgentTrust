import assert from 'node:assert/strict';
const codes=new Map([['worker-not-recent',['critical','service']],['execution-deadline-exceeded',['critical','project']],['worker-lease-expired',['critical','project']],['retained-capacity-full',['critical','organization']],['retained-capacity-high',['warning','organization']],['versions-capacity-full',['critical','organization']],['versions-capacity-high',['warning','organization']],['active-capacity-full',['warning','organization']]]);
export function verifiedOperationalAlertReport(report,scope){
 assert.equal(report.schemaVersion,1);assert.equal(report.organizationId,scope.organizationId);assert.equal(report.projectId,scope.projectId);assert.equal(report.readOnly,true);
 for(const flag of ['automatedRemediationPerformed','releasePermissionVerified','continuousMonitoringProven'])assert.equal(report[flag],false);
 assert.equal(typeof report.observedAt,'string');assert.ok(Number.isFinite(Date.parse(report.observedAt)));assert.equal(new Date(report.observedAt).toISOString(),report.observedAt);
 assert.ok(Array.isArray(report.alerts)&&report.alerts.length<=6);assert.equal(new Set(report.alerts.map(a=>a.code)).size,report.alerts.length);
 const alerts=report.alerts.map(a=>{assert.ok(codes.has(a.code));assert.deepEqual([a.severity,a.scope],codes.get(a.code));return {code:a.code,severity:a.severity,scope:a.scope};});
 for(const prefix of ['retained','versions'])assert.ok(!alerts.some(a=>a.code===prefix+'-capacity-full')||!alerts.some(a=>a.code===prefix+'-capacity-high'));
 const status=alerts.some(a=>a.severity==='critical')?'critical':alerts.length?'warning':'ok';assert.equal(report.status,status);
 return {schemaVersion:1,status,organizationId:scope.organizationId,projectId:scope.projectId,observedAt:report.observedAt,alerts,readOnly:true,automatedRemediationPerformed:false,releasePermissionVerified:false,continuousMonitoringProven:false};
}
