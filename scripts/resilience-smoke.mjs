import {localSmokeBase,fetchLocalSmoke} from './local-smoke-http.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile,writeFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import {readReleaseResponse} from './release-gate.mjs';
async function main(){
let base;try{base=localSmokeBase();}catch{console.error('A valid local smoke port is required.');process.exitCode=2;return;}

const configuration=JSON.parse((await readFile('.local/credentials.json','utf8')).replace(/^\uFEFF/,''));
const accessKey=configuration.organizations[0].credentials.find(actor=>actor.role==='admin').token;
let cookie,run,workerStopped=false;
async function call(path,{method='GET',data,key}={}){
  const response=await fetchLocalSmoke(base,path,{method,headers:{'Content-Type':'application/json','X-AgentTrust-Request':'local-ui',...(cookie?{Cookie:cookie}:{}),...(key?{'Idempotency-Key':key}:{})},...(data?{body:JSON.stringify(data)}:{})});
  if(path==='/v1/auth/login')cookie=response.headers.get('set-cookie')?.split(';')[0];
  if(!response.ok){await response.body?.cancel();throw new Error(`Resilience smoke request failed (${response.status}).`);}
  return readReleaseResponse(response);
}
async function compose(args){
  const child=spawn('docker',['compose',...args],{stdio:'ignore',windowsHide:true});
  await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error('AgentTrust worker lifecycle command failed.')));});
}
async function until(check,timeout){
  const deadline=Date.now()+timeout;
  for(;;){const value=await check();if(value)return value;if(Date.now()>=deadline)throw new Error('Resilience state did not arrive before the test deadline.');await setTimeout(100);}
}
try{
  await call('/v1/auth/login',{method:'POST',data:{accessKey}});
  const catalog=await call('/v1/catalog');
  run=await call('/v1/runs',{method:'POST',key:randomUUID(),data:{agentVersionId:catalog.agent.find(agent=>agent.mode==='slow').id,datasetVersionId:catalog.dataset[0].id,policyVersionId:catalog.policy.find(policy=>!policy.requiresManualApproval).id,timeoutMs:120000,maxAttempts:3}});
  assert.equal(run.snapshot.policy.requiresManualApproval===true,false,'Use a policy without administrator review for worker recovery smoke.');
  const claimed=await until(async()=>{const current=await call('/v1/runs/'+run.id);return current.state==='running'?current:null;},10000);
  assert.equal(claimed.attempts,1);
  workerStopped=true;await compose(['stop','worker']);
  const stranded=await call('/v1/runs/'+run.id);assert.equal(stranded.state,'running');assert.equal(stranded.gate.deploymentAllowed,false);
  await until(async()=>{const status=await call('/v1/operations');return status.worker.state==='stale'&&status.queue.expiredLeases>=1?status:null;},25000);
  await compose(['up','-d','--wait','worker']);workerStopped=false;
  const recovered=await until(async()=>{const current=await call('/v1/runs/'+run.id);return current.state==='succeeded'?current:null;},20000);
  assert.equal(recovered.attempts,2);assert.equal(recovered.snapshotHash,claimed.snapshotHash);assert.equal(recovered.gate.deploymentAllowed,true);
  const events=await call('/v1/audit-events');assert.equal(events.filter(event=>event.resource_id===run.id&&event.action==='run.succeeded').length,1);
  const report={runId:run.id,snapshotHash:recovered.snapshotHash,resultHash:recovered.resultHash,attempts:recovered.attempts,stoppedWorkerBlockedRelease:true,staleHeartbeatObserved:true,expiredLeaseRecovered:true,completionAuditCount:1,verifiedAt:new Date().toISOString()};
  await writeFile('.local/resilience-smoke-'+run.id+'.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log('Docker resilience smoke: interrupted worker blocked release, stale heartbeat surfaced, expired lease recovered exactly once.');
}finally{
  try{if(workerStopped)await compose(['up','-d','--wait','worker']);
    if(run){const current=await call('/v1/runs/'+run.id);if(['queued','running'].includes(current.state))await call('/v1/runs/'+run.id+'/cancel',{method:'POST',data:{}});}
  }finally{if(cookie)await call('/v1/auth/logout',{method:'POST',data:{}});}
}
}
main().catch(()=>{console.error('Local resilience smoke did not complete. Check AgentTrust worker state and private records.');process.exitCode=1;});
