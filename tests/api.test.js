import sampleAcceptanceProfile from '../examples/connector-contract/acceptance-profile.json' with {type:'json'};
import {validateAcceptanceProfile} from '../packages/evaluator/acceptance-profile.js';
import { CI } from '../apps/api/ci.js';
import { checkRelease } from '../scripts/release-gate.mjs';
import test from 'node:test';
import { request as httpRequest } from 'node:http';
import assert from 'node:assert/strict';
import { randomUUID,generateKeyPairSync } from 'node:crypto';
import { ReceiptSigner,verifyReceipt } from '../packages/receipts/signature.js';
import { createApp } from '../apps/api/server.js';
import { pool,transaction } from '../apps/api/database.js';
import { Auth } from '../apps/api/auth.js';
import { PgStore,incomplete,finalize } from '../apps/api/pg-store.js';
import { WorkerEngine } from '../apps/worker/engine.js';
import { heartbeat } from '../apps/worker/health.js';
import { evaluate } from '../packages/evaluator/index.js';
import { seedOrganization } from '../scripts/setup.mjs';
import { tokenHash,hash } from '../packages/contracts/hash.js';

const headers={'Content-Type':'application/json','X-AgentTrust-Request':'local-ui'};
async function fixture(t,{ciOptions,authOptions}={}) {
  if(!process.env.TEST_DATABASE_URL||new URL(process.env.TEST_DATABASE_URL).pathname!=='/agenttrust_test') throw new Error('Run npm run setup; integration tests require the isolated agenttrust_test database.');
  const owner=pool(process.env.TEST_OWNER_DATABASE_URL), database=pool(process.env.TEST_DATABASE_URL), workerDb=pool(process.env.TEST_WORKER_DATABASE_URL);
  const first=await seedOrganization(owner,`Test ${randomUUID()}`),other=await seedOrganization(owner,`Other ${randomUUID()}`);
  const store=new PgStore(database),auth=new Auth(database,authOptions),engine=new WorkerEngine(workerDb,{leaseMs:1500,pollMs:20});
  const server=createApp({database,store,auth,ci:new CI(database,ciOptions)});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const cookies={}; const contexts={};
  for(const source of [first,other]) for(const credential of source.credentials) {
    const role=source===first?credential.role:`other_${credential.role}`;
    const response=await fetch(`${base}/v1/auth/login`,{method:'POST',headers,body:JSON.stringify({accessKey:credential.token})});
    assert.equal(response.status,200);const cookie=response.headers.get('set-cookie');
    assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);
    cookies[role]=cookie.split(';')[0];
    contexts[role]=await auth.authenticate(cookie.split(';')[0].split('=')[1]);
  }
  const request=(path,{role='admin',method='GET',json,extra={}}={})=>fetch(`${base}${path}`,{method,headers:{...headers,Cookie:cookies[role],...extra},...(json!==undefined?{body:JSON.stringify(json)}:{})});
  const catalog=await store.catalog(contexts.admin);
  const input=(mode='compliant',extras={})=>({agentVersionId:catalog.agent.find(a=>a.mode===mode).id,datasetVersionId:catalog.dataset[0].id,policyVersionId:catalog.policy[0].id,...extras});
  const create=(mode='compliant',extras={})=>store.createRun(contexts.admin,input(mode,extras),randomUUID());
  t.after(async()=>{await engine.stop();for(const role of ['admin','other_admin']){for(const run of await store.listRuns(contexts[role])){if(['queued','running'].includes(run.state))await store.cancel(contexts[role],run.id);}}server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await Promise.all([owner.end(),database.end(),workerDb.end()]);});
  return {owner,database,workerDb,first,other,store,auth,engine,server,base,request,cookies,contexts,catalog,input,create};
}
async function waitFor(store,context,id,predicate,limit=5000) {
  const started=Date.now();
  while(Date.now()-started<limit){const run=await store.getRun(context,id);if(predicate(run))return run;await new Promise(resolve=>setTimeout(resolve,20));}
  throw new Error('Run did not reach expected state.');
}

test('active execution capacity reports its reason and still replays an existing request',async t=>{
 const f=await fixture(t),key=randomUUID(),body=f.input();
 const first=await f.request('/v1/runs',{method:'POST',json:body,extra:{'Idempotency-Key':key}});assert.equal(first.status,202);const original=await first.json();
 const requests=await Promise.all(Array.from({length:10},()=>f.request('/v1/runs',{method:'POST',json:body,extra:{'Idempotency-Key':randomUUID()}})));
 assert.equal(requests.filter(r=>r.status===202).length,9);const blocked=requests.find(r=>r.status===429);assert.ok(blocked);assert.equal((await blocked.json()).code,'run_active_limit');
 const replay=await f.request('/v1/runs',{method:'POST',json:body,extra:{'Idempotency-Key':key}});assert.equal(replay.status,200);assert.equal((await replay.json()).id,original.id);
 const counts=await f.owner.query('SELECT count(*)::int AS total FROM agenttrust.runs WHERE organization_id=$1',[f.first.organizationId]);assert.equal(counts.rows[0].total,10);
 const viewer=await f.request('/v1/runs',{role:'viewer',method:'POST',json:body,extra:{'Idempotency-Key':randomUUID()}});assert.equal(viewer.status,403);assert.equal((await viewer.json()).code,undefined);
 const foreign=await f.store.catalog(f.contexts.other_admin),other=await f.request('/v1/runs',{role:'other_admin',method:'POST',json:{agentVersionId:foreign.agent[0].id,datasetVersionId:foreign.dataset[0].id,policyVersionId:foreign.policy[0].id},extra:{'Idempotency-Key':randomUUID()}});assert.equal(other.status,202);
});

test('retained execution capacity is distinct and does not reject a matching idempotent replay',async t=>{
 const f=await fixture(t),key=randomUUID(),body=f.input(),first=await f.request('/v1/runs',{method:'POST',json:body,extra:{'Idempotency-Key':key}});assert.equal(first.status,202);const original=await first.json();
 const client=await f.owner.connect(),outcome=incomplete('cancelled','Synthetic retained-capacity fixture');
 try{await client.query('BEGIN');
  await client.query(`INSERT INTO agenttrust.runs(id,organization_id,project_id,agent_version_id,dataset_version_id,policy_version_id,idempotency_key,fingerprint,snapshot,snapshot_hash,timeout_ms,case_budget,max_attempts,deadline)
   SELECT gen_random_uuid(),organization_id,project_id,agent_version_id,dataset_version_id,policy_version_id,'quota-'||gen_random_uuid()::text,fingerprint,snapshot,snapshot_hash,timeout_ms,case_budget,max_attempts,deadline FROM agenttrust.runs CROSS JOIN generate_series(1,9999) WHERE id=$1`,[original.id]);
  await client.query("UPDATE agenttrust.runs SET state='cancelled',outcome=$2,result_hash=$3,completed_at=clock_timestamp(),lease_token=NULL,lease_until=NULL WHERE organization_id=$1 AND state='queued'",[f.first.organizationId,outcome,hash({results:outcome.results,gate:outcome.gate})]);await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 const blocked=await f.request('/v1/runs',{method:'POST',json:body,extra:{'Idempotency-Key':randomUUID()}});assert.equal(blocked.status,429);assert.equal((await blocked.json()).code,'run_history_limit');
 const replay=await f.request('/v1/runs',{method:'POST',json:body,extra:{'Idempotency-Key':key}});assert.equal(replay.status,200);assert.equal((await replay.json()).id,original.id);
 const counts=await f.owner.query("SELECT count(*)::int AS total,count(*) FILTER(WHERE state IN ('queued','running'))::int AS active FROM agenttrust.runs WHERE organization_id=$1",[f.first.organizationId]);assert.deepEqual(counts.rows[0],{total:10000,active:0});
});

test('authenticated HTTP flow persists versions and evaluates all mock modes',async t=>{
  const f=await fixture(t);
  const sample=await(await f.request('/v1/sample-dataset')).json();
  const imported=await f.request('/v1/dataset-versions',{method:'POST',json:{...sample,name:'Imported'}});
  assert.equal(imported.status,201);const dataset=await imported.json();
  for(const agent of f.catalog.agent){
    const body={...f.input(agent.mode),datasetVersionId:dataset.id};const key=randomUUID();
    const response=await f.request('/v1/runs',{method:'POST',json:body,extra:{'Idempotency-Key':key}});assert.equal(response.status,202);const run=await response.json();
    await f.engine.tick();const final=await f.store.getRun(f.contexts.admin,run.id);
    assert.ok(['succeeded','failed'].includes(final.state));assert.equal(final.gate.deploymentAllowed,['compliant','slow'].includes(agent.mode));
    assert.equal((await(await f.request(`/v1/runs/${run.id}/results`)).json()).length,3);
    const replay=await f.request('/v1/runs',{method:'POST',json:body,extra:{'Idempotency-Key':key}});assert.equal(replay.status,200);assert.equal((await replay.json()).id,run.id);
  }
  const recreatedPool=pool(process.env.TEST_DATABASE_URL);
  try{assert.equal((await new PgStore(recreatedPool).catalog(f.contexts.admin)).dataset.length,2);assert.equal((await new PgStore(recreatedPool).listRuns(f.contexts.admin)).length,7);}
  finally{await recreatedPool.end();}
});
test('organization boundaries protect catalog, results, downloads and foreign version references',async t=>{
  const f=await fixture(t);const {run}=await f.create();await f.engine.tick();
  for(const suffix of ['', '/results','/gate'])assert.equal((await f.request(`/v1/runs/${run.id}${suffix}`,{role:'other_admin'})).status,404);
  assert.equal((await f.request(`/v1/runs/${run.id}/cancel`,{role:'other_admin',method:'POST',json:{}})).status,404);
  const foreign=await f.store.catalog(f.contexts.other_admin);assert.ok(foreign.agent.every(v=>!f.catalog.agent.some(a=>a.id===v.id)));
  assert.equal((await f.request('/v1/runs',{role:'other_admin',method:'POST',json:f.input(),extra:{'Idempotency-Key':randomUUID()}})).status,404);
  assert.equal((await f.store.listRuns(f.contexts.other_admin)).length,0);
  const rows=await transaction(f.database,async c=>(await c.query('SELECT * FROM agenttrust.runs WHERE id=$1',[run.id])).rows,f.other.organizationId);assert.equal(rows.length,0);
  await assert.rejects(()=>transaction(f.database,c=>c.query('INSERT INTO agenttrust.audit_events(id,organization_id,action) VALUES($1,$2,$3)',[randomUUID(),f.first.organizationId,'spoof']),f.other.organizationId),/row-level security/);
});
test('RBAC separates viewer, editor and admin capabilities',async t=>{
  const f=await fixture(t);const {run}=await f.create();
  assert.equal((await f.request('/v1/catalog',{role:'viewer'})).status,200);
  assert.equal((await f.request(`/v1/runs/${run.id}`,{role:'viewer'})).status,200);
  assert.equal((await f.request('/v1/runs',{role:'viewer',method:'POST',json:f.input(),extra:{'Idempotency-Key':randomUUID()}})).status,403);
  assert.equal((await f.request(`/v1/runs/${run.id}/cancel`,{role:'viewer',method:'POST',json:{}})).status,403);
  assert.equal((await f.request('/v1/policy-versions',{role:'editor',method:'POST',json:{name:'Relaxed',minimumPassRate:0}})).status,403);
  assert.equal((await f.request('/v1/audit-events',{role:'editor'})).status,403);
  assert.equal((await f.request('/v1/agent-versions',{role:'editor',method:'POST',json:{name:'new',mode:'compliant'}})).status,201);
  assert.equal((await f.request('/v1/policy-versions',{method:'POST',json:{name:'strict',minimumPassRate:1}})).status,201);
});
test('authentication rejects anonymous, expired, revoked and logged-out sessions',async t=>{
  const f=await fixture(t);
  assert.equal((await fetch(`${f.base}/v1/catalog`)).status,401);
  assert.equal((await fetch(`${f.base}/v1/auth/login`,{method:'POST',headers,body:JSON.stringify({accessKey:'invalid'})})).status,401);
  const expired=f.cookies.editor.split('=')[1];
  await f.owner.query('UPDATE agenttrust.sessions SET expires_at=now()-interval \'1 second\' WHERE token_hash=$1',[tokenHash(expired)]);
  assert.equal((await f.request('/v1/me',{role:'editor'})).status,401);
  await f.owner.query('UPDATE agenttrust.credentials SET revoked_at=now() WHERE id=$1',[f.first.credentials.find(c=>c.role==='viewer').id]);
  assert.equal((await f.request('/v1/me',{role:'viewer'})).status,401);
  assert.equal((await f.request('/v1/auth/logout',{method:'POST',json:{}})).status,200);
  assert.equal((await f.request('/v1/me')).status,401);
});
test('idempotency under concurrent submission is organization scoped and atomic',async t=>{
  const f=await fixture(t),key=randomUUID();
  const values=await Promise.all(Array.from({length:8},()=>f.store.createRun(f.contexts.admin,f.input(),key)));
  assert.equal(new Set(values.map(v=>v.run.id)).size,1);assert.equal(values.filter(v=>!v.replay).length,1);
  const reversed=Object.fromEntries(Object.entries(f.input()).reverse());assert.equal((await f.store.createRun(f.contexts.admin,reversed,key)).run.id,values[0].run.id);
  await assert.rejects(()=>f.store.createRun(f.contexts.admin,f.input('regression'),key),/conflict/);
  const otherCatalog=await f.store.catalog(f.contexts.other_admin);
  const otherRun=await f.store.createRun(f.contexts.other_admin,{agentVersionId:otherCatalog.agent[0].id,datasetVersionId:otherCatalog.dataset[0].id,policyVersionId:otherCatalog.policy[0].id},key);
  assert.notEqual(otherRun.run.id,values[0].run.id);
});
test('snapshot survives source changes and database privileges prevent version/result mutations',async t=>{
  const f=await fixture(t);const {run}=await f.create();
  const sample=structuredClone(run.snapshot.dataset);delete sample.id;delete sample.createdAt;delete sample.contentHash;
  sample.cases[0].mock.output='changed';await f.store.createVersion(f.contexts.admin,'dataset',sample);
  run.snapshot.policy.minimumPassRate=0;await f.engine.tick();
  const final=await f.store.getRun(f.contexts.admin,run.id);assert.equal(final.gate.decision,'pass');assert.equal(final.snapshot.policy.minimumPassRate,1);
  await assert.rejects(()=>transaction(f.database,c=>c.query("UPDATE agenttrust.versions SET data='{}' WHERE id=$1",[run.datasetVersionId]),f.first.organizationId),/permission denied/);
  await assert.rejects(()=>f.owner.query("UPDATE agenttrust.runs SET state='failed' WHERE id=$1",[run.id]),/Terminal runs are immutable/);
});
test('competing workers claim once and stale completion cannot duplicate audit or usage',async t=>{
  const f=await fixture(t);const {run}=await f.create();
  const second=new WorkerEngine(f.workerDb,{leaseMs:1500});
  const claims=await Promise.all([f.engine.claim(),second.claim()]);assert.equal(claims.filter(Boolean).length,1);const claimed=claims.find(Boolean);
  await f.engine.execute(claimed);
  assert.equal(await second.complete(claimed,incomplete('failed','stale')),false);
  const usage=await f.owner.query('SELECT * FROM agenttrust.usage_events WHERE run_id=$1',[run.id]);assert.equal(usage.rowCount,1);
  const terminalAudit=await f.owner.query("SELECT * FROM agenttrust.audit_events WHERE resource_id=$1 AND action='run.succeeded'",[run.id]);assert.equal(terminalAudit.rowCount,1);
});
test('expired lease recovers after a worker crash and fences the old attempt',async t=>{
  const f=await fixture(t);const {run}=await f.create();const old=await f.engine.claim();
  await f.owner.query("UPDATE agenttrust.runs SET lease_until=now()-interval '1 second' WHERE id=$1",[run.id]);
  const recovery=await f.engine.claim();assert.equal(recovery.attempts,2);assert.notEqual(recovery.lease_token,old.lease_token);
  assert.equal(await f.engine.complete(old,incomplete('failed','old worker')),false);
  await f.engine.execute(recovery);assert.equal((await f.store.getRun(f.contexts.admin,run.id)).gate.decision,'pass');
  assert.equal((await f.owner.query('SELECT count(*) FROM agenttrust.usage_events WHERE run_id=$1',[run.id])).rows[0].count,'1');
});
test('queued and running cancellation are final and reject late results',async t=>{
  const f=await fixture(t);const queued=(await f.create()).run;
  const cancelled=await f.store.cancel(f.contexts.admin,queued.id);assert.equal(cancelled.state,'cancelled');assert.equal(cancelled.gate.deploymentAllowed,false);
  const active=(await f.create('slow')).run;
  const execution=f.engine.tick();await waitFor(f.store,f.contexts.admin,active.id,r=>r.state==='running');
  assert.equal((await f.store.cancel(f.contexts.editor,active.id)).state,'cancelled');await execution;
  assert.equal((await f.store.getRun(f.contexts.admin,active.id)).state,'cancelled');
  await f.store.cancel(f.contexts.admin,active.id);
  assert.equal((await f.owner.query('SELECT count(*) FROM agenttrust.usage_events WHERE run_id=$1',[active.id])).rows[0].count,'1');
});
test('time budget, case budget and exhausted attempts never allow deployment',async t=>{
  const f=await fixture(t);
  const timeout=(await f.create('slow',{timeoutMs:200})).run;await f.engine.tick();
  const final=await f.store.getRun(f.contexts.admin,timeout.id);assert.equal(final.state,'timed_out');assert.equal(final.gate.deploymentAllowed,false);
  const budget=(await f.create('compliant',{caseBudget:1})).run;await f.engine.tick();assert.equal((await f.store.getRun(f.contexts.admin,budget.id)).state,'failed');
  const retry=(await f.create('compliant',{maxAttempts:1})).run;await f.engine.claim();
  await f.owner.query("UPDATE agenttrust.runs SET lease_until=now()-interval '1 second' WHERE id=$1",[retry.id]);await f.engine.sweep();
  assert.equal((await f.store.getRun(f.contexts.admin,retry.id)).gate.deploymentAllowed,false);
  const queued=(await f.create('compliant',{timeoutMs:100})).run;await new Promise(resolve=>setTimeout(resolve,150));await f.engine.sweep();assert.equal((await f.store.getRun(f.contexts.admin,queued.id)).state,'timed_out');
});
test('audit is append-only, scoped and contains no raw tokens or dataset content',async t=>{
  const f=await fixture(t);const {run}=await f.create();await f.engine.tick();
  const events=await(await f.request('/v1/audit-events')).json();assert.ok(events.some(e=>e.action==='run.queued'));assert.ok(events.some(e=>e.action==='run.succeeded'));
  const text=JSON.stringify(events);for(const c of f.first.credentials)assert.ok(!text.includes(c.token));assert.ok(!text.includes('환불 정책'));
  const otherEvents=await(await f.request('/v1/audit-events',{role:'other_admin'})).json();assert.ok(otherEvents.every(e=>e.resource_id!==run.id));
  await assert.rejects(()=>transaction(f.database,c=>c.query('DELETE FROM agenttrust.audit_events WHERE organization_id=$1',[f.first.organizationId]),f.first.organizationId),/permission denied/);
});
test('API rejects cross-origin, rebinding, malformed bodies, excessive requests and hidden files',async t=>{
  const f=await fixture(t);
  assert.equal((await f.request('/v1/catalog',{extra:{Origin:'https://evil.test'}})).status,403);
  const status=await new Promise((resolve,reject)=>{const req=httpRequest(`${f.base}/health`,{headers:{Host:'evil.test'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});assert.equal(status,403);
  assert.equal((await fetch(`${f.base}/v1/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
  assert.equal((await fetch(`${f.base}/v1/auth/login`,{method:'POST',headers,body:'{invalid'})).status,400);
  assert.equal((await f.request('/.env')).status,404);
  assert.equal((await f.request('/v1/agent-versions',{method:'POST',json:{name:'x'.repeat(270000),mode:'compliant'}})).status,413);
  for(let i=0;i<10;i++)await f.create();await assert.rejects(()=>f.create(),/quota/);
});
test('UI uses strict CSP and text-only output rendering',async t=>{
  const f=await fixture(t);const page=await fetch(f.base);assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy'),/script-src 'self'/);
  const js=await(await fetch(`${f.base}/app.js`)).text();assert.doesNotMatch(js,/innerHTML|outerHTML|insertAdjacentHTML|eval\(/);assert.match(js,/element.textContent = text/);
  assert.match(await page.text(),/id="login-form"/);
});


test('concurrent logins enforce the active-session limit without exposing access keys',async t=>{
  const f=await fixture(t);const key=f.first.credentials.find(c=>c.role==='admin');
  const outcomes=await Promise.allSettled(Array.from({length:24},()=>f.auth.login(key.token)));
  assert.equal(outcomes.filter(o=>o.status==='fulfilled').length,19);
  assert.ok(outcomes.filter(o=>o.status==='rejected').every(o=>o.reason.status===429));
  const count=await f.owner.query('SELECT count(*) FROM agenttrust.sessions WHERE credential_id=$1',[key.id]);assert.equal(Number(count.rows[0].count),20);
});

test('release API and CI bridge enforce versions, baseline coverage, tenant boundaries and read-only access',async t=>{
  const f=await fixture(t);const baseline=(await f.create()).run;await f.engine.tick();
  const candidate=(await f.create()).run;await f.engine.tick();
  const expected=f.input();
  const request={candidateRunId:candidate.id,baselineRunId:baseline.id,...expected};
  const response=await f.request('/v1/release-gate',{role:'viewer',method:'POST',json:request});assert.equal(response.status,200);assert.equal((await response.json()).deploymentAllowed,true);
  const compare=await f.request('/v1/compare',{role:'viewer',method:'POST',json:request});assert.equal((await compare.json()).comparable,true);
  assert.equal((await f.request('/v1/compare',{role:'other_admin',method:'POST',json:request})).status,404);
  const denied=await f.request('/v1/release-gate',{method:'POST',json:{...request,agentVersionId:'incorrect'}});assert.equal((await denied.json()).deploymentAllowed,false);
  const cli=await checkRelease({base:f.base+'/',accessKey:f.first.credentials.find(c=>c.role==='viewer').token,...request});assert.equal(cli.deploymentAllowed,true);
  const https=await f.store.createVersion(f.contexts.admin,'agent',{name:'Disabled external',mode:'https',connectorId:'unconfigured',endpointHash:'a'.repeat(64)});
  const external=(await f.store.createRun(f.contexts.admin,{...expected,agentVersionId:https.id},randomUUID())).run;await f.engine.tick();
  const failed=await f.store.getRun(f.contexts.admin,external.id);assert.equal(failed.state,'failed');assert.equal(failed.gate.decision,'inconclusive');
});

test('project CI keys are one-time, scoped, expiring and revocable; receipts are immutable and audited',async t=>{
  const f=await fixture(t);const {run}=await f.create();await f.engine.tick();
  const input={name:'Pipeline',projectId:f.contexts.admin.projectId,ttlSeconds:3600};
  for(const role of ['viewer','editor'])assert.equal((await f.request('/v1/ci-credentials',{role,method:'POST',json:input})).status,403);
  const issued=await f.request('/v1/ci-credentials',{method:'POST',json:input});assert.equal(issued.status,201);const credential=await issued.json();assert.match(credential.token,/^atci_[a-f0-9]{64}$/);
  const listed=await(await f.request('/v1/ci-credentials')).json();assert.ok(!JSON.stringify(listed).includes(credential.token));assert.ok(!listed.some(c=>c.token_hash));
  const bearer={Authorization:`Bearer ${credential.token}`};
  const check={candidateRunId:run.id,...f.input()};
  const response=await f.request('/v1/release-gate',{method:'POST',json:check,extra:bearer});assert.equal(response.status,200);const receipt=await response.json();assert.equal(receipt.deploymentAllowed,true);assert.match(receipt.artifactHash,/^[a-f0-9]{64}$/);
  const retrieved=await f.request(`/v1/release-receipts/${receipt.artifact.receiptId}`);assert.equal(retrieved.status,200);assert.equal((await retrieved.json()).artifactHash,receipt.artifactHash);
  assert.equal((await f.request(`/v1/release-receipts/${receipt.artifact.receiptId}`,{role:'other_admin'})).status,404);
  const receipts=await(await f.request('/v1/release-receipts',{role:'viewer'})).json();assert.ok(receipts.some(r=>r.id===receipt.artifact.receiptId));
  for(const path of ['/v1/runs','/v1/catalog','/v1/me','/v1/ci-credentials','/v1/audit-events'])assert.equal((await f.request(path,{extra:bearer})).status,403);
  assert.equal((await f.request('/v1/runs',{method:'POST',json:f.input(),extra:bearer})).status,403);
  const cli=await checkRelease({base:f.base+'/',accessKey:credential.token,...check});assert.equal(cli.deploymentAllowed,true);
  const project=randomUUID();await f.owner.query('INSERT INTO agenttrust.projects(id,organization_id,name) VALUES($1,$2,$3)',[project,f.first.organizationId,'Second project']);
  const foreignProject=await(await f.request('/v1/ci-credentials',{method:'POST',json:{...input,projectId:project}})).json();
  assert.equal((await f.request('/v1/release-gate',{method:'POST',json:check,extra:{Authorization:`Bearer ${foreignProject.token}`}})).status,404);
  const foreignOrg=(await f.store.createRun(f.contexts.other_admin,{agentVersionId:(await f.store.catalog(f.contexts.other_admin)).agent[0].id,datasetVersionId:(await f.store.catalog(f.contexts.other_admin)).dataset[0].id,policyVersionId:(await f.store.catalog(f.contexts.other_admin)).policy[0].id},randomUUID())).run;
  assert.equal((await f.request('/v1/release-gate',{method:'POST',json:{...check,candidateRunId:foreignOrg.id},extra:bearer})).status,404);
  const revoke=await f.request(`/v1/ci-credentials/${credential.id}/revoke`,{method:'POST',json:{}});assert.equal(revoke.status,200);
  assert.equal((await f.request('/v1/release-gate',{method:'POST',json:check,extra:bearer})).status,401);
  const again=await f.request(`/v1/ci-credentials/${credential.id}/revoke`,{method:'POST',json:{}});assert.equal(again.status,200);
  await f.owner.query("UPDATE agenttrust.ci_credentials SET created_at=now()-interval '120 seconds',expires_at=now()-interval '60 seconds' WHERE id=$1",[foreignProject.id]);
  assert.equal((await f.request('/v1/release-gate',{method:'POST',json:check,extra:{Authorization:`Bearer ${foreignProject.token}`}})).status,401);
  await assert.rejects(()=>f.owner.query('DELETE FROM agenttrust.release_receipts WHERE id=$1',[receipt.artifact.receiptId]),/immutable/);
  const events=await f.store.auditEvents(f.contexts.admin);assert.equal(events.filter(e=>e.action==='ci.credential.revoked').length,1);assert.ok(events.some(e=>e.action==='ci.release.checked'));assert.ok(!JSON.stringify(events).includes(credential.token));
  const isolated=await transaction(f.database,c=>c.query('SELECT id FROM agenttrust.release_receipts WHERE id=$1',[receipt.artifact.receiptId]),f.other.organizationId);assert.equal(isolated.rowCount,0);
});

test('release checks deduplicate concurrent delivery, reject conflicts and enforce organization rate and storage limits',async t=>{
  const f=await fixture(t,{ciOptions:{checkLimitPerMinute:2,receiptQuota:3}});const {run}=await f.create();await f.engine.tick();
  const request={candidateRunId:run.id,...f.input()};const key=randomUUID();
  const responses=await Promise.all(Array.from({length:8},()=>f.request('/v1/release-gate',{method:'POST',json:request,extra:{'Idempotency-Key':key}})));
  const receipts=await Promise.all(responses.map(async response=>{assert.equal(response.status,200);return response.json();}));assert.equal(new Set(receipts.map(r=>r.artifactHash)).size,1);
  const audit=await f.store.auditEvents(f.contexts.admin);assert.equal(audit.filter(e=>e.action==='ci.release.checked').length,1);
  const conflict=await f.request('/v1/release-gate',{method:'POST',json:{...request,agentVersionId:'different'},extra:{'Idempotency-Key':key}});assert.equal(conflict.status,409);
  const second=await f.request('/v1/release-gate',{method:'POST',json:request,extra:{'Idempotency-Key':randomUUID()}});assert.equal(second.status,200);
  const throttled=await f.request('/v1/release-gate',{method:'POST',json:request,extra:{'Idempotency-Key':randomUUID()}});assert.equal(throttled.status,429);
  const secondCI=new CI(f.database,{checkLimitPerMinute:120,receiptQuota:2});await assert.rejects(()=>secondCI.check(f.contexts.admin,request,randomUUID()),e=>e.status===429&&e.message.includes('quota'));
});

test('replayed release approval is denied when evaluation state changes',async t=>{
  const f=await fixture(t);const {run}=await f.create();const request={candidateRunId:run.id,...f.input()};const key=randomUUID();
  const queued=await f.request('/v1/release-gate',{method:'POST',json:request,extra:{'Idempotency-Key':key}});assert.equal((await queued.json()).deploymentAllowed,false);
  await f.engine.tick();const replay=await f.request('/v1/release-gate',{method:'POST',json:request,extra:{'Idempotency-Key':key}});assert.equal(replay.status,409);
  const current=await f.request('/v1/release-gate',{method:'POST',json:request,extra:{'Idempotency-Key':randomUUID()}});assert.equal((await current.json()).deploymentAllowed,true);
});
test('project selection scopes versions, runs, receipts and CI checks without rebinding project credentials',async t=>{
  const f=await fixture(t);const original=(await f.create()).run;await f.engine.tick();
  const projectId=randomUUID();await f.owner.query('INSERT INTO agenttrust.projects(id,organization_id,name) VALUES($1,$2,$3)',[projectId,f.first.organizationId,'Other release project']);
  const projectHeader={'X-AgentTrust-Project':projectId};
  const sample=await(await f.request('/v1/sample-dataset')).json();
  const version=async(path,json)=>{const response=await f.request(path,{method:'POST',json,extra:projectHeader});assert.equal(response.status,201);return response.json();};
  const agent=await version('/v1/agent-versions',{name:'Project normal',mode:'compliant'}),dataset=await version('/v1/dataset-versions',sample),policy=await version('/v1/policy-versions',{name:'Project policy',minimumPassRate:1});
  const input={agentVersionId:agent.id,datasetVersionId:dataset.id,policyVersionId:policy.id};
  const created=await f.request('/v1/runs',{method:'POST',json:input,extra:{...projectHeader,'Idempotency-Key':randomUUID()}});assert.equal(created.status,202);const run=await created.json();await f.engine.tick();
  assert.equal((await f.request(`/v1/runs/${run.id}`)).status,404);assert.equal((await f.request(`/v1/runs/${run.id}`,{extra:projectHeader})).status,200);
  assert.equal((await f.request(`/v1/runs/${original.id}`,{extra:projectHeader})).status,404);
  const scoped=await(await f.request('/v1/runs',{extra:projectHeader})).json();assert.deepEqual(scoped.map(r=>r.id),[run.id]);
  assert.equal((await f.request('/v1/catalog',{role:'other_admin',extra:projectHeader})).status,404);
  assert.equal((await f.request('/v1/catalog',{extra:{'X-AgentTrust-Project':'invalid'}})).status,400);
  const me=await(await f.request('/v1/me',{extra:projectHeader})).json();assert.equal(me.projectId,projectId);
  const receipt=await(await f.request('/v1/release-gate',{method:'POST',json:{candidateRunId:run.id,...input},extra:projectHeader})).json();assert.equal(receipt.deploymentAllowed,true);
  assert.equal((await f.request(`/v1/release-receipts/${receipt.artifact.receiptId}`)).status,404);
  const cli=await checkRelease({base:f.base+'/',accessKey:f.first.credentials.find(c=>c.role==='viewer').token,projectId,candidateRunId:run.id,...input});assert.equal(cli.deploymentAllowed,true);
  const key=await(await f.request('/v1/ci-credentials',{method:'POST',json:{name:'Scoped',projectId,ttlSeconds:60}})).json();
  const rebinding=await f.request('/v1/release-gate',{method:'POST',json:{candidateRunId:original.id,...f.input()},extra:{Authorization:`Bearer ${key.token}`,'X-AgentTrust-Project':f.contexts.admin.projectId}});assert.equal(rebinding.status,404);
});

test('idempotent release approval is not reused after its result validity window expires',async t=>{
  const f=await fixture(t);const {run}=await f.create();await f.engine.tick();const key=randomUUID();
  const input={candidateRunId:run.id,...f.input(),maxAgeSeconds:2};
  const first=await f.request('/v1/release-gate',{method:'POST',json:input,extra:{'Idempotency-Key':key}});assert.equal((await first.json()).deploymentAllowed,true);
  await new Promise(resolve=>setTimeout(resolve,2100));
  const stale=await f.request('/v1/release-gate',{method:'POST',json:input,extra:{'Idempotency-Key':key}});assert.equal(stale.status,409);
  const current=await f.request('/v1/release-gate',{method:'POST',json:input,extra:{'Idempotency-Key':randomUUID()}});assert.equal((await current.json()).deploymentAllowed,false);
});


test('admin project creation is atomic, tenant scoped and starts with an empty version catalog',async t=>{
  const f=await fixture(t),key=randomUUID(),payload={name:'Release workspace'};
  for(const role of ['editor','viewer'])assert.equal((await f.request('/v1/projects',{role,method:'POST',json:payload,extra:{'Idempotency-Key':randomUUID()}})).status,403);
  for(const json of [{name:''},{name:' '.repeat(5)},{name:'x'.repeat(101)},{name:'ok',organizationId:f.other.organizationId},[],null])assert.equal((await f.request('/v1/projects',{method:'POST',json,extra:{'Idempotency-Key':randomUUID()}})).status,400);
  const responses=await Promise.all(Array.from({length:6},()=>f.request('/v1/projects',{method:'POST',json:payload,extra:{'Idempotency-Key':key}})));
  assert.equal(responses.filter(r=>r.status===201).length,1);assert.equal(responses.filter(r=>r.status===200).length,5);
  const projects=await Promise.all(responses.map(r=>r.json()));assert.equal(new Set(projects.map(p=>p.id)).size,1);const project=projects[0];
  assert.equal((await f.request('/v1/projects',{method:'POST',json:{name:'conflict'},extra:{'Idempotency-Key':key}})).status,409);
  const own=await(await f.request('/v1/projects')).json(),foreign=await(await f.request('/v1/projects',{role:'other_admin'})).json();assert.ok(own.some(p=>p.id===project.id));assert.ok(!foreign.some(p=>p.id===project.id));
  const scope={'X-AgentTrust-Project':project.id};assert.deepEqual(await(await f.request('/v1/catalog',{extra:scope})).json(),{agent:[],dataset:[],policy:[]});
  const selected={...f.contexts.admin,projectId:project.id};
  const dataset=await f.store.createVersion(selected,'dataset',await(await f.request('/v1/sample-dataset')).json());
  const agent=await f.store.createVersion(selected,'agent',{name:'Project agent',mode:'compliant'}),policy=await f.store.createVersion(selected,'policy',{name:'Strict',minimumPassRate:1});
  const run=await(await f.request('/v1/runs',{method:'POST',extra:{...scope,'Idempotency-Key':randomUUID()},json:{agentVersionId:agent.id,datasetVersionId:dataset.id,policyVersionId:policy.id}})).json();await f.engine.tick();assert.equal((await f.store.getRun(selected,run.id)).gate.deploymentAllowed,true);
  assert.equal((await f.request('/v1/runs/'+run.id)).status,404);
  const events=await f.store.auditEvents(f.contexts.admin);assert.equal(events.filter(e=>e.action==='project.created'&&e.resource_id===project.id).length,1);
  const rows=await transaction(f.database,c=>c.query('SELECT id FROM agenttrust.projects WHERE id=$1',[project.id]),f.other.organizationId);assert.equal(rows.rowCount,0);
  await assert.rejects(transaction(f.database,c=>c.query('INSERT INTO agenttrust.projects(id,organization_id,name) VALUES($1,$2,$3)',[randomUUID(),f.first.organizationId,'spoof']),f.other.organizationId),/row-level security/);
});

test('concurrent project creation cannot exceed the organization quota',async t=>{
  const f=await fixture(t);
  for(let i=0;i<98;i++)await f.owner.query('INSERT INTO agenttrust.projects(id,organization_id,name) VALUES($1,$2,$3)',[randomUUID(),f.first.organizationId,'Quota fixture '+i]);
  const responses=await Promise.all([0,1].map(i=>f.request('/v1/projects',{method:'POST',json:{name:'New '+i},extra:{'Idempotency-Key':randomUUID()}})));
  assert.deepEqual(responses.map(r=>r.status).sort(),[201,429]);
  assert.equal(Number((await f.owner.query('SELECT count(*) FROM agenttrust.projects WHERE organization_id=$1',[f.first.organizationId])).rows[0].count),100);
});


test('signed release receipts survive read and replay and require a trusted public key in CI',async t=>{
  const pair=generateKeyPairSync('ed25519'),publicKey=pair.publicKey.export({type:'spki',format:'pem'}),signer=new ReceiptSigner(pair.privateKey.export({type:'pkcs8',format:'pem'}));
  const f=await fixture(t,{ciOptions:{signer}}),{run}=await f.create();await f.engine.tick();
  const expected={base:f.base,accessKey:f.first.credentials.find(c=>c.role==='viewer').token,candidateRunId:run.id,...f.input(),trustedPublicKey:publicKey,checkKey:randomUUID()};
  const checked=await checkRelease(expected),replayed=await checkRelease(expected);assert.deepEqual(replayed.signature,checked.signature);
  assert.equal(verifyReceipt(checked,publicKey).signatureVerified,true);
  const stored=await(await f.request('/v1/release-receipts/'+checked.artifact.receiptId)).json();assert.deepEqual(stored.signature,checked.signature);assert.equal(verifyReceipt(stored,publicKey).signatureVerified,true);
  assert.equal((await(await f.request('/v1/receipt-signing-key')).json()).keyId,signer.keyId);
  await assert.rejects(checkRelease({...expected,checkKey:randomUUID(),trustedPublicKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'})}),/trusted key/);
  await assert.rejects(f.owner.query('UPDATE agenttrust.release_receipts SET signature=NULL WHERE id=$1',[checked.artifact.receiptId]),/immutable/);
  const legacy=await new CI(f.database,{signer:null}).check(f.contexts.admin,{candidateRunId:run.id,...f.input()},randomUUID());assert.equal(legacy.signature,undefined);assert.throws(()=>verifyReceipt(legacy,publicKey),/signed release receipt/);
});


test('key and receipt pages are stable, project bound and preserve sub-millisecond ordering',async t=>{
  const f=await fixture(t),{run}=await f.create();await f.engine.tick();const otherProject=randomUUID();
  await f.owner.query('INSERT INTO agenttrust.projects(id,organization_id,name) VALUES($1,$2,$3)',[otherProject,f.first.organizationId,'Other pagination project']);
  for(let i=0;i<7;i++){
    assert.equal((await f.request('/v1/ci-credentials',{method:'POST',json:{name:'Page '+i,projectId:f.first.projectId,ttlSeconds:60}})).status,201);
    assert.equal((await f.request('/v1/release-gate',{method:'POST',json:{candidateRunId:run.id,...f.input()},extra:{'Idempotency-Key':randomUUID()}})).status,200);
  }
  const foreignKey=await(await f.request('/v1/ci-credentials',{method:'POST',json:{name:'Foreign page',projectId:otherProject,ttlSeconds:60}})).json();
  await f.owner.query(`WITH ranked AS(SELECT id,row_number() OVER(ORDER BY id) AS n FROM agenttrust.ci_credentials WHERE organization_id=$1 AND project_id=$2),base AS(SELECT date_trunc('milliseconds',clock_timestamp()) AS time) UPDATE agenttrust.ci_credentials c SET created_at=base.time+ranked.n*interval '1 microsecond' FROM ranked,base WHERE c.id=ranked.id`,[f.first.organizationId,f.first.projectId]);
  for(const path of ['/v1/ci-credentials','/v1/release-receipts']){
    const ids=[],cursors=[];let cursor;
    do{const page=await(await f.request(path+'?limit=2'+(cursor?'&cursor='+encodeURIComponent(cursor):''))).json();assert.ok(page.items.length<=2);ids.push(...page.items.map(i=>i.id));cursor=page.nextCursor;if(cursor)cursors.push(cursor);}while(cursor);
    assert.equal(ids.length,7);assert.equal(new Set(ids).size,7);assert.ok(!ids.includes(foreignKey.id));
    assert.equal((await f.request(path+'?limit=2&cursor='+cursors[0],{role:'other_admin'})).status,400);
    assert.equal((await f.request(path+'?limit=2&cursor='+cursors[0],{extra:{'X-AgentTrust-Project':otherProject}})).status,400);
    for(const query of ['limit=0','limit=101','limit=2&limit=3','limit=2&cursor=bad','limit=2&unknown=1','cursor='])assert.equal((await f.request(path+'?'+query)).status,400);
    const legacy=await(await f.request(path)).json();assert.ok(Array.isArray(legacy));assert.equal(legacy.length,7);
  }
  const other=await(await f.request('/v1/ci-credentials?limit=2',{extra:{'X-AgentTrust-Project':otherProject}})).json();assert.equal(other.items.length,1);assert.equal(other.items[0].id,foreignKey.id);
});

test('credential creation rate is shared across projects and cannot be evaded by revocation',async t=>{
  const f=await fixture(t);
  for(let i=0;i<20;i++){
    const credential=await(await f.request('/v1/ci-credentials',{method:'POST',json:{name:'Rate fixture '+i,projectId:f.first.projectId,ttlSeconds:60}})).json();
    await f.request('/v1/ci-credentials/'+credential.id+'/revoke',{method:'POST',json:{}});
  }
  assert.equal((await f.request('/v1/ci-credentials',{method:'POST',json:{name:'Rate limit',projectId:f.first.projectId,ttlSeconds:60}})).status,429);
  assert.equal(Number((await f.owner.query('SELECT count(*) FROM agenttrust.ci_credentials WHERE organization_id=$1',[f.first.organizationId])).rows[0].count),20);
});


test('operations expose only the selected project queue to admins and report stale worker signals',async t=>{
  const f=await fixture(t),prior=(await f.owner.query("SELECT last_seen FROM agenttrust.service_health WHERE service='worker'")).rows[0];
  t.after(async()=>{const db=pool(process.env.TEST_OWNER_DATABASE_URL);try{if(prior)await db.query("UPDATE agenttrust.service_health SET last_seen=$1 WHERE service='worker'",[prior.last_seen]);else await db.query("DELETE FROM agenttrust.service_health WHERE service='worker'");}finally{await db.end();}});
  const {run}=await f.create('compliant',{timeoutMs:100});await new Promise(resolve=>setTimeout(resolve,120));await f.store.createRun(f.contexts.other_admin,{...f.input(),agentVersionId:(await f.store.catalog(f.contexts.other_admin)).agent.find(v=>v.mode==='compliant').id,datasetVersionId:(await f.store.catalog(f.contexts.other_admin)).dataset[0].id,policyVersionId:(await f.store.catalog(f.contexts.other_admin)).policy[0].id},randomUUID());
  for(const role of ['editor','viewer'])assert.equal((await f.request('/v1/operations',{role})).status,403);
  await f.owner.query("INSERT INTO agenttrust.service_health(service,last_seen) VALUES('worker',clock_timestamp()-interval '1 minute') ON CONFLICT(service) DO UPDATE SET last_seen=excluded.last_seen");
  const stale=await(await f.request('/v1/operations')).json();assert.equal(stale.worker.state,'stale');assert.equal(stale.queue.queued,1);assert.equal(stale.queue.overdue,1);assert.equal(stale.projectId,f.first.projectId);
  await assert.rejects(f.database.query("UPDATE agenttrust.service_health SET last_seen=clock_timestamp() WHERE service='worker'"),/permission denied/);
  await heartbeat(f.workerDb);const recent=await(await f.request('/v1/operations')).json();assert.equal(recent.worker.state,'recent');assert.ok(recent.worker.ageSeconds>=0);
  await f.store.cancel(f.contexts.admin,run.id);const completed=await(await f.request('/v1/operations')).json();assert.equal(completed.queue.queued,0);assert.equal(completed.recent.completed24h,1);
  const other=await(await f.request('/v1/operations',{role:'other_admin'})).json();assert.equal(other.queue.queued,1);assert.equal(other.recent.completed24h,0);
});


test('operational alerts require an admin and keep overdue execution alerts in the selected project',async t=>{
 const f=await fixture(t),prior=(await f.owner.query("SELECT last_seen FROM agenttrust.service_health WHERE service='worker'")).rows[0];
 t.after(async()=>{const db=pool(process.env.TEST_OWNER_DATABASE_URL);try{if(prior)await db.query("UPDATE agenttrust.service_health SET last_seen=$1 WHERE service='worker'",[prior.last_seen]);else await db.query("DELETE FROM agenttrust.service_health WHERE service='worker'");}finally{await db.end();}});
 await heartbeat(f.workerDb);
 for(const role of ['editor','viewer'])assert.equal((await f.request('/v1/operations-alerts',{role})).status,403);
 assert.equal((await f.request('/v1/operations-alerts?unknown=1')).status,400);
 const initial=await(await f.request('/v1/operations-alerts')).json();assert.equal(initial.status,'ok');assert.equal(initial.organizationId,f.first.organizationId);assert.equal(initial.projectId,f.first.projectId);assert.equal(initial.readOnly,true);assert.deepEqual(initial.alerts,[]);
 await f.create('compliant',{timeoutMs:100});await new Promise(resolve=>setTimeout(resolve,120));await heartbeat(f.workerDb);
 const overdue=await(await f.request('/v1/operations-alerts')).json();assert.equal(overdue.status,'critical');assert.deepEqual(overdue.alerts,[{code:'execution-deadline-exceeded',severity:'critical',scope:'project'}]);assert.equal(overdue.releasePermissionVerified,false);
 const other=await(await f.request('/v1/operations-alerts',{role:'other_admin'})).json();assert.equal(other.status,'ok');assert.equal(other.organizationId,f.other.organizationId);assert.deepEqual(other.alerts,[]);
 assert.equal((await f.request('/v1/operations-alerts',{extra:{'X-AgentTrust-Project':f.other.projectId}})).status,404);
});

test('operational alert HTTP responses fail closed on contradictory or foreign operational evidence',async t=>{
 const f=await fixture(t),original=f.store.operations.bind(f.store);
 for(const mutate of [o=>o.versionCapacity.organizationId=randomUUID(),o=>o.executionCapacity.retained.remaining=-1,o=>{o.worker={state:'recent',ageSeconds:16};}]){
  f.store.operations=async context=>{const evidence=await original(context);mutate(evidence);evidence.private='private-model-body';return evidence;};
  const response=await f.request('/v1/operations-alerts');assert.equal(response.status,503);const body=await response.json();assert.equal(body.error,'Service unavailable.');assert.equal(body.status,undefined);assert.doesNotMatch(JSON.stringify(body),/private-model-body/);
 }
 f.store.operations=async()=>{throw Error('private-model-body');};assert.equal((await f.request('/v1/operations-alerts',{role:'viewer'})).status,403);
});

test('run history pages preserve evidence summaries, filters and cursor scope',async t=>{
  const f=await fixture(t),ids=[];
  for(const mode of ['compliant','regression','error','compliant','regression']){const {run}=await f.create(mode);await f.engine.tick();ids.push(run.id);}
  const {run:queued}=await f.create();
  const seen=[];let cursor;
  do{const page=await(await f.request('/v1/runs?limit=2'+(cursor?'&cursor='+cursor:''))).json();assert.ok(page.items.every(r=>r.snapshot===undefined&&r.results===undefined));seen.push(...page.items.map(r=>r.id));cursor=page.nextCursor;}while(cursor);
  assert.equal(seen.length,6);assert.equal(new Set(seen).size,6);assert.ok(seen.includes(queued.id));
  const first=await(await f.request('/v1/runs?limit=1&decision=pass')).json();assert.equal(first.items[0].gate.decision,'pass');assert.ok(first.nextCursor);
  assert.equal((await f.request('/v1/runs?limit=1&decision=block&cursor='+first.nextCursor)).status,400);
  assert.equal((await f.request('/v1/runs?limit=1&decision=pass&cursor='+first.nextCursor,{role:'other_admin'})).status,400);
  const second=await(await f.request('/v1/runs?limit=1&decision=pass&cursor='+first.nextCursor)).json();assert.equal(second.items.length,1);assert.notEqual(second.items[0].id,first.items[0].id);assert.equal(second.nextCursor,null);
  const failed=await(await f.request('/v1/runs?limit=25&state=failed')).json();assert.equal(failed.items.length,1);assert.equal(failed.items[0].gate.decision,'inconclusive');
  const waiting=await(await f.request('/v1/runs?limit=25&state=queued&decision=inconclusive')).json();assert.equal(waiting.items.length,1);assert.equal(waiting.items[0].id,queued.id);assert.equal(waiting.items[0].gate.deploymentAllowed,false);
  for(const query of ['state=unknown','decision=allowed','state=queued&state=running','decision=pass&decision=block','limit=25&unknown=1'])assert.equal((await f.request('/v1/runs?'+query)).status,400);
  const legacy=await(await f.request('/v1/runs')).json();assert.ok(Array.isArray(legacy));assert.equal(legacy.length,6);
});


test('manual reviews are immutable, scoped and cannot override failed evaluation or later rejection',async t=>{
  const f=await fixture(t),policy=await f.store.createVersion(f.contexts.admin,'policy',{name:'Manual review required',minimumPassRate:1,requiresManualApproval:true,manualApprovalTtlSeconds:60});
  const {run}=await f.create('compliant',{policyVersionId:policy.id}),path='/v1/runs/'+run.id+'/reviews',reviewKey=randomUUID();
  for(const role of ['editor','viewer'])assert.equal((await f.request(path,{role,method:'POST',json:{decision:'approved'},extra:{'Idempotency-Key':randomUUID()}})).status,403);
  assert.equal((await f.request(path,{method:'POST',json:{decision:'approved'},extra:{'Idempotency-Key':randomUUID()}})).status,409);
  const forged={state:'succeeded',results:[],gate:{decision:'pass',deploymentAllowed:true,evaluationPassed:true,requiresManualApproval:true}};
  await assert.rejects(f.owner.query("UPDATE agenttrust.runs SET state='succeeded',outcome=$2,result_hash=$3,completed_at=now() WHERE id=$1",[run.id,forged,'a'.repeat(64)]),/Invalid deployment permission/);
  await assert.rejects(f.owner.query("UPDATE agenttrust.runs SET state='succeeded',outcome=$2,result_hash=$3,completed_at=now() WHERE id=$1",[run.id,{state:'succeeded',results:[],gate:{decision:'pass',deploymentAllowed:false}},'a'.repeat(64)]),/Manual approval gate evidence required/);
  await f.engine.tick();const final=await f.store.getRun(f.contexts.admin,run.id);assert.equal(final.gate.decision,'pass');assert.equal(final.gate.deploymentAllowed,false);
  const check={candidateRunId:run.id,...f.input('compliant',{policyVersionId:policy.id})},gateKey=randomUUID();
  const missing=await(await f.request('/v1/release-gate',{method:'POST',json:check})).json();assert.equal(missing.deploymentAllowed,false);assert.equal(missing.manualApproval.status,'missing');
  const approvals=await Promise.all(Array.from({length:6},()=>f.request(path,{method:'POST',json:{decision:'approved',comment:'Reviewed synthetic evidence'},extra:{'Idempotency-Key':reviewKey}})));
  assert.equal(approvals.filter(r=>r.status===201).length,1);assert.equal(approvals.filter(r=>r.status===200).length,5);const records=await Promise.all(approvals.map(r=>r.json()));assert.equal(new Set(records.map(r=>r.id)).size,1);
  const approved=await(await f.request('/v1/release-gate',{role:'viewer',method:'POST',json:check,extra:{'Idempotency-Key':gateKey}})).json();assert.equal(approved.deploymentAllowed,true);assert.equal(approved.manualApproval.reviewId,records[0].id);
  assert.equal((await f.request(path,{role:'other_admin'})).status,404);assert.equal((await f.request(path,{role:'other_admin',method:'POST',json:{decision:'approved'},extra:{'Idempotency-Key':randomUUID()}})).status,404);
  assert.equal((await f.request(path,{method:'POST',json:{decision:'rejected'},extra:{'Idempotency-Key':reviewKey}})).status,409);
  assert.equal((await f.request(path,{method:'POST',json:{decision:'approved',comment:'x'.repeat(501)},extra:{'Idempotency-Key':randomUUID()}})).status,400);
  assert.equal((await f.request(path,{method:'POST',json:{decision:'rejected',comment:'New concern'},extra:{'Idempotency-Key':randomUUID()}})).status,201);
  assert.equal((await f.request('/v1/release-gate',{role:'viewer',method:'POST',json:check,extra:{'Idempotency-Key':gateKey}})).status,409);
  const rejected=await(await f.request('/v1/release-gate',{role:'viewer',method:'POST',json:check})).json();assert.equal(rejected.deploymentAllowed,false);assert.equal(rejected.manualApproval.status,'rejected');
  await assert.rejects(f.owner.query('UPDATE agenttrust.run_reviews SET decision=$2 WHERE id=$1',[records[0].id,'rejected']),/immutable/);await assert.rejects(f.owner.query('DELETE FROM agenttrust.run_reviews WHERE id=$1',[records[0].id]),/immutable/);
  const isolated=await transaction(f.database,c=>c.query('SELECT id FROM agenttrust.run_reviews WHERE run_id=$1',[run.id]),f.other.organizationId);assert.equal(isolated.rowCount,0);
  const unchanged=await f.store.getRun(f.contexts.admin,run.id);assert.equal(unchanged.snapshotHash,final.snapshotHash);assert.equal(unchanged.resultHash,final.resultHash);
  const {run:failed}=await f.create('regression',{policyVersionId:policy.id});await f.engine.tick();assert.equal((await f.request('/v1/runs/'+failed.id+'/reviews',{method:'POST',json:{decision:'approved'},extra:{'Idempotency-Key':randomUUID()}})).status,409);
  const credential=await(await f.request('/v1/ci-credentials',{method:'POST',json:{name:'No review permission',projectId:f.first.projectId,ttlSeconds:60}})).json();assert.equal((await f.request(path,{method:'POST',json:{decision:'approved'},extra:{Authorization:'Bearer '+credential.token,'Idempotency-Key':randomUUID()}})).status,403);
  await f.request(path,{method:'POST',json:{decision:'approved'},extra:{'Idempotency-Key':randomUUID()}});await f.owner.query('UPDATE agenttrust.memberships SET active=false WHERE id=$1',[f.contexts.admin.membershipId]);
  const inactive=await(await f.request('/v1/release-gate',{role:'viewer',method:'POST',json:check})).json();assert.equal(inactive.manualApproval.status,'invalid');assert.equal(inactive.deploymentAllowed,false);
});

test('CI credential expiration is rechecked after a waiting release lock',async t=>{
  const f=await fixture(t),{run}=await f.create();await f.engine.tick();
  const credential=await(await f.request('/v1/ci-credentials',{method:'POST',json:{name:'Waiting expiry',projectId:f.first.projectId,ttlSeconds:60}})).json();
  const client=await f.owner.connect();
  try{
    await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,3))',[f.first.organizationId]);
    await f.owner.query("UPDATE agenttrust.ci_credentials SET expires_at=clock_timestamp()+interval '250 milliseconds' WHERE id=$1",[credential.id]);
    const pending=f.request('/v1/release-gate',{method:'POST',json:{candidateRunId:run.id,...f.input()},extra:{Authorization:'Bearer '+credential.token}});
    let waiting=false;
    for(let i=0;i<10;i++){
      const locks=await f.owner.query("SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE l.locktype='advisory' AND NOT l.granted AND a.usename='agenttrust_api' AND a.datname=current_database() AND a.query LIKE '%hashtextextended($1,3)%'");
      if(locks.rowCount){waiting=true;break;}await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.equal(waiting,true);await new Promise(resolve=>setTimeout(resolve,350));await client.query('COMMIT');assert.equal((await pending).status,401);
  }finally{await client.query('ROLLBACK').catch(()=>{});client.release();}
});


test('later rejection wins over earlier approval even with an older wall-clock timestamp',async t=>{
  const f=await fixture(t),policy=await f.store.createVersion(f.contexts.admin,'policy',{name:'Clock-safe review',minimumPassRate:1,requiresManualApproval:true});
  const {run}=await f.create('compliant',{policyVersionId:policy.id});await f.engine.tick();
  const path='/v1/runs/'+run.id+'/reviews',approved=await(await f.request(path,{method:'POST',json:{decision:'approved'},extra:{'Idempotency-Key':randomUUID()}})).json();
  const {reviewHash,replay,...original}=approved,payload={...original,id:randomUUID(),decision:'rejected',comment:'Synthetic backwards-clock fixture',createdAt:new Date(Date.now()-3600000).toISOString()};
  await f.owner.query('INSERT INTO agenttrust.run_reviews(id,organization_id,project_id,run_id,actor_id,decision,payload,review_hash,idempotency_key,request_hash,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[payload.id,payload.organizationId,payload.projectId,payload.runId,payload.actorId,payload.decision,payload,hash(payload),randomUUID(),hash({synthetic:true}),payload.createdAt]);
  const gate=await(await f.request('/v1/release-gate',{method:'POST',json:{candidateRunId:run.id,...f.input('compliant',{policyVersionId:policy.id})}})).json();assert.equal(gate.deploymentAllowed,false);assert.equal(gate.manualApproval.status,'rejected');assert.equal(gate.manualApproval.reviewId,payload.id);
  const reviews=await(await f.request(path)).json();assert.equal(reviews[0].id,payload.id);
});


test('authentication tables require tenant context and API cannot forge worker completion',async t=>{
  const f=await fixture(t);
  for(const table of ['organizations','memberships','credentials','sessions']){
    assert.equal(Number((await f.database.query('SELECT count(*) FROM agenttrust.'+table)).rows[0].count),0);
    const rows=await transaction(f.database,c=>c.query('SELECT * FROM agenttrust.'+table),f.first.organizationId);
    assert.ok(rows.rowCount>0);
    if(table==='organizations')assert.ok(rows.rows.every(r=>r.id===f.first.organizationId));
    if(table==='memberships')assert.ok(rows.rows.every(r=>r.organization_id===f.first.organizationId));
    if(table==='credentials')assert.ok(rows.rows.every(r=>f.first.credentials.some(c=>c.id===r.id)));
    if(table==='sessions')assert.ok(rows.rows.every(r=>f.first.credentials.some(c=>c.id===r.credential_id)));
  }
  await assert.rejects(transaction(f.database,c=>c.query("INSERT INTO agenttrust.sessions(token_hash,credential_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[hash(randomUUID()),f.other.credentials[0].id]),f.first.organizationId),/row-level security/);
  const {run}=await f.create(),outcome=evaluate(run.snapshot);
  await assert.rejects(transaction(f.database,c=>c.query("UPDATE agenttrust.runs SET state='succeeded',outcome=$2,result_hash=$3,completed_at=now() WHERE id=$1",[run.id,outcome,hash({results:outcome.results,gate:outcome.gate})]),f.first.organizationId),/worker completion is required/);
  await f.engine.tick();assert.equal((await f.store.getRun(f.contexts.admin,run.id)).gate.deploymentAllowed,true);
  const {run:cancel}=await f.create();assert.equal((await f.store.cancel(f.contexts.admin,cancel.id)).state,'cancelled');
  const functions=(await f.owner.query("SELECT proname,prosecdef,proconfig,pg_get_userbyid(proowner) AS owner FROM pg_proc WHERE oid IN ('agenttrust.lookup_credential(text)'::regprocedure,'agenttrust.authenticate_session(text)'::regprocedure)")).rows;
  assert.equal(functions.length,2);assert.ok(functions.every(fn=>fn.owner==='agenttrust_auth'&&fn.prosecdef&&fn.proconfig.includes('search_path=pg_catalog, pg_temp')));
});

test('organization audit history pages and action filters preserve scope and timestamp precision',async t=>{
  const f=await fixture(t),ids=[];
  for(let index=0;index<4;index++){
    const id=randomUUID();ids.push(id);await f.owner.query(`INSERT INTO agenttrust.audit_events(id,organization_id,action,created_at)
      VALUES($1,$2,'test.audit','2025-01-01T00:00:00.000001Z'::timestamptz+$3::int*interval '1 microsecond')`,[id,f.first.organizationId,index]);
  }
  const first=await(await f.request('/v1/audit-events?limit=2&action=test.audit')).json();
  assert.deepEqual(first.items.map(row=>row.id),ids.slice(2).reverse());assert.ok(first.nextCursor);
  const second=await(await f.request('/v1/audit-events?limit=2&action=test.audit&cursor='+first.nextCursor)).json();
  assert.deepEqual(second.items.map(row=>row.id),ids.slice(0,2).reverse());assert.equal(second.nextCursor,null);
  for(const path of ['/v1/audit-events?limit=2&cursor='+first.nextCursor,'/v1/audit-events?action=auth.login&cursor='+first.nextCursor,'/v1/audit-events?action=x&action=y','/v1/audit-events?unexpected=x','/v1/audit-events?action=bad%20action'])assert.equal((await f.request(path)).status,400);
  assert.equal((await f.request('/v1/audit-events?limit=2&action=test.audit&cursor='+first.nextCursor,{role:'other_admin'})).status,400);
  assert.equal((await f.request('/v1/audit-events?limit=2',{role:'viewer'})).status,403);
  assert.equal((await f.request('/v1/audit-events?limit=2',{role:'editor'})).status,403);
  assert.deepEqual((await(await f.request('/v1/audit-events?limit=2&action=test.audit',{role:'other_admin'})).json()).items,[]);
  assert.ok(Array.isArray(await(await f.request('/v1/audit-events')).json()));
});

test('HTTP API refuses a migration-owner database connection before reading protected data',async t=>{
  const f=await fixture(t),unsafe=createApp({database:f.owner});
  await new Promise(resolve=>unsafe.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{unsafe.closeAllConnections();await new Promise(resolve=>unsafe.close(resolve));});
  const base=`http://127.0.0.1:${unsafe.address().port}`;
  for(const path of ['/health','/v1/catalog']){
    const response=await fetch(base+path);assert.equal(response.status,503);const data=await response.json();assert.equal(data.error,'Service unavailable.');assert.ok(!JSON.stringify(data).includes('agenttrust_owner'));
  }
  const login=await fetch(base+'/v1/auth/login',{method:'POST',headers,body:JSON.stringify({accessKey:f.first.credentials[0].token})});assert.equal(login.status,503);
  assert.equal((await fetch(base+'/')).status,200);
});

test('version source reads are scoped immutable evidence and catalog contains only bounded metadata',async t=>{
  const f=await fixture(t),source=await(await f.request('/v1/sample-dataset')).json();
  source.name='Large synthetic version inspection';source.cases[0].input='x'.repeat(9000);
  const created=await(await f.request('/v1/dataset-versions',{method:'POST',json:source})).json();
  const detail=await(await f.request('/v1/versions/'+created.id,{role:'viewer'})).json();
  assert.deepEqual(detail.data,source);assert.equal(detail.kind,'dataset');assert.equal(detail.contentHash,hash(source));assert.ok(detail.createdAt);
  const catalog=await(await f.request('/v1/catalog')).json();
  const metadata=catalog.dataset.find(version=>version.id===created.id);assert.equal(metadata.cases,source.cases.length);assert.equal(metadata.contentHash,detail.contentHash);assert.ok(metadata.createdAt);
  assert.ok(!JSON.stringify(catalog).includes('x'.repeat(100)));assert.equal(catalog.policy[0].minimumPassRate,1);assert.equal(catalog.policy[0].requiresManualApproval,false);
  const manual=await(await f.request('/v1/policy-versions',{method:'POST',json:{name:'Inspection manual policy',minimumPassRate:0.8,requiresManualApproval:true,manualApprovalTtlSeconds:120}})).json();
  const policies=(await(await f.request('/v1/catalog')).json()).policy;assert.equal(policies.find(policy=>policy.id===manual.id).manualApprovalTtlSeconds,120);
  assert.equal((await f.request('/v1/versions/'+created.id,{role:'other_admin'})).status,404);
  const project=await f.store.createProject(f.contexts.admin,{name:'Other selected project'},randomUUID());
  assert.equal((await f.request('/v1/versions/'+created.id,{extra:{'X-AgentTrust-Project':project.id}})).status,404);
  assert.equal((await f.request('/v1/versions/not-a-uuid')).status,400);
  const clone=await(await f.request('/v1/dataset-versions',{method:'POST',json:source})).json();assert.notEqual(clone.id,created.id);assert.equal(clone.contentHash,created.contentHash);
  assert.deepEqual((await(await f.request('/v1/versions/'+created.id)).json()).data,source);
});

async function blockedOn(f,fragment,user='agenttrust_api'){
  for(let index=0;index<50;index++){
    const locks=await f.owner.query(`SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid
      WHERE NOT l.granted AND a.usename=$2 AND a.datname=current_database() AND a.query LIKE $1`,['%'+fragment+'%',user]);
    if(locks.rowCount)return;await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.fail('Expected request to be blocked before changing its authorization.');
}

test('session expiration during a release lock wait cannot create an approval receipt',async t=>{
  const f=await fixture(t),{run}=await f.create();await f.engine.tick();
  const client=await f.owner.connect(),sessionHash=tokenHash(f.cookies.viewer.split('=')[1]);
  try{
    await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,3))',[f.first.organizationId]);
    await f.owner.query("UPDATE agenttrust.sessions SET expires_at=clock_timestamp()+interval '400 milliseconds' WHERE token_hash=$1",[sessionHash]);
    const pending=f.request('/v1/release-gate',{role:'viewer',method:'POST',json:{candidateRunId:run.id,...f.input()}});
    await blockedOn(f,'hashtextextended($1,3)');await new Promise(resolve=>setTimeout(resolve,450));await client.query('COMMIT');
    assert.equal((await pending).status,401);
    assert.equal(Number((await f.owner.query('SELECT count(*) FROM agenttrust.release_receipts WHERE organization_id=$1',[f.first.organizationId])).rows[0].count),0);
    const me=await(await f.request('/v1/me')).json();assert.ok(!JSON.stringify(me).includes(tokenHash(f.cookies.admin.split('=')[1])));
  }finally{await client.query('ROLLBACK').catch(()=>{});client.release();}
});

test('administrator role loss during project and CI key lock waits rejects new access',async t=>{
  const f=await fixture(t),client=await f.owner.connect();
  try{
    for(const scenario of [
      {seed:0,path:'/v1/projects',data:{name:'Must not be created'},extra:{'Idempotency-Key':randomUUID()}},
      {seed:2,path:'/v1/ci-credentials',data:{name:'Must not be issued',projectId:f.first.projectId,ttlSeconds:60}}
    ]){
      await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,$2))',[f.first.organizationId,scenario.seed]);
      const pending=f.request(scenario.path,{method:'POST',json:scenario.data,extra:scenario.extra});
      await blockedOn(f,'hashtextextended($1,'+scenario.seed+')');
      await f.owner.query("UPDATE agenttrust.memberships SET role='viewer' WHERE id=$1",[f.contexts.admin.membershipId]);
      await client.query('COMMIT');assert.equal((await pending).status,403);
      await f.owner.query("UPDATE agenttrust.memberships SET role='admin' WHERE id=$1",[f.contexts.admin.membershipId]);
    }
    assert.equal(Number((await f.owner.query('SELECT count(*) FROM agenttrust.projects WHERE organization_id=$1',[f.first.organizationId])).rows[0].count),1);
    assert.equal(Number((await f.owner.query('SELECT count(*) FROM agenttrust.ci_credentials WHERE organization_id=$1',[f.first.organizationId])).rows[0].count),0);
  }finally{await client.query('ROLLBACK').catch(()=>{});await f.owner.query("UPDATE agenttrust.memberships SET role='admin' WHERE id=$1",[f.contexts.admin.membershipId]);client.release();}
});

test('credential revocation while cancellation waits cannot mutate a run',async t=>{
  const f=await fixture(t),{run}=await f.create(),client=await f.owner.connect(),credentialId=f.first.credentials.find(actor=>actor.role==='admin').id;
  try{
    await client.query('BEGIN');await client.query('SELECT id FROM agenttrust.runs WHERE id=$1 FOR UPDATE',[run.id]);
    const pending=f.request('/v1/runs/'+run.id+'/cancel',{method:'POST',json:{}});
    await blockedOn(f,'project_id=$3 FOR UPDATE');
    await f.owner.query('UPDATE agenttrust.credentials SET revoked_at=clock_timestamp() WHERE id=$1',[credentialId]);
    await client.query('COMMIT');assert.equal((await pending).status,401);
    assert.equal((await f.owner.query('SELECT state FROM agenttrust.runs WHERE id=$1',[run.id])).rows[0].state,'queued');
  }finally{await client.query('ROLLBACK').catch(()=>{});await f.owner.query('UPDATE agenttrust.credentials SET revoked_at=NULL WHERE id=$1',[credentialId]);client.release();}
});

test('administrator review waiting for serialization does not survive role revocation',async t=>{
  const f=await fixture(t),policy=await f.store.createVersion(f.contexts.admin,'policy',{name:'Waiting reviewer',minimumPassRate:1,requiresManualApproval:true});
  const {run}=await f.create('compliant',{policyVersionId:policy.id});await f.engine.tick();const client=await f.owner.connect();
  try{
    await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,5))',[f.first.organizationId]);
    const pending=f.request('/v1/runs/'+run.id+'/reviews',{method:'POST',json:{decision:'approved'},extra:{'Idempotency-Key':randomUUID()}});
    await blockedOn(f,'hashtextextended($1,5)');await f.owner.query("UPDATE agenttrust.memberships SET role='editor' WHERE id=$1",[f.contexts.admin.membershipId]);
    await client.query('COMMIT');assert.equal((await pending).status,403);
    assert.equal(Number((await f.owner.query('SELECT count(*) FROM agenttrust.run_reviews WHERE run_id=$1',[run.id])).rows[0].count),0);
  }finally{await client.query('ROLLBACK').catch(()=>{});await f.owner.query("UPDATE agenttrust.memberships SET role='admin' WHERE id=$1",[f.contexts.admin.membershipId]);client.release();}
});

test('corrupt stored versions are never exposed as trusted source or queued for evaluation',async t=>{
  const f=await fixture(t);
  for(const source of [{data:{name:'Corrupt hash fixture',mode:'compliant'},contentHash:'a'.repeat(64)},{data:{name:'Malformed contract fixture',mode:'unknown'},contentHash:null}]){
    const id=randomUUID(),contentHash=source.contentHash||hash(source.data);
    await f.owner.query("INSERT INTO agenttrust.versions(id,organization_id,project_id,kind,data,content_hash) VALUES($1,$2,$3,'agent',$4,$5)",[id,f.first.organizationId,f.first.projectId,source.data,contentHash]);
    const read=await f.request('/v1/versions/'+id);assert.equal(read.status,503);assert.equal((await read.json()).error,'Service unavailable.');
    const submission=await f.request('/v1/runs',{method:'POST',json:f.input('compliant',{agentVersionId:id}),extra:{'Idempotency-Key':randomUUID()}});assert.equal(submission.status,503);
  }
  assert.equal(Number((await f.owner.query('SELECT count(*) FROM agenttrust.runs WHERE organization_id=$1',[f.first.organizationId])).rows[0].count),0);
});

test('API INSERT privilege cannot bypass the queued initial-state boundary',async t=>{
  const f=await fixture(t),{run}=await f.create(),outcome=evaluate(run.snapshot);
  for(const attempt of [
    {state:'succeeded',attempts:0,outcome,resultHash:hash({results:outcome.results,gate:outcome.gate}),completedAt:new Date()},
    {state:'cancelled',attempts:0},
    {state:'queued',attempts:1},
    {state:'queued',attempts:0,leaseToken:randomUUID()},
    {state:'queued',attempts:0,startedAt:new Date()},
    {state:'queued',attempts:0,outcome:{gate:{decision:'pass',deploymentAllowed:true}}}
  ]){
    await assert.rejects(transaction(f.database,client=>client.query(`INSERT INTO agenttrust.runs
      (id,organization_id,project_id,agent_version_id,dataset_version_id,policy_version_id,idempotency_key,fingerprint,snapshot,snapshot_hash,timeout_ms,case_budget,max_attempts,deadline,state,attempts,outcome,result_hash,completed_at,lease_token,started_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,30000,100,3,clock_timestamp()+interval '30 seconds',$11,$12,$13,$14,$15,$16,$17)`,
      [randomUUID(),f.first.organizationId,f.first.projectId,run.agentVersionId,run.datasetVersionId,run.policyVersionId,randomUUID(),hash({synthetic:true}),run.snapshot,run.snapshotHash,attempt.state,attempt.attempts,attempt.outcome||null,attempt.resultHash||null,attempt.completedAt||null,attempt.leaseToken||null,attempt.startedAt||null]),f.first.organizationId),/New runs must (?:begin queued|be queued)/);
  }
  assert.equal(Number((await f.owner.query('SELECT count(*) FROM agenttrust.runs WHERE organization_id=$1',[f.first.organizationId])).rows[0].count),1);
  await f.engine.tick();assert.equal((await f.store.getRun(f.contexts.admin,run.id)).state,'succeeded');
});

test('HTTP release receipts block worker evidence whose pass statuses contradict stored output',async t=>{
 const f=await fixture(t);const created=await f.create('regression'),claimed=await f.engine.claim();assert.equal(claimed.id,created.run.id);
 const forged=evaluate(claimed.snapshot);for(const result of forged.results)for(const rule of result.rules)rule.status='pass';
 const count=forged.results.reduce((sum,result)=>sum+result.rules.length,0);forged.summary={cases:forged.results.length,rules:count,pass:count,fail:0,inconclusive:0,passRate:1};forged.gate={decision:'pass',deploymentAllowed:true,reason:'Synthetic inconsistent worker output'};
 // Deliberately bypass the application completion guard using the trusted worker DB role.
 await transaction(f.workerDb,async client=>{const row=(await client.query('SELECT * FROM agenttrust.runs WHERE id=$1 FOR UPDATE',[claimed.id])).rows[0];await finalize(client,row,forged);});
 const response=await f.request('/v1/release-gate',{method:'POST',json:{candidateRunId:claimed.id,...f.input('regression')},extra:{'Idempotency-Key':randomUUID()}});assert.equal(response.status,200);
 const receipt=await response.json();assert.equal(receipt.deploymentAllowed,false);assert.equal(receipt.decision,'block');assert.ok(receipt.reasons.some(reason=>reason.includes('inconsistent')));
 const stored=await(await f.request('/v1/release-receipts/'+receipt.artifact.receiptId)).json();assert.equal(stored.artifact.result.deploymentAllowed,false);assert.equal(stored.artifactHash,receipt.artifactHash);
});

test('session management scopes viewer access and administrator revocation without exposing token hashes',async t=>{
 const f=await fixture(t),adminPage=await(await f.request('/v1/sessions')).json(),viewerPage=await(await f.request('/v1/sessions',{role:'viewer'})).json();
 assert.equal(adminPage.scope,'organization');assert.equal(adminPage.items.length,3);assert.equal(viewerPage.scope,'self');assert.equal(viewerPage.items.length,1);assert.equal(viewerPage.items[0].current,true);
 assert.ok(viewerPage.items.every(s=>s.membershipId===f.contexts.viewer.membershipId));assert.ok(adminPage.items.every(s=>!Object.hasOwn(s,'token_hash')&&!Object.hasOwn(s,'token')&&!Object.hasOwn(s,'credential_id')));
 const target=viewerPage.items[0].id,admin=adminPage.items.find(s=>s.current).id,foreign=(await(await f.request('/v1/sessions',{role:'other_admin'})).json()).items[0].id;
 assert.equal((await f.request('/v1/sessions/'+admin+'/revoke',{role:'viewer',method:'POST',json:{}})).status,404);
 assert.equal((await f.request('/v1/sessions/'+foreign+'/revoke',{method:'POST',json:{}})).status,404);
 assert.equal((await f.request('/v1/sessions/'+target+'/revoke',{method:'POST',json:{}})).status,200);
 assert.equal((await f.request('/v1/me',{role:'viewer'})).status,401);assert.equal((await f.request('/v1/me')).status,200);
 const audits=await f.store.auditEvents(f.contexts.admin);assert.equal(audits.filter(e=>e.action==='auth.session.revoked'&&e.resource_id===target).length,1);
 assert.equal((await f.request('/v1/sessions/'+target+'/revoke',{method:'POST',json:{}})).status,404);
});
test('self session revocation clears its cookie and session pages reject role-bound cursor reuse',async t=>{
 const f=await fixture(t),adminPage=await(await f.request('/v1/sessions?limit=1')).json();assert.ok(adminPage.nextCursor);
 assert.equal((await f.request('/v1/sessions?limit=1&cursor='+adminPage.nextCursor,{role:'viewer'})).status,400);
 let cursor,seen=[];do{const page=await(await f.request('/v1/sessions?limit=1'+(cursor?'&cursor='+cursor:''))).json();seen.push(...page.items.map(s=>s.id));cursor=page.nextCursor;}while(cursor);assert.equal(new Set(seen).size,3);
 const own=(await(await f.request('/v1/sessions',{role:'viewer'})).json()).items[0];const response=await f.request('/v1/sessions/'+own.id+'/revoke',{role:'viewer',method:'POST',json:{}});assert.equal(response.status,200);assert.match(response.headers.get('set-cookie'),/Max-Age=0/);assert.equal((await response.json()).current,true);
 assert.equal((await f.request('/v1/me',{role:'viewer'})).status,401);
});

test('session revocation rolls back after administrator role loss during a row-lock wait',async t=>{
 const f=await fixture(t),target=(await(await f.request('/v1/sessions',{role:'viewer'})).json()).items[0].id,client=await f.owner.connect();
 try{
  await client.query('BEGIN');await client.query('SELECT id FROM agenttrust.sessions WHERE id=$1 FOR UPDATE',[target]);
  const pending=f.request('/v1/sessions/'+target+'/revoke',{method:'POST',json:{}});await blockedOn(f,'DELETE FROM agenttrust.sessions WHERE id=$1');
  await f.owner.query("UPDATE agenttrust.memberships SET role='viewer' WHERE id=$1",[f.contexts.admin.membershipId]);await client.query('COMMIT');assert.equal((await pending).status,403);
  assert.equal((await f.owner.query('SELECT id FROM agenttrust.sessions WHERE id=$1',[target])).rowCount,1);assert.equal((await f.request('/v1/me',{role:'viewer'})).status,200);
  assert.equal(Number((await f.owner.query("SELECT count(*) FROM agenttrust.audit_events WHERE organization_id=$1 AND action='auth.session.revoked'",[f.first.organizationId])).rows[0].count),0);
 }finally{await client.query('ROLLBACK').catch(()=>{});await f.owner.query("UPDATE agenttrust.memberships SET role='admin' WHERE id=$1",[f.contexts.admin.membershipId]);client.release();}
});
test('self revocation cannot commit after its own session expires while waiting for a row lock',async t=>{
 const f=await fixture(t),target=(await(await f.request('/v1/sessions',{role:'viewer'})).json()).items[0].id,client=await f.owner.connect();
 try{
  await f.owner.query("UPDATE agenttrust.sessions SET expires_at=clock_timestamp()+interval '400 milliseconds' WHERE id=$1",[target]);await client.query('BEGIN');await client.query('SELECT id FROM agenttrust.sessions WHERE id=$1 FOR UPDATE',[target]);
  const pending=f.request('/v1/sessions/'+target+'/revoke',{role:'viewer',method:'POST',json:{}});await blockedOn(f,'DELETE FROM agenttrust.sessions WHERE id=$1');await new Promise(resolve=>setTimeout(resolve,450));await client.query('COMMIT');assert.equal((await pending).status,401);
  assert.equal((await f.owner.query('SELECT id FROM agenttrust.sessions WHERE id=$1',[target])).rowCount,1);
  assert.equal(Number((await f.owner.query("SELECT count(*) FROM agenttrust.audit_events WHERE organization_id=$1 AND action='auth.session.revoked'",[f.first.organizationId])).rows[0].count),0);
 }finally{await client.query('ROLLBACK').catch(()=>{});client.release();}
});

test('worker completion rechecks lease and deadline after an actual row-lock wait',async t=>{
 const f=await fixture(t),client=await f.owner.connect();
 try{
  for(const scenario of ['lease','deadline']){
   const {run}=await f.create('compliant',scenario==='deadline'?{timeoutMs:400}:{}),claimed=await f.engine.claim();assert.equal(claimed.id,run.id);
   await client.query('BEGIN');await client.query('SELECT id FROM agenttrust.runs WHERE id=$1 FOR UPDATE',[run.id]);
   const pending=f.engine.complete(claimed,evaluate(claimed.snapshot));await blockedOn(f,"WHERE id=$1 AND state='running'",'agenttrust_worker');await new Promise(resolve=>setTimeout(resolve,scenario==='lease'?1600:600));await client.query('COMMIT');
   const accepted=await pending,final=await f.store.getRun(f.contexts.admin,run.id);
   if(scenario==='lease'){assert.equal(accepted,false);assert.equal(final.state,'running');await f.engine.tick();const recovered=await f.store.getRun(f.contexts.admin,run.id);assert.equal(recovered.state,'succeeded');assert.equal(recovered.attempts,2);}
   else{assert.equal(accepted,true);assert.equal(final.state,'timed_out');assert.equal(final.gate.deploymentAllowed,false);}
  }
 }finally{await client.query('ROLLBACK').catch(()=>{});client.release();}
});

test('application worker completion quarantines inconsistent evidence as a nonpassing failure',async t=>{
 const f=await fixture(t),{run}=await f.create('compliant'),claimed=await f.engine.claim();assert.equal(claimed.id,run.id);
 const forged=evaluate(claimed.snapshot);forged.results[0].evidence.output='Synthetic rule violation';assert.equal(await f.engine.complete(claimed,forged),true);
 const stored=await f.store.getRun(f.contexts.admin,run.id);assert.equal(stored.state,'failed');assert.equal(stored.gate.decision,'inconclusive');assert.equal(stored.gate.deploymentAllowed,false);assert.equal(stored.results.length,0);assert.match(stored.gate.reason,/inconsistent/);
 const usage=await f.store.usage(f.contexts.admin);assert.equal(usage.evaluated_cases,0);
 const audit=await f.store.auditEvents(f.contexts.admin);assert.equal(audit.filter(e=>e.action==='run.failed'&&e.resource_id===run.id).length,1);
});

test('lease fencing is enforced by the completion write even when database delivery is delayed',async t=>{
 const f=await fixture(t),{run}=await f.create(),delayedDb={connect:async()=>{const client=await f.workerDb.connect();return {release:()=>client.release(),query:async(...args)=>{if(args[0].includes('UPDATE agenttrust.runs')&&args[0].includes('completed_at'))await new Promise(resolve=>setTimeout(resolve,500));return client.query(...args);}};}};
 const delayed=new WorkerEngine(delayedDb,{leaseMs:400}),claimed=await delayed.claim();assert.equal(claimed.id,run.id);
 assert.equal(await delayed.complete(claimed,evaluate(claimed.snapshot)),false);assert.equal((await f.store.getRun(f.contexts.admin,run.id)).state,'running');
 await f.engine.tick();const recovered=await f.store.getRun(f.contexts.admin,run.id);assert.equal(recovered.state,'succeeded');assert.equal(recovered.attempts,2);
});


test('successful login limits survive logout and API restart and remain tenant scoped',async t=>{
 const options={successLoginLimitPerCredential:2,successLoginLimitPerOrganization:4},f=await fixture(t,{authOptions:options});
 const key=f.first.credentials.find(c=>c.role==='admin'),viewer=f.first.credentials.find(c=>c.role==='viewer');
 const extra=await f.auth.login(key.token);await f.auth.logout(extra.token,f.contexts.admin);
 await assert.rejects(f.auth.login(key.token),e=>e.status===429);
 await assert.rejects(f.auth.login(viewer.token),e=>e.status===429);
 await assert.rejects(new Auth(f.database,options).login(key.token),e=>e.status===429);
 const independent=await f.auth.login(f.other.credentials.find(c=>c.role==='admin').token);assert.ok(independent.token);
 const count=(await f.owner.query("SELECT count(*) FROM agenttrust.audit_events WHERE organization_id=$1 AND action='auth.login'",[f.contexts.admin.organizationId])).rows[0];assert.equal(Number(count.count),4);
});

test('credential revocation and principal rebinding during an organization login lock wait reject login',async t=>{
 const f=await fixture(t),admin=f.first.credentials.find(c=>c.role==='admin'),editor=f.first.credentials.find(c=>c.role==='editor'),client=await f.owner.connect();
 try{for(const scenario of ['revoked','rebound']){
  const before=Number((await f.owner.query('SELECT count(*) FROM agenttrust.sessions WHERE credential_id=$1',[admin.id])).rows[0].count);
  await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,6))',[f.contexts.admin.organizationId]);
  const pending=fetch(f.base+'/v1/auth/login',{method:'POST',headers,body:JSON.stringify({accessKey:admin.token})});await blockedOn(f,'hashtextextended($1,6)');
  if(scenario==='revoked')await f.owner.query('UPDATE agenttrust.credentials SET revoked_at=clock_timestamp() WHERE id=$1',[admin.id]);
  else{await f.owner.query('UPDATE agenttrust.credentials SET token_hash=$2 WHERE id=$1',[admin.id,tokenHash(randomUUID())]);await f.owner.query('UPDATE agenttrust.credentials SET token_hash=$2 WHERE id=$1',[editor.id,tokenHash(admin.token)]);}
  await client.query('COMMIT');assert.equal((await pending).status,401);
  assert.equal(Number((await f.owner.query('SELECT count(*) FROM agenttrust.sessions WHERE credential_id=$1',[admin.id])).rows[0].count),before);
  await f.owner.query('UPDATE agenttrust.credentials SET token_hash=$2 WHERE id=$1',[editor.id,tokenHash(editor.token)]);await f.owner.query('UPDATE agenttrust.credentials SET token_hash=$2,revoked_at=NULL WHERE id=$1',[admin.id,tokenHash(admin.token)]);
 }}finally{await client.query('ROLLBACK');await f.owner.query('UPDATE agenttrust.credentials SET token_hash=$2 WHERE id=$1',[editor.id,tokenHash(editor.token)]);await f.owner.query('UPDATE agenttrust.credentials SET token_hash=$2,revoked_at=NULL WHERE id=$1',[admin.id,tokenHash(admin.token)]);client.release();}
});


test('organization success budget is atomic across API instances and timestamps follow lock waits',async t=>{
 const options={successLoginLimitPerCredential:2,successLoginLimitPerOrganization:4},f=await fixture(t,{authOptions:options}),client=await f.owner.connect();
 try{
  await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,6))',[f.first.organizationId]);
  const second=new Auth(f.database,options),keys=['admin','editor'].map(role=>f.first.credentials.find(c=>c.role===role));
  const pending=Promise.allSettled([f.auth.login(keys[0].token),second.login(keys[1].token)]);await blockedOn(f,'hashtextextended($1,6)');
  await new Promise(resolve=>setTimeout(resolve,250));const releasedAt=(await client.query('SELECT clock_timestamp() AS time')).rows[0].time;await client.query('COMMIT');
  const outcomes=await pending;assert.equal(outcomes.filter(o=>o.status==='fulfilled').length,1);assert.equal(outcomes.filter(o=>o.status==='rejected'&&o.reason.status===429).length,1);
  const events=(await f.owner.query("SELECT created_at FROM agenttrust.audit_events WHERE organization_id=$1 AND action='auth.login' ORDER BY created_at DESC",[f.first.organizationId])).rows;assert.equal(events.length,4);assert.ok(events[0].created_at>=releasedAt);
 }finally{await client.query('ROLLBACK');client.release();}
});


test('CI credential row-lock waits cannot preserve expired credentials or revoked issuer roles',async t=>{
 const f=await fixture(t),{run}=await f.create();await f.engine.tick();const client=await f.owner.connect();
 try{for(const scenario of ['expiry','issuer','revocation','inactive']){
  const credential=await(await f.request('/v1/ci-credentials',{method:'POST',json:{name:'Row-wait '+scenario,projectId:f.first.projectId,ttlSeconds:60}})).json();
  if(scenario==='expiry')await f.owner.query("UPDATE agenttrust.ci_credentials SET expires_at=clock_timestamp()+interval '400 milliseconds' WHERE id=$1",[credential.id]);
  await client.query('BEGIN');await client.query('SELECT id FROM agenttrust.ci_credentials WHERE id=$1 FOR UPDATE',[credential.id]);
  const pending=f.request('/v1/release-gate',{method:'POST',json:{candidateRunId:run.id,...f.input()},extra:{Authorization:'Bearer '+credential.token}});await blockedOn(f,'project_id=$3 FOR SHARE');
  if(scenario==='expiry')await new Promise(resolve=>setTimeout(resolve,450));
  else if(scenario==='revocation')await client.query('UPDATE agenttrust.ci_credentials SET revoked_at=clock_timestamp() WHERE id=$1',[credential.id]);
  else await f.owner.query(scenario==='inactive'?"UPDATE agenttrust.memberships SET active=false WHERE id=$1":"UPDATE agenttrust.memberships SET role='editor' WHERE id=$1",[f.contexts.admin.membershipId]);
  await client.query('COMMIT');assert.equal((await pending).status,401);
  await f.owner.query("UPDATE agenttrust.memberships SET role='admin',active=true WHERE id=$1",[f.contexts.admin.membershipId]);
  assert.equal(Number((await f.owner.query('SELECT count(*) FROM agenttrust.release_receipts WHERE organization_id=$1',[f.first.organizationId])).rows[0].count),0);
 }}finally{await client.query('ROLLBACK');await f.owner.query("UPDATE agenttrust.memberships SET role='admin',active=true WHERE id=$1",[f.contexts.admin.membershipId]);client.release();}
});


test('a previously approved idempotent CI receipt cannot replay after key expiry during its row-lock wait',async t=>{
 const f=await fixture(t),{run}=await f.create();await f.engine.tick();const credential=await(await f.request('/v1/ci-credentials',{method:'POST',json:{name:'Replay expiry',projectId:f.first.projectId,ttlSeconds:60}})).json();
 const key=randomUUID(),input={candidateRunId:run.id,...f.input()},extra={Authorization:'Bearer '+credential.token,'Idempotency-Key':key};
 const original=await(await f.request('/v1/release-gate',{method:'POST',json:input,extra})).json();assert.equal(original.deploymentAllowed,true);const client=await f.owner.connect();
 try{
  await f.owner.query("UPDATE agenttrust.ci_credentials SET expires_at=clock_timestamp()+interval '400 milliseconds' WHERE id=$1",[credential.id]);await client.query('BEGIN');await client.query('SELECT id FROM agenttrust.ci_credentials WHERE id=$1 FOR UPDATE',[credential.id]);
  const pending=f.request('/v1/release-gate',{method:'POST',json:input,extra});await blockedOn(f,'project_id=$3 FOR SHARE');await new Promise(resolve=>setTimeout(resolve,450));await client.query('COMMIT');assert.equal((await pending).status,401);
  assert.equal(Number((await f.owner.query('SELECT count(*) FROM agenttrust.release_receipts WHERE organization_id=$1',[f.first.organizationId])).rows[0].count),1);
  const historical=await(await f.request('/v1/release-receipts/'+original.artifact.receiptId)).json();assert.equal(historical.artifactHash,original.artifactHash);
 }finally{await client.query('ROLLBACK');client.release();}
});


test('manual approval reviewer role is read after waiting for the CI credential lock',async t=>{
 const f=await fixture(t);await f.owner.query("UPDATE agenttrust.memberships SET role='admin' WHERE id=$1",[f.contexts.editor.membershipId]);
 const policy=await f.store.createVersion(f.contexts.admin,'policy',{name:'Reviewer wait',minimumPassRate:1,requiresManualApproval:true});const {run}=await f.create('compliant',{policyVersionId:policy.id});await f.engine.tick();
 assert.equal((await f.request('/v1/runs/'+run.id+'/reviews',{role:'editor',method:'POST',json:{decision:'approved'},extra:{'Idempotency-Key':randomUUID()}})).status,201);
 const credential=await(await f.request('/v1/ci-credentials',{method:'POST',json:{name:'Reviewer lock',projectId:f.first.projectId,ttlSeconds:60}})).json(),client=await f.owner.connect();
 try{
  await client.query('BEGIN');await client.query('SELECT id FROM agenttrust.ci_credentials WHERE id=$1 FOR UPDATE',[credential.id]);
  const pending=f.request('/v1/release-gate',{method:'POST',json:{candidateRunId:run.id,...f.input('compliant',{policyVersionId:policy.id})},extra:{Authorization:'Bearer '+credential.token}});await blockedOn(f,'project_id=$3 FOR SHARE');
  await f.owner.query("UPDATE agenttrust.memberships SET role='viewer' WHERE id=$1",[f.contexts.editor.membershipId]);await client.query('COMMIT');const receipt=await(await pending).json();assert.equal(receipt.deploymentAllowed,false);assert.equal(receipt.manualApproval.status,'invalid');
 }finally{await client.query('ROLLBACK');await f.owner.query("UPDATE agenttrust.memberships SET role='editor' WHERE id=$1",[f.contexts.editor.membershipId]);client.release();}
});


test('manual approval refuses a stored pass whose evidence contradicts its rule statuses',async t=>{
 const f=await fixture(t),policy=await f.store.createVersion(f.contexts.admin,'policy',{name:'Corrupt review evidence',minimumPassRate:1,requiresManualApproval:true});const created=await f.create('compliant',{policyVersionId:policy.id}),claimed=await f.engine.claim();assert.equal(claimed.id,created.run.id);
 const outcome=evaluate(claimed.snapshot);outcome.results[0].evidence.output='Incorrect synthetic answer';
 // Deliberately bypass the application worker guard through the trusted worker role.
 await transaction(f.workerDb,client=>finalize(client,claimed,outcome));
 const path='/v1/runs/'+claimed.id+'/reviews';assert.equal((await f.request(path,{method:'POST',json:{decision:'approved'},extra:{'Idempotency-Key':randomUUID()}})).status,409);
 assert.equal(Number((await f.owner.query('SELECT count(*) FROM agenttrust.run_reviews WHERE run_id=$1',[claimed.id])).rows[0].count),0);
 assert.equal((await f.request(path,{method:'POST',json:{decision:'rejected',comment:'Stored evidence is inconsistent.'},extra:{'Idempotency-Key':randomUUID()}})).status,201);
});


test('manual review pages use insertion order across backwards clocks and bind tenant project and run',async t=>{
 const f=await fixture(t),policy=await f.store.createVersion(f.contexts.admin,'policy',{name:'Paged reviews',minimumPassRate:1,requiresManualApproval:true}),{run}=await f.create('compliant',{policyVersionId:policy.id});await f.engine.tick();const path='/v1/runs/'+run.id+'/reviews';
 const approved=await(await f.request(path,{method:'POST',json:{decision:'approved',comment:'First opinion'},extra:{'Idempotency-Key':randomUUID()}})).json();
 await f.request(path,{method:'POST',json:{decision:'rejected',comment:'Second opinion'},extra:{'Idempotency-Key':randomUUID()}});
 const {reviewHash,replay,...original}=approved,payload={...original,id:randomUUID(),decision:'rejected',comment:'Later sequence with older clock',createdAt:new Date(Date.now()-3600000).toISOString()};
 await f.owner.query('INSERT INTO agenttrust.run_reviews(id,organization_id,project_id,run_id,actor_id,decision,payload,review_hash,idempotency_key,request_hash,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[payload.id,payload.organizationId,payload.projectId,payload.runId,payload.actorId,payload.decision,payload,hash(payload),randomUUID(),hash({synthetic:true}),payload.createdAt]);
 const originalIds=(await(await f.request(path)).json()).map(review=>review.id),first=await(await f.request(path+'?limit=1')).json();assert.equal(first.items[0].id,payload.id);assert.ok(first.nextCursor);assert.ok(!Object.hasOwn(first.items[0],'cursor_order'));
 await f.request(path,{method:'POST',json:{decision:'approved',comment:'Arrived after first page'},extra:{'Idempotency-Key':randomUUID()}});
 const ids=first.items.map(review=>review.id);let cursor=first.nextCursor;while(cursor){const page=await(await f.request(path+'?limit=1&cursor='+encodeURIComponent(cursor))).json();ids.push(...page.items.map(review=>review.id));cursor=page.nextCursor;}assert.deepEqual(ids,originalIds);assert.equal(new Set(ids).size,3);
 const otherRun=(await f.create('compliant',{policyVersionId:policy.id})).run;
 assert.equal((await f.request('/v1/runs/'+otherRun.id+'/reviews?cursor='+encodeURIComponent(first.nextCursor))).status,400);
 assert.equal((await f.request(path+'?cursor='+encodeURIComponent(first.nextCursor),{role:'other_admin'})).status,400);
 const project=await(await f.request('/v1/projects',{method:'POST',json:{name:'Other review project'},extra:{'Idempotency-Key':randomUUID()}})).json();
 assert.equal((await f.request(path+'?cursor='+encodeURIComponent(first.nextCursor),{extra:{'X-AgentTrust-Project':project.id}})).status,400);
 for(const query of ['limit=101','limit=1&limit=2','cursor=%%%','limit=1&sort=clock'])assert.equal((await f.request(path+'?'+query)).status,400);
});


test('receipt filters page exact decisions and candidates without including full evidence',async t=>{
 const f=await fixture(t),first=await f.create(),second=await f.create('regression');await f.engine.tick();await f.engine.tick();
 for(const run of [first.run,second.run])for(let i=0;i<3;i++)assert.equal((await f.request('/v1/release-gate',{method:'POST',json:{candidateRunId:run.id,...f.input(run.id===first.run.id?'compliant':'regression')},extra:{'Idempotency-Key':randomUUID()}})).status,200);
 for(const [decision,run] of [['pass',first.run],['block',second.run]]){
  let cursor;const ids=[];do{const response=await f.request('/v1/release-receipts?limit=2&decision='+decision+'&candidateRunId='+run.id.toUpperCase()+(cursor?'&cursor='+cursor:''),{role:'viewer'});assert.equal(response.status,200);const page=await response.json();for(const row of page.items){assert.equal(row.decision,decision);assert.equal(row.candidate_run_id,run.id);for(const key of ['artifact','request','result','evidence','snapshot','signature'])assert.equal(Object.hasOwn(row,key),false);}ids.push(...page.items.map(r=>r.id));cursor=page.nextCursor;}while(cursor);assert.equal(ids.length,3);assert.equal(new Set(ids).size,3);
 }
 const legacy=await(await f.request('/v1/release-receipts?decision=block')).json();assert.ok(Array.isArray(legacy));assert.equal(legacy.length,3);
 const empty=await(await f.request('/v1/release-receipts?limit=2&candidateRunId='+randomUUID())).json();assert.deepEqual(empty,{items:[],nextCursor:null});
 const foreign=await(await f.request('/v1/release-receipts?limit=2&candidateRunId='+first.run.id,{role:'other_admin'})).json();assert.deepEqual(foreign,{items:[],nextCursor:null});
});

test('receipt filter cursors cannot be reused for another decision, candidate or resource',async t=>{
 const f=await fixture(t),{run}=await f.create();await f.engine.tick();
 for(let i=0;i<3;i++){await f.request('/v1/release-gate',{method:'POST',json:{candidateRunId:run.id,...f.input()},extra:{'Idempotency-Key':randomUUID()}});await f.request('/v1/ci-credentials',{method:'POST',json:{name:'Filter key '+i,projectId:f.first.projectId,ttlSeconds:60}});}
 const page=await(await f.request('/v1/release-receipts?limit=1&decision=pass&candidateRunId='+run.id)).json();assert.ok(page.nextCursor);
 for(const query of ['limit=1','limit=1&decision=block&candidateRunId='+run.id,'limit=1&decision=pass&candidateRunId='+randomUUID()])assert.equal((await f.request('/v1/release-receipts?'+query+'&cursor='+page.nextCursor)).status,400);
 assert.equal((await f.request('/v1/ci-credentials?limit=1&cursor='+page.nextCursor)).status,400);
 const keyPage=await(await f.request('/v1/ci-credentials?limit=1')).json();assert.equal((await f.request('/v1/release-receipts?limit=1&cursor='+keyPage.nextCursor)).status,400);
 for(const query of ['decision=inconclusive','decision=pass&decision=block','decision=','candidateRunId=','candidateRunId=bad','candidateRunId='+run.id+'&candidateRunId='+run.id,'decision=pass&unknown=1'])assert.equal((await f.request('/v1/release-receipts?'+query)).status,400);
});


test('historical review lookup preserves the original approval after later rejection and scopes reader access',async t=>{
 const f=await fixture(t),policy=await f.store.createVersion(f.contexts.admin,'policy',{name:'Historical approval evidence',minimumPassRate:1,requiresManualApproval:true}),{run}=await f.create('compliant',{policyVersionId:policy.id});await f.engine.tick();const path='/v1/runs/'+run.id+'/reviews';
 const approved=await(await f.request(path,{method:'POST',json:{decision:'approved',comment:'Original synthetic approval'},extra:{'Idempotency-Key':randomUUID()}})).json();await f.request(path,{method:'POST',json:{decision:'rejected',comment:'Later rejection'},extra:{'Idempotency-Key':randomUUID()}});
 const response=await f.request(path+'/'+approved.id,{role:'viewer'});assert.equal(response.status,200);const original=await response.json();assert.equal(original.decision,'approved');assert.equal(original.comment,'Original synthetic approval');assert.equal(original.reviewHash,approved.reviewHash);assert.equal(original.actorId,f.contexts.admin.membershipId);for(const key of ['actorValid','replay','idempotency_key','request_hash','review_order'])assert.equal(Object.hasOwn(original,key),false);
 const {reviewHash,...payload}=original;assert.equal(hash(payload),reviewHash);const current=await(await f.request('/v1/release-gate',{role:'viewer',method:'POST',json:{candidateRunId:run.id,...f.input('compliant',{policyVersionId:policy.id})}})).json();assert.equal(current.deploymentAllowed,false);assert.equal(current.manualApproval.status,'rejected');
 assert.equal((await f.request(path+'/'+approved.id,{role:'other_admin'})).status,404);assert.equal((await f.request('/v1/runs/'+randomUUID()+'/reviews/'+approved.id,{role:'viewer'})).status,404);assert.equal((await f.request(path+'/'+randomUUID(),{role:'viewer'})).status,404);assert.equal((await f.request(path+'/invalid',{role:'viewer'})).status,400);assert.equal((await f.request(path+'/'+approved.id+'?unknown=1',{role:'viewer'})).status,400);
 await f.owner.query('UPDATE agenttrust.memberships SET active=false WHERE id=$1',[f.contexts.admin.membershipId]);assert.equal((await f.request(path+'/'+approved.id,{role:'viewer'})).status,200);
});

test('review detail cannot cross a same-organization project boundary',async t=>{
 const f=await fixture(t),policy=await f.store.createVersion(f.contexts.admin,'policy',{name:'Project review evidence',minimumPassRate:1,requiresManualApproval:true}),{run}=await f.create('compliant',{policyVersionId:policy.id});await f.engine.tick();const path='/v1/runs/'+run.id+'/reviews';const review=await(await f.request(path,{method:'POST',json:{decision:'approved'},extra:{'Idempotency-Key':randomUUID()}})).json();const project=randomUUID();await f.owner.query('INSERT INTO agenttrust.projects(id,organization_id,name) VALUES($1,$2,$3)',[project,f.first.organizationId,'Other review project']);assert.equal((await f.request(path+'/'+review.id,{role:'viewer',extra:{'X-AgentTrust-Project':project}})).status,404);
});

test('correctly hashed review payloads with contradictory stored identities are not exposed or used for approval',async t=>{
 const f=await fixture(t),policy=await f.store.createVersion(f.contexts.admin,'policy',{name:'Corrupt review evidence',minimumPassRate:1,requiresManualApproval:true}),{run}=await f.create('compliant',{policyVersionId:policy.id});await f.engine.tick();const path='/v1/runs/'+run.id+'/reviews';const approved=await(await f.request(path,{method:'POST',json:{decision:'approved'},extra:{'Idempotency-Key':randomUUID()}})).json();const {reviewHash,replay,...original}=approved;
 for(const [field,value] of [['organizationId',randomUUID()],['projectId',randomUUID()],['runId',randomUUID()],['id',randomUUID()],['actorId',randomUUID()],['decision','rejected'],['createdAt','2001-01-01T00:00:00.000Z'],['extraPrivateField','private-review-canary']]){
  const id=randomUUID(),payload={...original,id,comment:'private-review-canary',[field]:value};await f.owner.query('INSERT INTO agenttrust.run_reviews(id,organization_id,project_id,run_id,actor_id,decision,payload,review_hash,idempotency_key,request_hash,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[id,f.first.organizationId,f.first.projectId,run.id,f.contexts.admin.membershipId,'approved',payload,hash(payload),randomUUID(),hash({synthetic:true}),original.createdAt]);const listed=await f.request(path,{role:'viewer'});assert.equal(listed.status,503);assert.ok(!(await listed.text()).includes('private-review-canary'));const response=await f.request(path+'/'+id,{role:'viewer'});assert.equal(response.status,503);assert.ok(!(await response.text()).includes('private-review-canary'));
 }
 const list=await f.request(path,{role:'viewer'});assert.equal(list.status,503);assert.ok(!(await list.text()).includes('private-review-canary'));const gate=await f.request('/v1/release-gate',{role:'viewer',method:'POST',json:{candidateRunId:run.id,...f.input('compliant',{policyVersionId:policy.id})}});assert.equal(gate.status,503);
});


test('administrator execution capacity covers its organization while queue remains project scoped',async t=>{
 const f=await fixture(t),{run}=await f.create(),project=await f.store.createProject(f.contexts.admin,{name:'Capacity second project'},randomUUID()),selected={...f.contexts.admin,projectId:project.id};
 const dataset=await f.store.createVersion(selected,'dataset',await(await f.request('/v1/sample-dataset')).json()),agent=await f.store.createVersion(selected,'agent',{name:'Capacity agent',mode:'compliant'}),policy=await f.store.createVersion(selected,'policy',{name:'Capacity policy',minimumPassRate:1});
 const second=await f.store.createRun(selected,{agentVersionId:agent.id,datasetVersionId:dataset.id,policyVersionId:policy.id},randomUUID());
 await f.store.cancel(f.contexts.admin,run.id);
 const foreignCatalog=await f.store.catalog(f.contexts.other_admin),foreign=await f.store.createRun(f.contexts.other_admin,{agentVersionId:foreignCatalog.agent[0].id,datasetVersionId:foreignCatalog.dataset[0].id,policyVersionId:foreignCatalog.policy[0].id},randomUUID());
 try{
  const first=await(await f.request('/v1/operations')).json(),otherProject=await(await f.request('/v1/operations',{extra:{'X-AgentTrust-Project':project.id}})).json(),otherOrganization=await(await f.request('/v1/operations',{role:'other_admin'})).json();
  assert.equal(first.queue.queued,0);assert.equal(otherProject.queue.queued,1);
  assert.deepEqual(first.versionCapacity,{scope:'organization',organizationId:f.first.organizationId,used:12,limit:1000,remaining:988});assert.deepEqual(otherProject.versionCapacity,first.versionCapacity);assert.deepEqual(otherOrganization.versionCapacity,{scope:'organization',organizationId:f.other.organizationId,used:9,limit:1000,remaining:991});

  assert.deepEqual(first.executionCapacity,{scope:'organization',organizationId:f.first.organizationId,retained:{used:2,limit:10000,remaining:9998},active:{used:1,limit:10,remaining:9}});
  assert.deepEqual(otherProject.executionCapacity,first.executionCapacity);assert.deepEqual(otherOrganization.executionCapacity,{scope:'organization',organizationId:f.other.organizationId,retained:{used:1,limit:10000,remaining:9999},active:{used:1,limit:10,remaining:9}});
  await f.store.cancel(selected,second.run.id);const after=await(await f.request('/v1/operations')).json();assert.equal(after.executionCapacity.retained.used,2);assert.equal(after.executionCapacity.active.used,0);assert.equal(after.executionCapacity.active.remaining,10);
 }finally{await f.store.cancel(selected,second.run.id);await f.store.cancel(f.contexts.other_admin,foreign.run.id);}
});


test('organization version capacity follows the atomic shared registration quota under competing creates',async t=>{
 const f=await fixture(t),data={name:'Synthetic version quota fixture',minimumPassRate:1};await f.owner.query("INSERT INTO agenttrust.versions(id,organization_id,project_id,kind,data,content_hash) SELECT gen_random_uuid(),$1,$2,'policy',$3::jsonb,$4 FROM generate_series(1,990)",[f.first.organizationId,f.first.projectId,JSON.stringify(data),hash(data)]);
 const before=await(await f.request('/v1/operations')).json();assert.deepEqual(before.versionCapacity,{scope:'organization',organizationId:f.first.organizationId,used:999,limit:1000,remaining:1});
 const outcomes=await Promise.allSettled([f.store.createVersion(f.contexts.admin,'policy',{name:'Synthetic competing policy A',minimumPassRate:1}),f.store.createVersion(f.contexts.admin,'policy',{name:'Synthetic competing policy B',minimumPassRate:1})]);assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);const denied=outcomes.find(x=>x.status==='rejected');assert.equal(denied.reason.status,429);const after=await(await f.request('/v1/operations')).json();assert.equal(after.versionCapacity.used,1000);assert.equal(after.versionCapacity.remaining,0);const foreign=await(await f.request('/v1/operations',{role:'other_admin'})).json();assert.equal(foreign.versionCapacity.used,9);assert.equal((await f.request('/v1/operations',{role:'viewer'})).status,403);
});

test('synthetic acceptance sample is authenticated, project scoped and creates no business data',async t=>{
 const f=await fixture(t),path='/v1/sample-acceptance-profile',before=await f.owner.query('SELECT (SELECT count(*)::int FROM agenttrust.versions WHERE organization_id=$1) AS versions,(SELECT count(*)::int FROM agenttrust.runs WHERE organization_id=$1) AS runs,(SELECT count(*)::int FROM agenttrust.audit_events WHERE organization_id=$1) AS audits',[f.first.organizationId]);
 assert.equal((await fetch(f.base+path)).status,401);for(const role of ['admin','editor','viewer']){const response=await f.request(path,{role});assert.equal(response.status,200);const profile=await response.json();assert.deepEqual(profile,sampleAcceptanceProfile);assert.equal(validateAcceptanceProfile(profile).synthetic,true);profile.policy.minimumPassRate=0;assert.equal((await(await f.request(path,{role})).json()).policy.minimumPassRate,1);}
 const observed=await f.owner.query('SELECT (SELECT count(*)::int FROM agenttrust.versions WHERE organization_id=$1) AS versions,(SELECT count(*)::int FROM agenttrust.runs WHERE organization_id=$1) AS runs,(SELECT count(*)::int FROM agenttrust.audit_events WHERE organization_id=$1) AS audits',[f.first.organizationId]);assert.deepEqual(observed.rows,before.rows);
 assert.equal((await f.request(path+'?unexpected=1')).status,400);assert.equal((await f.request(path,{extra:{'X-AgentTrust-Project':f.other.projectId}})).status,404);const issued=await f.request('/v1/ci-credentials',{method:'POST',json:{name:'Synthetic acceptance sample access',projectId:f.first.projectId,ttlSeconds:60}});assert.equal(issued.status,201);const key=await issued.json();const ci=await fetch(f.base+path,{headers:{Authorization:'Bearer '+key.token}});assert.equal(ci.status,403);
 const after=await f.owner.query('SELECT (SELECT count(*)::int FROM agenttrust.versions WHERE organization_id=$1) AS versions,(SELECT count(*)::int FROM agenttrust.runs WHERE organization_id=$1) AS runs',[f.first.organizationId]);assert.equal(after.rows[0].versions,before.rows[0].versions);assert.equal(after.rows[0].runs,before.rows[0].runs);
});

async function readinessBusinessCounts(f,organizationId=f.first.organizationId){
 const counts={};
 for(const table of ['versions','runs','run_reviews','release_receipts','usage_events','audit_events'])counts[table]=(await f.owner.query(`SELECT count(*)::int AS total FROM agenttrust.${table} WHERE organization_id=$1`,[organizationId])).rows[0].total;
 return counts;
}
test('read-only acceptance readiness requires administrator and binds its result to the selected project',async t=>{
 const f=await fixture(t),path='/v1/acceptance-readiness';await heartbeat(f.workerDb);
 assert.equal((await fetch(f.base+path)).status,401);
 for(const role of ['editor','viewer'])for(const method of ['GET','POST'])assert.equal((await f.request(path,{role,method,...(method==='POST'?{json:sampleAcceptanceProfile}:{})})).status,403);
 const key=await(await f.request('/v1/ci-credentials',{method:'POST',json:{name:'Readiness access fixture',projectId:f.first.projectId,ttlSeconds:60}})).json();
 assert.equal((await fetch(f.base+path,{headers:{Authorization:'Bearer '+key.token}})).status,403);
 const before=await readinessBusinessCounts(f),foreignBefore=await readinessBusinessCounts(f,f.other.organizationId);
 for(const role of ['admin','other_admin']){const response=await f.request(path,{role});assert.equal(response.status,200);const r=await response.json(),scope=role==='admin'?f.first:f.other;assert.equal(r.organizationId,scope.organizationId);assert.equal(r.projectId,scope.projectId);assert.equal(r.purpose,'synthetic-acceptance-readiness-plan');assert.equal(r.completed,true);assert.equal(r.agentVersionsVerified,5);assert.equal(r.versionCapacityPreflight.requestedVersions,2);assert.equal(r.runsCreated,0);assert.equal(r.businessDataWrites,false);assert.equal(r.releaseGateEvaluated,false);assert.equal(r.currentReleasePermissionVerified,false);}
 for(const method of ['GET','POST']){assert.equal((await f.request(path+'?unexpected=1',{method,...(method==='POST'?{json:sampleAcceptanceProfile}:{})})).status,400);assert.equal((await f.request(path,{method,extra:{'X-AgentTrust-Project':f.other.projectId},...(method==='POST'?{json:sampleAcceptanceProfile}:{})})).status,404);}
 assert.deepEqual(await readinessBusinessCounts(f),before);assert.deepEqual(await readinessBusinessCounts(f,f.other.organizationId),foreignBefore);
});
test('posted synthetic readiness verifies exact criterion reuse without registering edited drafts',async t=>{
 const f=await fixture(t),path='/v1/acceptance-readiness';await heartbeat(f.workerDb);
 for(const kind of ['dataset','policy'])await f.store.createVersion(f.contexts.admin,kind,sampleAcceptanceProfile[kind]);
 const before=await readinessBusinessCounts(f);let r=await(await f.request(path,{method:'POST',json:sampleAcceptanceProfile})).json();
 assert.equal(r.profileHash,hash(sampleAcceptanceProfile));assert.equal(r.completed,true);assert.equal(r.versionCapacityPreflight.requestedVersions,0);assert.ok(r.criteria.dataset.reused&&r.criteria.policy.reused);
 const edited=structuredClone(sampleAcceptanceProfile);edited.dataset.name='private-readiness-input-canary';edited.policy.name='private-readiness-policy-canary';
 r=await(await f.request(path,{method:'POST',json:edited})).json();assert.equal(r.profileHash,hash(edited));assert.equal(r.completed,true);assert.equal(r.versionCapacityPreflight.requestedVersions,2);assert.equal(r.criteria.dataset.reused,false);assert.equal(r.criteria.policy.reused,false);assert.ok(!JSON.stringify(r).includes('private-readiness'));
 const project=await f.store.createProject(f.contexts.admin,{name:'Readiness isolated project'},randomUUID());const projectBefore=await readinessBusinessCounts(f);
 r=await(await f.request(path,{extra:{'X-AgentTrust-Project':project.id}})).json();assert.equal(r.projectId,project.id);assert.equal(r.completed,false);assert.equal(r.failedStage,'agent-versions');assert.equal(r.runsCreated,0);assert.deepEqual(await readinessBusinessCounts(f),projectBefore);
 assert.equal(before.versions,projectBefore.versions);assert.equal(before.runs,projectBefore.runs);
});
test('readiness API keeps worker, capacity and stored-evidence failures bounded and performs no business writes',async t=>{
 const f=await fixture(t),path='/v1/acceptance-readiness',operations=f.store.operations.bind(f.store),getVersion=f.store.getVersion.bind(f.store);await heartbeat(f.workerDb);
 const before=await readinessBusinessCounts(f);
 for(const [mutate,stage] of [[o=>o.worker.state='stale','worker'],[o=>o.executionCapacity.organizationId=randomUUID(),'execution-capacity'],[o=>{o.versionCapacity.used=999;o.versionCapacity.remaining=1;},'version-capacity']]){
  f.store.operations=async context=>{const o=await operations(context);mutate(o);return o;};const response=await f.request(path);assert.equal(response.status,200);const r=await response.json();assert.equal(r.completed,false);assert.equal(r.failedStage,stage);assert.equal(r.runsCreated,0);assert.equal(r.businessDataWrites,false);
 }
 f.store.operations=operations;f.store.getVersion=async(context,id)=>{const v=await getVersion(context,id);v.data.name='private-stored-version-canary';return v;};const r=await(await f.request(path)).json();assert.equal(r.completed,false);assert.equal(r.failedStage,'agent-versions');assert.ok(!JSON.stringify(r).includes('private-stored-version-canary'));assert.deepEqual(await readinessBusinessCounts(f),before);
});
test('posted readiness accepts the exact 64 KiB boundary and rejects malformed or weak profiles before operations',async t=>{
 const f=await fixture(t),path='/v1/acceptance-readiness';await heartbeat(f.workerDb);let reads=0;const operations=f.store.operations.bind(f.store);f.store.operations=async context=>{reads++;return operations(context);};
 const before=await readinessBusinessCounts(f),text=JSON.stringify(sampleAcceptanceProfile),send=body=>fetch(f.base+path,{method:'POST',headers:{...headers,Cookie:f.cookies.admin},body});
 const exact=text+' '.repeat(65536-Buffer.byteLength(text));assert.equal((await send(exact)).status,200);assert.equal(reads,1);
 const tooLarge=await send(exact+' ');assert.equal(tooLarge.status,413);assert.equal((await tooLarge.json()).error,'JSON body exceeds 64 KiB.');
 for(const input of [null,{...sampleAcceptanceProfile,synthetic:false},{...sampleAcceptanceProfile,policy:{...sampleAcceptanceProfile.policy,minimumPassRate:0.5}}]){const r=await send(JSON.stringify(input));assert.equal(r.status,400);assert.equal((await r.json()).error,'Invalid synthetic acceptance profile.');}
 assert.equal((await send(Buffer.from([0xff]))).status,400);assert.equal((await send('{')).status,400);assert.equal(reads,1);assert.deepEqual(await readinessBusinessCounts(f),before);
});
