import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {observationOptions,observeAlertSamples,observeAlertSession} from '../scripts/operational-observation.mjs';
const scope={organizationId:randomUUID(),projectId:randomUUID()},at=new Date('2026-10-09T04:00:00.000Z');
const assessment=(alerts=[])=>({schemaVersion:1,status:alerts.some(a=>a.severity==='critical')?'critical':alerts.length?'warning':'ok',...scope,observedAt:at.toISOString(),alerts,readOnly:true,automatedRemediationPerformed:false,releasePermissionVerified:false,continuousMonitoringProven:false});
const options=observationOptions(['--samples','3']);
test('bounded operational observation validates every argument before requesting credentials',()=>{
 assert.deepEqual(observationOptions([]),{organizationIndex:0,samples:3,intervalSeconds:5});for(const args of [['--samples','0'],['--samples','301'],['--interval-seconds','0'],['--interval-seconds','61'],['--organization-index','100'],['--samples','03'],['--samples','1','--samples','2'],['--unknown','private'],['--samples']])assert.throws(()=>observationOptions(args));
});
test('scoped observations preserve warning and critical samples without inventing continuous monitoring or permission',async()=>{
 let calls=0;const snapshots=[],pauses=[],alerts=[[],[{code:'retained-capacity-high',severity:'warning',scope:'organization'}],[{code:'worker-not-recent',severity:'critical',scope:'service'}]];
 const r=await observeAlertSamples(options,scope,{call:async()=>assessment(alerts[calls++]),checkpoint:async r=>snapshots.push(r),now:()=>at,pause:async ms=>pauses.push(ms)});
 assert.equal(calls,3);assert.deepEqual(pauses,[5000,5000]);assert.deepEqual(r.samples.map(s=>s.assessment.status),['ok','warning','critical']);assert.equal(r.criticalObserved,true);assert.deepEqual(snapshots.map(r=>r.samples.length),[1,2,3]);assert.ok(r.samples.every(s=>!s.assessment.releasePermissionVerified&&!s.assessment.continuousMonitoringProven));
});
test('an invalid later response keeps the last completed checkpoint and stops further reads',async()=>{
 let calls=0;const saved=[];await assert.rejects(observeAlertSamples(options,scope,{call:async()=>{calls++;return calls===1?assessment():{...assessment(),organizationId:randomUUID()};},checkpoint:async r=>saved.push(r),now:()=>at,pause:async()=>{}}));assert.equal(calls,2);assert.equal(saved.length,1);assert.equal(saved[0].samples.length,1);
});
test('observation rejects stale, future and regressing database timestamps',async()=>{
 for(const delta of [-30001,5001])await assert.rejects(observeAlertSamples(options,scope,{call:async()=>({...assessment(),observedAt:new Date(at.getTime()+delta).toISOString()}),checkpoint:async()=>{},now:()=>at,pause:async()=>{}}));
 let calls=0;await assert.rejects(observeAlertSamples(options,scope,{call:async()=>({...assessment(),observedAt:new Date(at.getTime()-(calls++?1:0)).toISOString()}),checkpoint:async()=>{},now:()=>at,pause:async()=>{}}));assert.equal(calls,2);
});
test('checkpoint write failure stops observations without emitting a successful completion',async()=>{
 let calls=0;await assert.rejects(observeAlertSamples(options,scope,{call:async()=>{calls++;return assessment();},checkpoint:async()=>{throw Error('Private journal failure');},now:()=>at,pause:async()=>{}}));assert.equal(calls,1);
});
test('pre-interrupted observation makes no requests and interruption during a request writes no success sample',async()=>{
 const controller=new AbortController();controller.abort();let calls=0;await assert.rejects(observeAlertSamples(options,scope,{signal:controller.signal,call:async()=>{calls++;return assessment();},checkpoint:async()=>{}}));assert.equal(calls,0);
 const mid=new AbortController();await assert.rejects(observeAlertSamples(options,scope,{signal:mid.signal,call:async()=>{mid.abort();return assessment();},checkpoint:async()=>assert.fail('Interrupted evidence must not be completed')}));
});
test('session scope failure stops alert reads, logs out and records only a safe failure stage',async()=>{
 let reads=0,logouts=0;const r=await observeAlertSession(options,scope,{login:async()=>{},me:async()=>({...scope,role:'viewer',private:'secret'}),call:async()=>{reads++;},logout:async()=>{logouts++;return true;},checkpoint:async()=>{}});assert.equal(r.completed,false);assert.equal(r.failureStage,'session-scope');assert.equal(reads,0);assert.equal(logouts,1);assert.equal(r.sessionLoggedOut,true);assert.doesNotMatch(JSON.stringify(r),/secret/);
});
test('observation failure or interrupted request still cleans up its own acquired session',async()=>{
 for(const interrupted of [false,true]){const controller=new AbortController();let logouts=0;const r=await observeAlertSession(options,scope,{signal:controller.signal,login:async()=>{},me:async()=>({...scope,role:'admin'}),call:async()=>{if(interrupted)controller.abort();throw Error('Private transport credentials');},logout:async()=>{logouts++;return true;},checkpoint:async()=>{}});assert.equal(r.completed,false);assert.equal(r.interrupted,interrupted);assert.equal(logouts,1);assert.equal(r.sessionLoggedOut,true);assert.equal(r.failureStage,'sampling');assert.doesNotMatch(JSON.stringify(r),/Private|credentials/);}
});
test('successful samples followed by failed logout never produce a completed observation',async()=>{
 const r=await observeAlertSession(options,scope,{login:async()=>{},me:async()=>({...scope,role:'admin'}),call:async()=>assessment(),now:()=>at,pause:async()=>{},logout:async()=>{throw Error('Private cleanup failure');},checkpoint:async()=>{}});assert.equal(r.samples.length,3);assert.equal(r.completed,false);assert.equal(r.cleanupFailed,true);assert.equal(r.sessionLoggedOut,false);
});
test('interruption during logout preserves cleanup but never claims uninterrupted completion',async()=>{
 const controller=new AbortController();const r=await observeAlertSession({...options,samples:1},scope,{signal:controller.signal,login:async()=>{},me:async()=>({...scope,role:'admin'}),call:async()=>assessment(),now:()=>at,logout:async()=>{controller.abort();return true;},checkpoint:async()=>{}});assert.equal(r.samples.length,1);assert.equal(r.sessionLoggedOut,true);assert.equal(r.interrupted,true);assert.equal(r.completed,false);
});
test('programmatic observation rejects unexpected options before login and strips unrelated scope fields',async()=>{
 let loginCalls=0;const deps={login:async()=>{loginCalls++;},me:async()=>({...scope,role:'admin'}),call:async()=>assessment(),now:()=>at,pause:async()=>{},logout:async()=>true,checkpoint:async()=>{}};await assert.rejects(observeAlertSession({...options,private:'secret'},scope,deps));assert.equal(loginCalls,0);const r=await observeAlertSession(options,{...scope,private:'secret'},deps);assert.equal(r.completed,true);assert.doesNotMatch(JSON.stringify(r),/secret/);
});

test('initial observation failures distinguish requested samples from an empty verified sample list',async()=>{
 const scope={organizationId:randomUUID(),projectId:randomUUID()},options=observationOptions([]);
 for(const stage of ['pre-interrupted','foreign-session']){const c=new AbortController();if(stage==='pre-interrupted')c.abort();const checkpoints=[];const r=await observeAlertSession(options,scope,{signal:c.signal,login:async()=>{},me:async()=>({...scope,role:'viewer'}),call:async()=>assert.fail('No alert request is allowed'),logout:async()=>true,checkpoint:async r=>checkpoints.push(structuredClone(r))});assert.equal(r.completed,false);assert.equal(r.requestedSamples,3);assert.deepEqual(r.samples,[]);assert.equal(r.sessionLoggedOut,true);assert.deepEqual(checkpoints.at(-1).samples,[]);assert.equal(checkpoints.at(-1).requestedSamples,3);}
});
