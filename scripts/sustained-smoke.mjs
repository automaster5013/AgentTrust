import {localSmokeBase,fetchLocalSmoke} from './local-smoke-http.mjs';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {pool} from '../apps/api/database.js';
import {verifyReceipt} from '../packages/receipts/signature.js';
import {readReleaseResponse} from './release-gate.mjs';
import {seededDemoScope,assertDemoSessionScope} from './demo-session-scope.mjs';
import {runLimits} from '../packages/contracts/run-quota-error.js';
const base=localSmokeBase();
const options={cycles:5,intervalMs:10000,organizationIndex:0},seen=new Set();
for(let i=2;i<process.argv.length;i+=2){
 const flag=process.argv[i],value=process.argv[i+1],name=flag==='--cycles'?'cycles':flag==='--interval-ms'?'intervalMs':flag==='--organization-index'?'organizationIndex':null;
 if(!name||seen.has(name)||!value||!(name==='organizationIndex'?/^(0|[1-9][0-9]?)$/:/^[1-9][0-9]{0,5}$/).test(value)){console.error('Use --cycles 1..30, --interval-ms 1000..60000 and --organization-index 0..99 once each.');process.exit(2);}
 seen.add(name);options[name]=Number(value);
}
if(options.cycles>30||options.intervalMs<1000||options.intervalMs>60000){console.error('Use --cycles 1..30 and --interval-ms 1000..60000 once each.');process.exit(2);}
const reportPath='.local/sustained-smoke-'+randomUUID()+'.json';
const credentials=JSON.parse(await readFile('.local/credentials.json','utf8')),publicKey=await readFile('.local/receipt-signing/public.pem','utf8'),owner=pool(process.env.OWNER_DATABASE_URL),started=Date.now(),active=new Set(),report={startedAt:new Date().toISOString(),targetCycles:options.cycles,intervalMs:options.intervalMs,cycles:0,runs:[],transientRetries:0};let cookie,scope,stopping=false;
process.on('SIGINT',()=>{stopping=true;});process.on('SIGTERM',()=>{stopping=true;});
async function call(path,data,idempotencyKey=randomUUID()){
 const until=Date.now()+15000;
 for(;;){let r;try{r=await fetchLocalSmoke(base,path,{method:data?'POST':'GET',signal:AbortSignal.timeout(5000),headers:{'Content-Type':'application/json','X-AgentTrust-Request':'local-ui','X-AgentTrust-Project':scope.projectId,'Idempotency-Key':idempotencyKey,...(cookie?{Cookie:cookie}:{})},...(data?{body:JSON.stringify(data)}:{})});}catch{if(Date.now()>=until)throw new Error('Local soak transport did not recover.');report.transientRetries++;await sleep(200);continue;}
  if(path==='/v1/auth/login')cookie=r.headers.get('set-cookie')?.split(';')[0]||cookie;
  if(r.status===503&&Date.now()<until){await r.body?.cancel();report.transientRetries++;await sleep(200);continue;}
  if(!r.ok){await r.body?.cancel();throw Error('Local soak HTTP '+r.status);}
  return readReleaseResponse(r);
 }
}
async function wait(id,predicate=r=>!['queued','running'].includes(r.state)){
 const until=Date.now()+45000;for(;;){const r=await call('/v1/runs/'+id);if(predicate(r))return r;if(Date.now()>=until)throw new Error('Local soak run did not finish.');await sleep(50);}
}
async function execute(mode,expectedState,expectedDecision,extra={},cancel=false){
 const agent=inputs.agent.find(a=>a.mode===mode),input={agentVersionId:agent.id,datasetVersionId:inputs.dataset.id,policyVersionId:inputs.policy.id,timeoutMs:30000,caseBudget:100,...extra},run=await call('/v1/runs',input);active.add(run.id);
 if(cancel){await wait(run.id,r=>r.state==='running');await call('/v1/runs/'+run.id+'/cancel',{});}const done=await wait(run.id);assert.equal(done.state,expectedState);assert.equal(done.gate.decision,expectedDecision);assert.equal(done.gate.deploymentAllowed,expectedDecision==='pass');active.delete(run.id);
 assert.equal(done.organizationId,scope.organizationId);assert.equal(done.projectId,scope.projectId);
 report.runs.push({id:done.id,mode,cancel,timeoutMs:input.timeoutMs,state:done.state,decision:done.gate.decision,cases:done.results.length,attempts:done.attempts});return {run:done,input};
}
let inputs;
try{
 const organization=credentials.organizations?.[options.organizationIndex];scope=seededDemoScope(organization);const key=organization.credentials.find(k=>k.role==='admin')?.token;assert.ok(typeof key==='string'&&key.length>=16);
 Object.assign(report,{organizationIndex:options.organizationIndex,...scope});
 await call('/v1/auth/login',{accessKey:key});assertDemoSessionScope(await call('/v1/me'),scope,'admin');report.sessionScopeVerified=true;
  report.capacityPreflight={status:'invalid_capacity',requestedRuns:options.cycles*9};
 const operations=await call('/v1/operations'),capacity=operations.executionCapacity;
 assert.equal(capacity?.scope,'organization');assert.equal(capacity.organizationId,scope.organizationId);assert.ok(Number.isFinite(Date.parse(operations.observedAt)));
 for(const [name,limit] of [['retained',runLimits.history],['active',runLimits.active]]){const value=capacity[name];assert.ok(value&&Number.isSafeInteger(value.used)&&value.used>=0);assert.equal(value.limit,limit);assert.equal(value.remaining,Math.max(0,limit-value.used));}
 assert.ok(capacity.active.used<=capacity.retained.used);
 Object.assign(report.capacityPreflight,{observedAt:operations.observedAt,retainedRemaining:capacity.retained.remaining,activeRemaining:capacity.active.remaining});
 if(capacity.retained.remaining<report.capacityPreflight.requestedRuns){report.capacityPreflight.status='insufficient_retained';throw Error('Requested sustained runs exceed observed retained capacity.');}
 if(capacity.active.remaining<1){report.capacityPreflight.status='no_active_slot';throw Error('No observed active execution slot.');}
 report.capacityPreflight.status='passed';
 const catalog=await call('/v1/catalog');inputs={agent:catalog.agent,dataset:catalog.dataset.find(d=>d.name==='Customer support safety · v1'),policy:catalog.policy.find(p=>!p.requiresManualApproval)};assert.ok(inputs.dataset&&inputs.policy);
 for(let cycle=0;cycle<report.targetCycles&&!stopping;cycle++){
  let candidate,regression;for(const [mode,state,decision] of [['compliant','succeeded','pass'],['regression','succeeded','block'],['forbidden_tool','succeeded','block'],['error','failed','inconclusive'],['missing_evidence','succeeded','inconclusive'],['unsafe_output','succeeded','block'],['slow','succeeded','pass']]){const done=await execute(mode,state,decision);if(mode==='compliant')candidate=done;if(mode==='regression')regression=done;}
  await execute('slow','timed_out','inconclusive',{timeoutMs:100});await execute('slow','cancelled','inconclusive',{},true);
  for(const [item,allowed] of [[candidate,true],[regression,false]]){const receipt=await call('/v1/release-gate',{candidateRunId:item.run.id,agentVersionId:item.input.agentVersionId,datasetVersionId:item.input.datasetVersionId,policyVersionId:item.input.policyVersionId});assert.equal(receipt.deploymentAllowed,allowed);assert.equal(verifyReceipt(receipt,publicKey).signatureVerified,true);}
  await call('/health');const operations=await call('/v1/operations');assert.equal(operations.worker.state,'recent');report.cycles++;report.lastCycleAt=new Date().toISOString();await writeFile(reportPath,JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({cycle:report.cycles,runs:report.runs.length,transientRetries:report.transientRetries,worker:operations.worker.state}));
  const next=started+(cycle+1)*options.intervalMs;if(cycle+1<report.targetCycles&&next>Date.now())await sleep(next-Date.now());
 }
 const ids=report.runs.map(r=>r.id),params=[ids,scope.organizationId,scope.projectId],usage=await owner.query('SELECT count(*) AS count,coalesce(sum(u.evaluated_cases),0) AS cases FROM agenttrust.usage_events u JOIN agenttrust.runs r ON r.id=u.run_id AND r.organization_id=u.organization_id WHERE u.run_id=ANY($1::uuid[]) AND r.organization_id=$2 AND r.project_id=$3',params),audits=await owner.query("SELECT a.resource_id,count(*) AS count FROM agenttrust.audit_events a JOIN agenttrust.runs r ON r.id=a.resource_id AND r.organization_id=a.organization_id WHERE a.resource_id=ANY($1::uuid[]) AND r.organization_id=$2 AND r.project_id=$3 AND a.action IN ('run.succeeded','run.failed','run.cancelled','run.timed_out') GROUP BY a.resource_id",params);assert.equal(Number(usage.rows[0].count),ids.length);assert.equal(Number(usage.rows[0].cases),report.runs.reduce((sum,r)=>sum+r.cases,0));assert.equal(audits.rows.length,ids.length);assert.ok(audits.rows.every(row=>Number(row.count)===1));report.exactlyOnceUsageAndAudit=true;report.completed=!stopping&&report.cycles===report.targetCycles;
 if(stopping)process.exitCode=130;
}catch{report.completed=false;report.failed=true;console.error('Local soak failed; private report retains completed synthetic run metadata.');process.exitCode=1;}
finally{
 for(const id of active)try{await call('/v1/runs/'+id+'/cancel',{});}catch{report.cleanupFailed=true;process.exitCode=1;}
 report.sessionLoggedOut=!cookie;if(cookie)try{await call('/v1/auth/logout',{});report.sessionLoggedOut=true;}catch{report.sessionLoggedOut=false;process.exitCode=1;}
 await owner.end();report.finishedAt=new Date().toISOString();await writeFile(reportPath,JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({completed:report.completed,capacityPreflightStatus:report.capacityPreflight?.status||'not_reached',cycles:report.cycles,runs:report.runs.length,exactlyOnceUsageAndAudit:report.exactlyOnceUsageAndAudit||false,sessionLoggedOut:report.sessionLoggedOut,reportPath}));
}
