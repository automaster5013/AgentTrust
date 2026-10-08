import test from 'node:test';
import assert from 'node:assert/strict';
import {stagingOptions,stagingTarget,stagingDropStatement} from '../scripts/staging-target.mjs';
import {boundedStagingWaves} from '../scripts/staging-waves.mjs';
import {stagingBenchmark} from '../scripts/staging-benchmark.mjs';

function environment(){const env={PORT:'4310',DB_PORT:'55432'};for(const [prefix,role,key] of [['OWNER_','owner','DB_OWNER_PASSWORD'],['','api','DB_API_PASSWORD'],['WORKER_','worker','DB_WORKER_PASSWORD']]){env[key]='a'.repeat(48);for(const [test,name] of [['','agenttrust'],['TEST_','agenttrust_test']])env[test+prefix+'DATABASE_URL']='postgres://agenttrust_'+role+':'+env[key]+'@127.0.0.1:55432/'+name;}return env;}
test('isolated staging workload rejects excessive, ambiguous and uneven user counts before database work',()=>{
 assert.equal(stagingOptions([]).users,20);assert.equal(stagingOptions(['--users','2','--samples','1']).samples,1);
 for(const args of [['--users','3'],['--users','22'],['--samples','21'],['--concurrency','21'],['--workers','5'],['--duration-minutes','241'],['--round-interval-seconds','1'],['--users','02'],['--users','2','--users','4'],['--unknown','private-value']])assert.throws(()=>stagingOptions(args));
});
test('staging connection and drop guards preserve original database targets and refuse every non-created target',()=>{
 const env=environment(),before=JSON.stringify(env),name='agenttrust_stage_'+'a'.repeat(32),target=stagingTarget(env,name);assert.equal(JSON.stringify(env),before);assert.equal(new URL(target.apiUrl).pathname,'/'+name);assert.equal(new URL(target.ownerUrl).username,'agenttrust_owner');assert.equal(new URL(target.workerUrl).hostname,'127.0.0.1');assert.equal(stagingDropStatement(name,name),'DROP DATABASE "'+name+'"');
 for(const unsafe of ['agenttrust','agenttrust_test','agenttrust_restore_'+'a'.repeat(32),name+'; DROP DATABASE agenttrust;',name.toUpperCase()]){assert.throws(()=>stagingTarget(env,unsafe));assert.throws(()=>stagingDropStatement(unsafe,unsafe));}
 assert.throws(()=>stagingDropStatement(name,'agenttrust_stage_'+'b'.repeat(32)));assert.throws(()=>stagingTarget({...env,DATABASE_URL:env.DATABASE_URL.replace('127.0.0.1','remote.example')},name));
});
test('bounded staging waves wait for started sibling requests on failure and never schedule later waves',async()=>{
 const events=[];let drained=false;const tasks=[async()=>{events.push('failed');throw Error('Expected fixture failure.');},async()=>{await new Promise(resolve=>setTimeout(resolve,30));events.push('drained');drained=true;},async()=>events.push('must-not-start')];
 await assert.rejects(boundedStagingWaves(tasks,2));assert.equal(drained,true);assert.deepEqual(events,['failed','drained']);
});
test('staging request admission bounds active work and rejects excessive tasks before invocation',async()=>{
 let active=0,peak=0;const result=await boundedStagingWaves(Array.from({length:9},()=>async()=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,5));active--;}),3);assert.equal(peak,3);assert.equal(result.maximumInFlight,3);assert.equal(result.completed,9);assert.equal(active,0);await assert.rejects(boundedStagingWaves(Array(1601).fill(()=>{}),1));await assert.rejects(boundedStagingWaves([],21));
});
test('interrupted actual isolated staging work logs out its own sessions, removes only its temporary database and preserves security',async()=>{
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
 let report;try{report=await stagingBenchmark(stagingOptions(['--users','2','--samples','1']),process.env,{signal:controller.signal});}finally{clearTimeout(timer);}
 assert.equal(report.completed,false);assert.equal(report.interrupted,true);assert.equal(report.ownSessionsLoggedOut,true);assert.equal(report.temporaryDatabaseRemoved,true);assert.equal(report.originalSecurityCatalogUnchangedVerified,true);assert.equal(report.originalDatabaseBusinessWrites,false);assert.equal(report.serverDeployed,false);assert.equal(report.cleanupFailed,undefined);
});
