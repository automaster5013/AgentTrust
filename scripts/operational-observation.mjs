import assert from 'node:assert/strict';
import {setTimeout as sleep} from 'node:timers/promises';
import {verifiedOperationalAlertReport} from './operational-alert-probe.mjs';
import {seededDemoScope,assertDemoSessionScope} from './demo-session-scope.mjs';
import {observationFailure,safeObservationFailureCode} from '../packages/operations/observation-failure.js';

export function observationOptions(args){
 const result={organizationIndex:0,samples:3,intervalSeconds:5},seen=new Set(),flags=new Map([['--organization-index',['organizationIndex',0,99]],['--samples',['samples',1,300]],['--interval-seconds',['intervalSeconds',1,60]]]);
 for(let i=0;i<args.length;i+=2){const rule=flags.get(args[i]),value=args[i+1];assert.ok(rule&&!seen.has(rule[0])&&typeof value==='string'&&/^(0|[1-9][0-9]{0,2})$/.test(value));const number=Number(value);assert.ok(number>=rule[1]&&number<=rule[2]);seen.add(rule[0]);result[rule[0]]=number;}return result;
}
export function validatedObservationOptions(options){assert.ok(options&&Object.keys(options).sort().join(',')==='intervalSeconds,organizationIndex,samples');return observationOptions(['--organization-index',String(options.organizationIndex),'--samples',String(options.samples),'--interval-seconds',String(options.intervalSeconds)]);}
export async function observeAlertSamples(options,scope,{call,checkpoint,signal,now=()=>new Date(),pause=(ms,signal)=>sleep(ms,undefined,{signal})}){
 options=validatedObservationOptions(options);scope=seededDemoScope(scope);
 const samples=[];let criticalObserved=false,lastObserved=-Infinity;
 for(let index=0;index<options.samples;index++){
  signal?.throwIfAborted();const value=await call();signal?.throwIfAborted();let assessment,sampleAt,observed;
  try{assessment=verifiedOperationalAlertReport(value,scope);sampleAt=now();observed=Date.parse(assessment.observedAt);const age=sampleAt.getTime()-observed;assert.ok(Number.isFinite(age)&&age>=-5000&&age<=30000&&observed>=lastObserved);}catch{throw observationFailure('response-invalid');}lastObserved=observed;
  criticalObserved ||=assessment.status==='critical';samples.push({at:sampleAt.toISOString(),assessment});try{await checkpoint({samples:[...samples],criticalObserved});}catch{throw observationFailure('checkpoint-write-failed');}
  if(index+1<options.samples)await pause(options.intervalSeconds*1000,signal);
 }
 return {samples,criticalObserved};
}
export function initialObservationReport(options,scope){
 options=validatedObservationOptions(options);scope=seededDemoScope(scope);
 const {samples,...settings}=options;
 return {schemaVersion:1,completed:false,stage:'planned',criticalObserved:false,sessionScopeVerified:false,sessionLoggedOut:false,readOnlyMetadata:true,businessDataWrites:false,automatedRemediationPerformed:false,continuousMonitoringProven:false,releasePermissionVerified:false,serverDeployed:false,...scope,...settings,requestedSamples:samples,samples:[]};
}
export async function observeAlertSession(options,scope,{login,me,call,logout,checkpoint,signal,now,pause}){
 options=validatedObservationOptions(options);scope=seededDemoScope(scope);
 const report=initialObservationReport(options,scope);
 try{
  signal?.throwIfAborted();report.stage='login';await login();signal?.throwIfAborted();report.stage='session-scope';const identity=await me();try{assertDemoSessionScope(identity,scope,'admin');}catch{throw observationFailure('session-scope-invalid');}report.sessionScopeVerified=true;
  report.stage='sampling';Object.assign(report,await observeAlertSamples(options,scope,{call,signal,now,pause,checkpoint:async progress=>{Object.assign(report,progress);await checkpoint(report);}}));report.completed=true;
 }catch(error){report.failed=true;report.interrupted=signal?.aborted===true;report.failureStage=report.stage;report.failureCode=report.interrupted?'interrupted':safeObservationFailureCode(error);}
 finally{
  try{report.sessionLoggedOut=await logout()===true;}catch(error){report.cleanupFailed=true;report.cleanupFailureCode=safeObservationFailureCode(error,'session-cleanup-unconfirmed');}
  if(!report.sessionLoggedOut){report.cleanupFailed=true;report.cleanupFailureCode??='session-cleanup-unconfirmed';}if(signal?.aborted){report.interrupted=true;report.completed=false;report.failureCode??='interrupted';}report.completed=report.completed&&!report.cleanupFailed;report.stage='finished';report.finishedAt=new Date().toISOString();
  try{await checkpoint(report);}catch{report.completed=false;report.reportWriteFailed=true;report.reportWriteFailureCode='checkpoint-write-failed';}
 }
 return report;
}
