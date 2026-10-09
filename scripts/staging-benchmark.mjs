import assert from 'node:assert/strict';
import {randomUUID,generateKeyPairSync} from 'node:crypto';
import {privateJournal} from './private-journal.mjs';
import {mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import packageMetadata from '../package.json' with {type:'json'};
import {setTimeout as pause} from 'node:timers/promises';
import {pool} from '../apps/api/database.js';
import {createApp} from '../apps/api/server.js';
import {PgStore} from '../apps/api/pg-store.js';
import {Auth} from '../apps/api/auth.js';
import {CI} from '../apps/api/ci.js';
import {WorkerEngine} from '../apps/worker/engine.js';
import {heartbeat} from '../apps/worker/health.js';
import {sampleDataset} from '../packages/contracts/samples.js';
import {verifyReceipt,ReceiptSigner} from '../packages/receipts/signature.js';
import {seedOrganization} from './setup.mjs';
import {migrate} from './migrate.mjs';
import {securityFingerprint} from './recovery.mjs';
import {fetchLocalSmoke,localSmokeBase} from './local-smoke-http.mjs';
import {readReleaseResponse} from './release-gate.mjs';
import {assertDemoSessionScope} from './demo-session-scope.mjs';
import {summarizeDurations} from './metadata-benchmark-scenario.mjs';
import {stagingOptions,stagingTarget,stagingDropStatement} from './staging-target.mjs';
import {boundedStagingWaves} from './staging-waves.mjs';

import {ensureDemoReviewPolicy} from './demo-policy-version.mjs';
import {assertDemoReceiptBinding} from './demo-receipt-binding.mjs';
import {stagingScenario} from './staging-scenario.mjs';
const routes=['/v1/me','/v1/catalog','/v1/runs?limit=25','/v1/usage'];
export async function stagingBenchmark(options,env=process.env,{signal}={}){
 // Validate the complete option set and every original loopback connection before DDL.
 const normalized=stagingOptions(Object.entries(options).flatMap(([key,value])=>{const flag={users:'--users',samples:'--samples',concurrency:'--concurrency',workers:'--workers',scenario:'--scenario',durationMinutes:'--duration-minutes',roundIntervalSeconds:'--round-interval-seconds'}[key];assert.ok(flag);return [flag,String(value)];}));
 const target=stagingTarget(env,'agenttrust_stage_'+randomUUID().replaceAll('-',''));
 const report={schemaVersion:1,completed:false,synthetic:true,isolatedDatabase:true,temporaryDatabaseName:target.name,stage:'planned',originalDatabaseBusinessWrites:false,serverDeployed:false,customerConnectionPerformed:false,commercialSlaProven:false,exactDockerRuntimeProven:false,...normalized,rounds:0,acceptedRuns:0,completedRuns:0,peakQueuedOrRunning:0,peakRunningObserved:0,maximumInFlightMetadata:0,distinctViewerPrincipals:0,metadataResponsesScopeVerified:false,originalSecurityCatalogUnchangedVerified:false,ownSessionsLoggedOut:false,temporaryDatabaseRemoved:false,startedAt:new Date().toISOString(),results:[],evaluationOutcomes:{pass:0,block:0,inconclusive:0},signedReleaseGatesVerified:0,manualApprovalCyclesVerified:0,manualReviewRunsLeftRejectedVerified:false};
 const reportPath='.local/staging-benchmark-'+randomUUID()+'.json',timings=new Map(routes.map(route=>[route,[]]));
 let main,owner,api,worker,server,createdName,base,stopping=false,beatTask,securityBefore;
 const controller=new AbortController(),interrupt=()=>{report.interrupted=true;controller.abort();};
 if(signal?.aborted)interrupt();else signal?.addEventListener('abort',interrupt,{once:true});
 process.on('SIGINT',interrupt);process.on('SIGTERM',interrupt);
 const engines=[],loops=[],sessions=[],organizations=[],runIds=new Map(),expectedRuns=new Map();
 const beat=async()=>{while(!stopping){await heartbeat(worker);await pause(1000);}};
 async function call(session,path,data,extra={}){
  const response=await fetchLocalSmoke(base,path,{method:data?'POST':'GET',headers:{'Content-Type':'application/json','X-AgentTrust-Request':'local-ui','X-AgentTrust-Project':session.projectId,...(session.cookie?{Cookie:session.cookie}:{}),...extra},...(path==='/v1/auth/logout'?{}:{signal:controller.signal}),...(data?{body:JSON.stringify(data)}:{})});
  if(path==='/v1/auth/login')session.cookie=response.headers.get('set-cookie')?.split(';')[0];
  if(!response.ok){await response.body?.cancel();throw Error('Isolated staging request failed.');}return readReleaseResponse(response);
 }
 const journal=privateJournal(reportPath);
 const checkpoint=()=>journal.checkpoint({...report,results:[...timings].filter(([,values])=>values.length).map(([path,values])=>({path,...summarizeDurations(values)}))});
 try{
  await mkdir('.local',{recursive:true});await journal.initialize(report);
  controller.signal.throwIfAborted();report.sourceVersion=packageMetadata.version;report.sourceRevision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],timeout:15000}).trim();assert.match(report.sourceRevision,/^[a-f0-9]{40}$/);report.sourceWorkspaceClean=execFileSync('git',['status','--porcelain'],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],timeout:15000}).trim()==='';report.privateDraftImplementation=import.meta.url.includes('/.local/');main=pool(env.OWNER_DATABASE_URL);const client=await main.connect();try{await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');securityBefore=await securityFingerprint(client);await client.query('ROLLBACK');}finally{client.release();}
  // This generated name is the only database this process may create or drop.
  await main.query('CREATE DATABASE "'+target.name+'"');createdName=target.name;report.stage='database-created';await checkpoint();
  owner=pool(target.ownerUrl);api=pool(target.apiUrl);worker=pool(target.workerUrl);await migrate(owner);report.stage='schema-migrated';await checkpoint();
  for(let index=0;index<2;index++)organizations.push(await seedOrganization(owner,'Isolated staging '+index,['admin',...Array(normalized.users/2).fill('viewer')]));
  const pair=generateKeyPairSync('ed25519'),signer=new ReceiptSigner(pair.privateKey.export({type:'pkcs8',format:'pem'}));
  server=createApp({database:api,store:new PgStore(api),auth:new Auth(api),ci:new CI(api,{signer})});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});base=localSmokeBase(String(server.address().port));
  for(const org of organizations){org.sessions=[];runIds.set(org.organizationId,new Set());for(const credential of org.credentials){const session={organizationId:org.organizationId,projectId:org.projectId,role:credential.role};sessions.push(session);await call(session,'/v1/auth/login',{accessKey:credential.token});assert.ok(session.cookie);assertDemoSessionScope(await call(session,'/v1/me'),session,session.role);org.sessions.push(session);}org.admin=org.sessions.find(s=>s.role==='admin');org.caseCount=org===organizations[0]?3:2;let selectedDataset;if(org.caseCount===2)selectedDataset=await call(org.admin,'/v1/dataset-versions',{...sampleDataset,name:'Isolated asymmetric two-case fixture',cases:sampleDataset.cases.slice(0,2)});org.catalog=await call(org.admin,'/v1/catalog');org.input={agentVersionId:org.catalog.agent.find(v=>v.mode==='compliant').id,datasetVersionId:selectedDataset?.id||org.catalog.dataset[0].id,policyVersionId:org.catalog.policy[0].id,timeoutMs:30000};if(normalized.scenario==='mixed'){org.manualPolicyId=(await ensureDemoReviewPolicy({call:(path,data)=>call(org.admin,path,data),policies:org.catalog.policy,name:'Isolated synthetic load administrator review'})).id;org.catalog=await call(org.admin,'/v1/catalog');}org.versionIds=new Set(Object.values(org.catalog).flat().map(v=>v.id));}
  const viewerMemberships=new Set();for(const session of sessions.filter(s=>s.role==='viewer'))viewerMemberships.add((await call(session,'/v1/me')).membershipId);
  report.distinctViewerPrincipals=viewerMemberships.size;assert.equal(report.distinctViewerPrincipals,normalized.users);
  const viewers=organizations.flatMap(org=>org.sessions.filter(s=>s.role==='viewer').map(session=>({org,session})));
  function verify(path,value,org,session){
   if(path==='/v1/me')assertDemoSessionScope(value,session,'viewer');
   else if(path==='/v1/catalog'){assert.deepEqual(Object.keys(value).sort(),['agent','dataset','policy']);for(const versions of Object.values(value)){assert.ok(Array.isArray(versions));for(const version of versions)assert.ok(org.versionIds.has(version.id));}assert.equal(Object.values(value).flat().length,org.versionIds.size);}
   else if(path.startsWith('/v1/runs')){assert.ok(Array.isArray(value.items)&&value.items.length<=25);for(const run of value.items){assert.ok(runIds.get(org.organizationId).has(run.id));assert.equal(run.snapshot,undefined);assert.equal(run.results,undefined);}}
   else {assert.ok(Number.isSafeInteger(value.completed_runs)&&value.completed_runs>=0);assert.ok(Number.isSafeInteger(value.evaluated_cases)&&value.evaluated_cases>=0);assert.ok(Number.isSafeInteger(value.attempts)&&value.attempts>=0);}
  }
  const started=performance.now(),end=started+normalized.durationMinutes*60000;
  do{
   const roundStarted=performance.now(),roundIds=[];
   // The first round proves admission of 10 active executions in each organization before workers start.
   for(const org of organizations)for(let i=0;i<10;i++){const scenario=stagingScenario(normalized.scenario,i),input={...org.input,agentVersionId:org.catalog.agent.find(v=>v.mode===scenario.mode).id,...(scenario.manual?{policyVersionId:org.manualPolicyId}:{})};const run=await call(org.admin,'/v1/runs',input,{'Idempotency-Key':randomUUID()});assert.equal(run.state,'queued');expectedRuns.set(run.id,{...scenario,input,org});runIds.get(org.organizationId).add(run.id);roundIds.push(run.id);report.acceptedRuns++;}
   const admitted=(await owner.query("SELECT count(*)::int AS active,count(*) FILTER(WHERE state='running')::int AS running FROM agenttrust.runs WHERE state IN ('queued','running')")).rows[0];report.peakQueuedOrRunning=Math.max(report.peakQueuedOrRunning,admitted.active);if(report.rounds===0)assert.equal(admitted.active,20);
   if(!engines.length){for(let i=0;i<normalized.workers;i++){const engine=new WorkerEngine(worker,{pollMs:20});engines.push(engine);loops.push(engine.loop());}beatTask=beat().catch(()=>{report.heartbeatFailed=true;});}
   for(const path of routes){
    await boundedStagingWaves(viewers.map(({org,session})=>async()=>verify(path,await call(session,path),org,session)),normalized.concurrency);
    const tasks=Array.from({length:normalized.samples},()=>viewers.map(({org,session})=>async()=>{const t=performance.now();const value=await call(session,path);const elapsed=performance.now()-t;verify(path,value,org,session);timings.get(path).push(elapsed);})).flat();
    const wave=await boundedStagingWaves(tasks,normalized.concurrency);report.maximumInFlightMetadata=Math.max(report.maximumInFlightMetadata,wave.maximumInFlight);
   }
   const deadline=performance.now()+35000;let finished;
   do{const rows=(await owner.query('SELECT id,state,outcome FROM agenttrust.runs WHERE id=ANY($1::uuid[])',[roundIds])).rows;assert.equal(rows.length,20);report.peakRunningObserved=Math.max(report.peakRunningObserved,rows.filter(r=>r.state==='running').length);finished=rows.every(r=>r.state===expectedRuns.get(r.id).state&&r.outcome?.gate?.decision===expectedRuns.get(r.id).decision);if(rows.some(r=>!['queued','running'].includes(r.state)&&(r.state!==expectedRuns.get(r.id).state||r.outcome?.gate?.decision!==expectedRuns.get(r.id).decision)))throw Error('Isolated evaluation did not match its synthetic scenario.');if(!finished)await pause(100);}while(!finished&&performance.now()<deadline);
   assert.equal(finished,true);assert.equal(report.heartbeatFailed,undefined);
   for(const id of roundIds){const expected=expectedRuns.get(id);report.evaluationOutcomes[expected.decision]++;if(normalized.scenario!=='mixed')continue;
    const run=await call(expected.org.admin,'/v1/runs/'+id);assert.equal(run.state,expected.state);assert.equal(run.gate.decision,expected.decision);const {timeoutMs,...input}=expected.input,request={candidateRunId:id,...input};
    async function gate(allowed,status){const receipt=await call(expected.org.admin,'/v1/release-gate',request);assert.equal(receipt.deploymentAllowed,allowed);assert.equal(receipt.decision,allowed?'pass':'block');if(status)assert.equal(receipt.manualApproval.status,status);const verified=verifyReceipt(receipt,signer.publicMetadata().publicKey);assert.equal(verified.organizationId,expected.org.organizationId);assert.equal(verified.projectId,expected.org.projectId);assertDemoReceiptBinding(receipt,request,run);report.signedReleaseGatesVerified++;}
    if(expected.manual){await gate(false,'missing');await call(expected.org.admin,'/v1/runs/'+id+'/reviews',{decision:'approved',comment:'Isolated synthetic load approval.'},{'Idempotency-Key':randomUUID()});await gate(true,'approved');await call(expected.org.admin,'/v1/runs/'+id+'/reviews',{decision:'rejected',comment:'Isolated synthetic load cleanup: leave this run blocked.'},{'Idempotency-Key':randomUUID()});await gate(false,'rejected');report.manualApprovalCyclesVerified++;}
    else await gate(expected.decision==='pass');
   }
   if(normalized.scenario==='mixed')report.manualReviewRunsLeftRejectedVerified=true;

   const accounting=(await owner.query('SELECT count(*)::int AS total,count(DISTINCT run_id)::int AS distinct_runs,sum(evaluated_cases)::int AS cases,sum(attempts)::int AS attempts FROM agenttrust.usage_events')).rows[0];assert.equal(accounting.total,report.acceptedRuns);assert.equal(accounting.distinct_runs,report.acceptedRuns);assert.equal(accounting.cases,report.acceptedRuns/20*organizations.reduce((sum,org)=>sum+10*org.caseCount,0));report.exactlyOnceScopedAccountingVerified=true;assert.equal(accounting.attempts,report.acceptedRuns);
   report.completedRuns=report.acceptedRuns;report.rounds++;report.metadataResponsesScopeVerified=true;report.elapsedMs=Math.round(performance.now()-started);await checkpoint();
   for(const org of organizations)for(const session of org.sessions.filter(s=>s.role==='viewer')){const usage=await call(session,'/v1/usage');assert.equal(usage.completed_runs,report.rounds*10);assert.equal(usage.evaluated_cases,report.rounds*10*org.caseCount);assert.equal(usage.attempts,report.rounds*10);}
   for(const {org,session} of viewers){const foreign=organizations.find(value=>value!==org),foreignId=runIds.get(foreign.organizationId).values().next().value;const response=await fetchLocalSmoke(base,'/v1/runs/'+foreignId,{headers:{Cookie:session.cookie,'X-AgentTrust-Project':session.projectId},signal:controller.signal});assert.equal(response.status,404);await response.body?.cancel();}report.foreignOrganizationRunReadsRefused=true;report.organizationCaseCounts=organizations.map(org=>org.caseCount);
   report.stage='round-verified';await checkpoint();
   const delay=Math.min(end-performance.now(),normalized.roundIntervalSeconds*1000-(performance.now()-roundStarted));if(delay>0)await pause(Math.ceil(delay)+1,undefined,{signal:controller.signal});
  }while(performance.now()<end);
  report.results=[...timings].map(([path,values])=>({path,...summarizeDurations(values)}));report.p95TargetMs=500;report.p95TargetMet=report.results.every(r=>r.p95Ms<=500);report.completed=true;
 }catch{report.completed=false;report.failed=true;report.failureStage=report.stage;}
 finally{
  stopping=true;try{const stopped=await Promise.allSettled(engines.map(engine=>engine.stop()));if(stopped.some(r=>r.status==='rejected'))report.cleanupFailed=true;await Promise.all(loops);if(beatTask)await beatTask;}catch{report.cleanupFailed=true;}
  let logout=true;for(const session of sessions)if(session.cookie)try{await call(session,'/v1/auth/logout',{});session.cookie=undefined;}catch{logout=false;}report.ownSessionsLoggedOut=logout;
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  for(const connection of [api,worker,owner])if(connection)try{await connection.end();}catch{report.cleanupFailed=true;}
  if(createdName&&main)try{await main.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[createdName]);await main.query(stagingDropStatement(target.name,createdName));report.temporaryDatabaseRemoved=(await main.query('SELECT datname FROM pg_database WHERE datname=$1',[createdName])).rowCount===0;}catch{report.cleanupFailed=true;}
  if(main){try{const client=await main.connect();try{await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');report.originalSecurityCatalogUnchangedVerified=(await securityFingerprint(client))===securityBefore;await client.query('ROLLBACK');}finally{client.release();}}catch{report.cleanupFailed=true;}try{await main.end();}catch{report.cleanupFailed=true;}}
  report.completed=report.completed&&!report.interrupted&&!report.cleanupFailed&&report.ownSessionsLoggedOut&&report.temporaryDatabaseRemoved&&report.originalSecurityCatalogUnchangedVerified;report.stage='finished';report.finishedAt=new Date().toISOString();try{await checkpoint();}catch{report.completed=false;report.reportWriteFailed=true;}
  process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',interrupt);signal?.removeEventListener('abort',interrupt);
 }
 return {...report,reportPath};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{const r=await stagingBenchmark(stagingOptions(process.argv.slice(2)));console.log(JSON.stringify({status:r.completed?'passed':'blocked',completed:r.completed,synthetic:true,originalDatabaseBusinessWrites:false,serverDeployed:false,commercialSlaProven:false,users:r.users,scenario:r.scenario,evaluationOutcomes:r.evaluationOutcomes,signedReleaseGatesVerified:r.signedReleaseGatesVerified,manualApprovalCyclesVerified:r.manualApprovalCyclesVerified,manualReviewRunsLeftRejectedVerified:r.manualReviewRunsLeftRejectedVerified,workers:r.workers,rounds:r.rounds,acceptedRuns:r.acceptedRuns,completedRuns:r.completedRuns,peakQueuedOrRunning:r.peakQueuedOrRunning,peakRunningObserved:r.peakRunningObserved,maximumInFlightMetadata:r.maximumInFlightMetadata,p95TargetMet:r.p95TargetMet,results:r.results,ownSessionsLoggedOut:r.ownSessionsLoggedOut,temporaryDatabaseRemoved:r.temporaryDatabaseRemoved,originalSecurityCatalogUnchangedVerified:r.originalSecurityCatalogUnchangedVerified,reportPath:r.reportPath}));if(!r.completed)process.exitCode=1;else if(!r.p95TargetMet)process.exitCode=2;}catch{console.error('Isolated staging benchmark could not be verified.');process.exitCode=1;}}
