import assert from 'node:assert/strict';
import {inspectOperationalObservation} from './observation-evidence.js';

// These are unsigned recorded observations. A comparison never grants authority.
export function compareOperationalObservations(baselineReport,candidateReport,expected={}){
 const baseline=inspectOperationalObservation(baselineReport,expected),candidate=inspectOperationalObservation(candidateReport,expected);
 assert.equal(candidate.organizationId,baseline.organizationId);assert.equal(candidate.projectId,baseline.projectId);
 const codes=[...new Set([...baseline.alertCodes,...candidate.alertCodes])].sort();
 const counts=report=>{
  const result=new Map();
  for(const sample of report.samples)for(const code of new Set(sample.assessment.alerts.map(a=>a.code)))result.set(code,(result.get(code)??0)+1);
  return result;
 };
 const before=counts(baselineReport),after=counts(candidateReport),criticalObserved=baseline.criticalObserved||candidate.criticalObserved;
 const incomplete=!baseline.recordedCompleted||!candidate.recordedCompleted;
 const describe=inspection=>({recordedCompleted:inspection.recordedCompleted,recordedSessionScopeVerified:inspection.recordedSessionScopeVerified,recordedSessionLoggedOut:inspection.recordedSessionLoggedOut,requestedSamples:inspection.requestedSamples,samples:inspection.samples,intervalSeconds:inspection.intervalSeconds,status:inspection.status,sampleStatusCounts:inspection.sampleStatusCounts,firstSampleAt:inspection.firstSampleAt,lastSampleAt:inspection.lastSampleAt,finishedAt:inspection.finishedAt,recordedSampleSpanSeconds:inspection.samples?(Date.parse(inspection.lastSampleAt)-Date.parse(inspection.firstSampleAt))/1000:null,recordedFailureCode:inspection.recordedFailureCode,recordedCleanupFailureCode:inspection.recordedCleanupFailureCode,recordedReportWriteFailureCode:inspection.recordedReportWriteFailureCode});
 return {schemaVersion:1,purpose:'offline-operational-observation-comparison',structureVerified:true,sameRecordedScopeVerified:true,expectedScopeVerified:baseline.expectedScopeVerified&&candidate.expectedScopeVerified,organizationId:baseline.organizationId,projectId:baseline.projectId,status:incomplete?'incomplete':criticalObserved?'critical':'compared',criticalObserved,baseline:describe(baseline),candidate:describe(candidate),sampleCountChange:candidate.samples-baseline.samples,alertChanges:codes.map(code=>{const baselineSamples=before.get(code)??0,candidateSamples=after.get(code)??0;return {code,baselineSamples,candidateSamples,sampleCountChange:candidateSamples-baselineSamples,occurrence:baselineSamples===0?'candidate-only':candidateSamples===0?'baseline-only':'both'};}),recordedWindowOrderVerified:false,equalObservationDurationVerified:false,alertResolutionVerified:false,diagnosticAuthenticityVerified:false,authenticityVerified:false,runtimeVerified:false,currentHealthVerified:false,currentReleasePermissionVerified:false,continuousMonitoringProven:false,automatedRemediationPerformed:false,serverDeployed:false};
}
