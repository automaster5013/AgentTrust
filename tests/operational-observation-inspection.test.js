import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {initialObservationReport} from '../scripts/operational-observation.mjs';
import {inspectOperationalObservation} from '../packages/operations/observation-evidence.js';
import {observationInspectionOptions,inspectObservationFile} from '../scripts/inspect-operations-observation.mjs';
const scope={organizationId:randomUUID(),projectId:randomUUID()},options={organizationIndex:0,samples:2,intervalSeconds:1};
const fixture=()=>{const r=initialObservationReport(options,scope);Object.assign(r,{stage:'finished',completed:true,sessionScopeVerified:true,sessionLoggedOut:true,finishedAt:'2026-10-09T09:00:02.000Z'});r.samples=[0,1].map(i=>({at:`2026-10-09T09:00:0${i}.000Z`,assessment:{schemaVersion:1,status:'warning',...scope,observedAt:`2026-10-09T09:00:0${i}.000Z`,alerts:[{code:'retained-capacity-high',severity:'warning',scope:'organization'}],readOnly:true,automatedRemediationPerformed:false,releasePermissionVerified:false,continuousMonitoringProven:false}}));return r;};
test('offline observation inspection summarizes scoped history without authenticating it or granting permission',()=>{
 const r=inspectOperationalObservation(fixture(),scope);assert.equal(r.samples,2);assert.equal(r.status,'warning');assert.equal(r.structureVerified,true);assert.equal(r.expectedScopeVerified,true);assert.deepEqual(r.sampleStatusCounts,{ok:0,warning:2,critical:0});for(const k of ['authenticityVerified','runtimeVerified','currentHealthVerified','currentReleasePermissionVerified','continuousMonitoringProven'])assert.equal(r[k],false);
 assert.equal(inspectOperationalObservation(fixture()).expectedScopeVerified,false);
});
test('initial observation journal always contains an inspectable empty sample array and requested count',()=>{
 const planned=initialObservationReport(options,{...scope,private:'secret'});assert.deepEqual(planned.samples,[]);assert.equal(planned.requestedSamples,2);assert.equal(inspectOperationalObservation(planned).status,'incomplete');assert.doesNotMatch(JSON.stringify(planned),/secret|private/);
});
test('observation inspector rejects contradictory completion, scope, booleans, status and unsupported claims',()=>{
 const mutations=[r=>r.samples.pop(),r=>r.sessionLoggedOut=false,r=>r.sessionScopeVerified=false,r=>r.failed=true,r=>r.interrupted=true,r=>r.cleanupFailed=true,r=>r.reportWriteFailed=true,r=>r.criticalObserved=true,r=>r.businessDataWrites=true,r=>r.samples[0].assessment.organizationId=randomUUID(),r=>r.samples[0].assessment.status='ok',r=>r.samples[0].assessment.alerts[0].severity='critical',r=>r.requestedSamples=301,r=>r.intervalSeconds=61,r=>r.organizationIndex=100,r=>r.completed='true',r=>r.stage='sampling',r=>r.privateToken='secret',r=>r.samples[0].assessment.alerts[0].message='secret',r=>r.samples[0].at='2026-10-09T09:00:00Z'];
 for(const mutate of mutations){const r=fixture();mutate(r);assert.throws(()=>inspectOperationalObservation(r));}
 assert.throws(()=>inspectOperationalObservation(fixture(),{...scope,projectId:randomUUID()}));assert.throws(()=>inspectOperationalObservation(fixture(),{organizationId:scope.organizationId}));
});
test('observation inspector refuses stale, future, backwards and impossible finish timestamps',()=>{
 for(const delta of [-30001,5001]){const r=fixture();r.samples[0].assessment.observedAt=new Date(Date.parse(r.samples[0].at)+delta).toISOString();assert.throws(()=>inspectOperationalObservation(r));}
 for(const mutate of [r=>r.samples[1].at='2026-10-09T08:59:59.999Z',r=>r.samples[1].assessment.observedAt='2026-10-09T08:59:59.999Z',r=>r.finishedAt='2026-10-09T08:59:59.999Z']){const r=fixture();mutate(r);assert.throws(()=>inspectOperationalObservation(r));}
});
test('partial and failed cleanup journals are explained as incomplete while critical completed history remains critical',()=>{
 const partial=fixture();partial.samples.pop();Object.assign(partial,{completed:false,failed:true,failureStage:'sampling',interrupted:true});assert.equal(inspectOperationalObservation(partial).status,'incomplete');
 const cleanup=fixture();Object.assign(cleanup,{completed:false,cleanupFailed:true,sessionLoggedOut:false});assert.equal(inspectOperationalObservation(cleanup).recordedSessionLoggedOut,false);
 const critical=fixture();critical.samples[1].assessment.alerts=[{code:'worker-not-recent',severity:'critical',scope:'service'}];critical.samples[1].assessment.status='critical';critical.criticalObserved=true;assert.equal(inspectOperationalObservation(critical).status,'critical');
});
test('offline inspection options reject partial scope, duplicates and unsupported arguments before file reads',()=>{
 const valid=observationInspectionOptions(['file.json','--organization-id',scope.organizationId.toUpperCase(),'--project-id',scope.projectId]);assert.deepEqual(valid.expected,scope);
 for(const args of [[],['--unknown'],['file','--organization-id',scope.organizationId],['file','--unknown','secret'],['file','--project-id','invalid'],['file','--project-id',scope.projectId,'--project-id',scope.projectId],['file','extra']])assert.throws(()=>observationInspectionOptions(args));
});
test('real offline CLI enforces bounded strict UTF-8 input, safe output and incomplete or critical exit codes',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'agenttrust-observation-inspection-'));const path=join(directory,'report.json');
 try{
  const invoke=()=>spawnSync(process.execPath,['scripts/inspect-operations-observation.mjs',path],{encoding:'utf8',timeout:10000});
  await writeFile(path,JSON.stringify(fixture()));assert.equal(invoke().status,0);assert.equal((await inspectObservationFile({path,expected:scope})).samples,2);
  const incomplete=fixture();incomplete.completed=false;await writeFile(path,JSON.stringify(incomplete));assert.equal(invoke().status,1);
  const critical=fixture();critical.samples[0].assessment.status='critical';critical.samples[0].assessment.alerts=[{code:'worker-not-recent',severity:'critical',scope:'service'}];critical.criticalObserved=true;await writeFile(path,JSON.stringify(critical));assert.equal(invoke().status,2);
  for(const data of [Buffer.from([0xff]),Buffer.alloc(1048577),JSON.stringify({...fixture(),secret:'DO-NOT-PRINT'})]){await writeFile(path,data);const r=invoke();assert.equal(r.status,2);assert.doesNotMatch(r.stdout+r.stderr,/DO-NOT-PRINT|secret/);}
 }finally{await rm(directory,{recursive:true,force:true});}
});
