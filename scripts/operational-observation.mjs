import assert from 'node:assert/strict';
import {setTimeout as sleep} from 'node:timers/promises';
import {verifiedOperationalAlertReport} from './operational-alert-probe.mjs';
import {seededDemoScope,assertDemoSessionScope} from './demo-session-scope.mjs';

export function observationOptions(args){
 const result={organizationIndex:0,samples:3,intervalSeconds:5},seen=new Set(),flags=new Map([['--organization-index',['organizationIndex',0,99]],['--samples',['samples',1,300]],['--interval-seconds',['intervalSeconds',1,60]]]);
 for(let i=0;i<args.length;i+=2){const rule=flags.get(args[i]),value=args[i+1];assert.ok(rule&&!seen.has(rule[0])&&typeof value==='string'&&/^(0|[1-9][0-9]{0,2})$/.test(value));const number=Number(value);assert.ok(number>=rule[1]&&number<=rule[2]);seen.add(rule[0]);result[rule[0]]=number;}return result;
}
export function validatedObservationOptions(options){assert.ok(options&&Object.keys(options).sort().join(',')==='intervalSeconds,organizationIndex,samples');return observationOptions(['--organization-index',String(options.organizationIndex),'--samples',String(options.samples),'--interval-seconds',String(options.intervalSeconds)]);}
export async function observeAlertSamples(options,scope,{call,checkpoint,signal,now=()=>new Date(),pause=(ms,signal)=>sleep(ms,undefined,{signal})}){
 options=validatedObservationOptions(options);scope=seededDemoScope(scope);
 const samples=[];let criticalObserved=false,lastObserved=-Infinity;
 for(let index=0;index<options.samples;index++){
  signal?.throwIfAborted();const value=await call();signal?.throwIfAborted();const assessment=verifiedOperationalAlertReport(value,scope),sampleAt=now(),observed=Date.parse(assessment.observedAt),age=sampleAt.getTime()-observed;
  assert.ok(Number.isFinite(age)&&age>=-5000&&age<=30000&&observed>=lastObserved);lastObserved=observed;
  criticalObserved ||=assessment.status==='critical';samples.push({at:sampleAt.toISOString(),assessment});await checkpoint({samples:[...samples],criticalObserved});
  if(index+1<options.samples)await pause(options.intervalSeconds*1000,signal);
 }
 return {samples,criticalObserved};
}
export async function observeAlertSession(options,scope,{login,me,call,logout,checkpoint,signal,now,pause}){
 options=validatedObservationOptions(options);scope=seededDemoScope(scope);
 const report={schemaVersion:1,completed:false,stage:'planned',samples:[],criticalObserved:false,sessionScopeVerified:false,sessionLoggedOut:false,readOnlyMetadata:true,businessDataWrites:false,automatedRemediationPerformed:false,continuousMonitoringProven:false,releasePermissionVerified:false,serverDeployed:false,...scope,...options};
 try{
  signal?.throwIfAborted();report.stage='login';await login();signal?.throwIfAborted();report.stage='session-scope';assertDemoSessionScope(await me(),scope,'admin');report.sessionScopeVerified=true;
  report.stage='sampling';Object.assign(report,await observeAlertSamples(options,scope,{call,signal,now,pause,checkpoint:async progress=>{Object.assign(report,progress);await checkpoint(report);}}));report.completed=true;
 }catch{report.failed=true;report.interrupted=signal?.aborted===true;report.failureStage=report.stage;}
 finally{
  try{report.sessionLoggedOut=await logout()===true;}catch{report.cleanupFailed=true;}
  if(!report.sessionLoggedOut)report.cleanupFailed=true;if(signal?.aborted){report.interrupted=true;report.completed=false;}report.completed=report.completed&&!report.cleanupFailed;report.stage='finished';report.finishedAt=new Date().toISOString();
  try{await checkpoint(report);}catch{report.completed=false;report.reportWriteFailed=true;}
 }
 return report;
}
