import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {localSmokeBase,fetchLocalSmoke} from './local-smoke-http.mjs';
import {readReleaseResponse} from './release-gate.mjs';
const exec=promisify(execFile);

export async function readinessSmoke({restartWorker=false}={}){
 assert.equal(typeof restartWorker,'boolean');localSmokeBase();
 const report={readinessVerified:false,workerInterruptionRequested:restartWorker,workerStaleRefused:false,existingHealthRemainedAvailable:false,workerRestored:false,noApiSessionCreated:true,businessDataWrites:false,newEvaluationsCreated:0,serverDeployed:false,completed:false};
 const files=process.env.AGENTTRUST_IMAGE?['-f','compose.yaml','-f','compose.image.yaml']:[];let restorationRequired=false;
 async function compose(args){await exec('docker',['compose',...files,...args],{windowsHide:true,timeout:120000,maxBuffer:1048576});}
 async function probe(path){const response=await fetchLocalSmoke(localSmokeBase(),path,{signal:AbortSignal.timeout(5000)});assert.equal(response.headers.get('set-cookie'),null);return {status:response.status,body:await readReleaseResponse(response)};}
 async function ready(){const result=await probe('/ready');assert.equal(result.status,200);assert.equal(result.body.status,'ready');assert.deepEqual(result.body.checks,{database:'ready',worker:'recent'});}
 try{
  await ready();report.readinessVerified=true;
  if(restartWorker){
   restorationRequired=true;await compose(['stop','-t','10','worker']);
   const deadline=Date.now()+30000;let stale=false;
   while(Date.now()<deadline){const result=await probe('/ready');if(result.status===503&&result.body.status==='not-ready'&&result.body.checks.database==='ready'&&['stale','missing'].includes(result.body.checks.worker)){stale=true;break;}assert.equal(result.status,200);await sleep(500);}
   assert.equal(stale,true);report.workerStaleRefused=true;
   const health=await probe('/health');assert.equal(health.status,200);assert.equal(health.body.status,'ok');assert.equal(health.body.persistent,true);report.existingHealthRemainedAvailable=true;
  }
 }finally{
  if(restorationRequired){await compose(['up','-d','--wait','worker']);await ready();report.workerRestored=true;}
 }
 report.completed=true;return report;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const args=process.argv.slice(2);assert.ok(args.length===0||(args.length===1&&args[0]==='--worker-restart'));console.log(JSON.stringify(await readinessSmoke({restartWorker:args.length===1})));}
 catch{console.error('Dependency readiness verification failed.');process.exitCode=1;}
}
