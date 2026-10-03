import test from 'node:test';
import { request as httpRequest } from 'node:http';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../apps/api/server.js';
import { pool,transaction } from '../apps/api/database.js';
import { Auth } from '../apps/api/auth.js';
import { PgStore,incomplete } from '../apps/api/pg-store.js';
import { WorkerEngine } from '../apps/worker/engine.js';
import { seedOrganization } from '../scripts/setup.mjs';
import { tokenHash } from '../packages/contracts/hash.js';

const headers={'Content-Type':'application/json','X-AgentTrust-Request':'local-ui'};
async function fixture(t) {
  if(!process.env.TEST_DATABASE_URL||new URL(process.env.TEST_DATABASE_URL).pathname!=='/agenttrust_test') throw new Error('Run npm run setup; integration tests require the isolated agenttrust_test database.');
  const owner=pool(process.env.TEST_OWNER_DATABASE_URL), database=pool(process.env.TEST_DATABASE_URL), workerDb=pool(process.env.TEST_WORKER_DATABASE_URL);
  const first=await seedOrganization(owner,`Test ${randomUUID()}`),other=await seedOrganization(owner,`Other ${randomUUID()}`);
  const store=new PgStore(database),auth=new Auth(database),engine=new WorkerEngine(workerDb,{leaseMs:1500,pollMs:20});
  const server=createApp({database,store,auth});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
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
