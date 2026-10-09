import assert from 'node:assert/strict';
import {verifiedOperationalAlertReport} from './alert-evidence.js';
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const time=v=>{assert.equal(typeof v,'string');const n=Date.parse(v);assert.ok(Number.isFinite(n));assert.equal(new Date(n).toISOString(),v);return n;};
const keys=(o,allowed)=>{assert.ok(o&&typeof o==='object'&&!Array.isArray(o));assert.ok(Object.keys(o).every(k=>allowed.includes(k)));};
export function inspectOperationalObservation(report,expected={}){
 keys(expected,['organizationId','projectId']);assert.equal(Object.hasOwn(expected,'organizationId'),Object.hasOwn(expected,'projectId'));
 keys(report,['schemaVersion','completed','stage','criticalObserved','sessionScopeVerified','sessionLoggedOut','readOnlyMetadata','businessDataWrites','automatedRemediationPerformed','continuousMonitoringProven','releasePermissionVerified','serverDeployed','organizationId','projectId','organizationIndex','intervalSeconds','requestedSamples','samples','finishedAt','failed','interrupted','failureStage','cleanupFailed','reportWriteFailed']);
 assert.equal(report.schemaVersion,1);assert.ok(uuid(report.organizationId)&&uuid(report.projectId));
 if(Object.hasOwn(expected,'organizationId')){assert.ok(uuid(expected.organizationId)&&uuid(expected.projectId));assert.equal(report.organizationId,expected.organizationId);assert.equal(report.projectId,expected.projectId);}
 for(const key of ['completed','criticalObserved','sessionScopeVerified','sessionLoggedOut'])assert.equal(typeof report[key],'boolean');
 assert.equal(report.readOnlyMetadata,true);for(const key of ['businessDataWrites','automatedRemediationPerformed','continuousMonitoringProven','releasePermissionVerified','serverDeployed'])assert.equal(report[key],false);
 for(const key of ['failed','interrupted','cleanupFailed','reportWriteFailed'])if(Object.hasOwn(report,key))assert.equal(typeof report[key],'boolean');
 assert.ok(Number.isInteger(report.organizationIndex)&&report.organizationIndex>=0&&report.organizationIndex<=99);
 assert.ok(Number.isInteger(report.requestedSamples)&&report.requestedSamples>=1&&report.requestedSamples<=300);
 assert.ok(Number.isInteger(report.intervalSeconds)&&report.intervalSeconds>=1&&report.intervalSeconds<=60);
 assert.ok(Array.isArray(report.samples)&&report.samples.length<=report.requestedSamples);
 assert.ok(['planned','login','session-scope','sampling','finished'].includes(report.stage));
 if(Object.hasOwn(report,'failureStage')){assert.equal(report.failed,true);assert.ok(['planned','login','session-scope','sampling'].includes(report.failureStage));}
 let previousSample=-Infinity,previousObserved=-Infinity,critical=false;const counts={ok:0,warning:0,critical:0};const codes=new Set();
 for(const sample of report.samples){
  keys(sample,['at','assessment']);const at=time(sample.at);assert.ok(at>=previousSample);
  keys(sample.assessment,['schemaVersion','status','organizationId','projectId','observedAt','alerts','readOnly','automatedRemediationPerformed','releasePermissionVerified','continuousMonitoringProven']);
  assert.ok(Array.isArray(sample.assessment.alerts)&&sample.assessment.alerts.length<=6);for(const alert of sample.assessment.alerts)keys(alert,['code','severity','scope']);
  const a=verifiedOperationalAlertReport(sample.assessment,report),observed=time(a.observedAt),age=at-observed;
  assert.ok(age>=-5000&&age<=30000&&observed>=previousObserved);previousSample=at;previousObserved=observed;counts[a.status]++;critical ||=a.status==='critical';for(const alert of a.alerts)codes.add(alert.code);
 }
 assert.equal(report.criticalObserved,critical);if(report.samples.length)assert.equal(report.sessionScopeVerified,true);
 if(report.stage==='finished'){const end=time(report.finishedAt);assert.ok(end>=previousSample);}else{assert.equal(report.completed,false);assert.ok(!Object.hasOwn(report,'finishedAt'));}
 if(report.completed){assert.equal(report.stage,'finished');assert.equal(report.samples.length,report.requestedSamples);assert.equal(report.sessionScopeVerified,true);assert.equal(report.sessionLoggedOut,true);for(const key of ['failed','interrupted','cleanupFailed','reportWriteFailed'])assert.notEqual(report[key],true);}
 if(report.cleanupFailed===true)assert.equal(report.completed,false);
 return {schemaVersion:1,purpose:'offline-operational-observation-inspection',structureVerified:true,expectedScopeVerified:Object.hasOwn(expected,'organizationId'),organizationId:report.organizationId,projectId:report.projectId,organizationIndex:report.organizationIndex,requestedSamples:report.requestedSamples,samples:report.samples.length,intervalSeconds:report.intervalSeconds,recordedCompleted:report.completed,recordedSessionScopeVerified:report.sessionScopeVerified,recordedSessionLoggedOut:report.sessionLoggedOut,recordedInterrupted:report.interrupted===true,criticalObserved:critical,status:report.completed?(critical?'critical':counts.warning?'warning':'ok'):'incomplete',sampleStatusCounts:counts,alertCodes:[...codes].sort(),firstSampleAt:report.samples[0]?.at??null,lastSampleAt:report.samples.at(-1)?.at??null,finishedAt:report.finishedAt??null,authenticityVerified:false,runtimeVerified:false,currentHealthVerified:false,currentReleasePermissionVerified:false,continuousMonitoringProven:false,serverDeployed:false};
}
