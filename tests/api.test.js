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
import { PgStore,incomplete } from '../apps/api/pg-store.js';
import { WorkerEngine } from '../apps/worker/engine.js';
import { heartbeat } from '../apps/worker/health.js';
import { seedOrganization } from '../scripts/setup.mjs';
import { tokenHash,hash } from '../packages/contracts/hash.js';

const headers={'Content-Type':'application/json','X-AgentTrust-Request':'local-ui'};
async function fixture(t,{ciOptions}={}) {
  if(!process.env.TEST_DATABASE_URL||new URL(process.env.TEST_DATABASE_URL).pathname!=='/agenttrust_test') throw new Error('Run npm run setup; integration tests require the isolated agenttrust_test database.');
  const owner=pool(process.env.TEST_OWNER_DATABASE_URL), database=pool(process.env.TEST_DATABASE_URL), workerDb=pool(process.env.TEST_WORKER_DATABASE_URL);
  const first=await seedOrganization(owner,`Test ${randomUUID()}`),other=await seedOrganization(owner,`Other ${randomUUID()}`);
  const store=new PgStore(database),auth=new Auth(database),engine=new WorkerEngine(workerDb,{leaseMs:1500,pollMs:20});
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
