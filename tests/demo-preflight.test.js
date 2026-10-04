import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {demoPreflight,verifyDemoCredentials,verifyDemoServices} from '../scripts/demo-preflight.mjs';

test('demo readiness stops at the first blocked stage and excludes raw errors',async()=>{
  const visited=[],names=['inputs','local-files','signing-key-pair','compose-services','api-health'];
  const stages=Object.fromEntries(names.map(name=>[name,async()=>{visited.push(name);if(name==='compose-services')throw Error('private-canary');}]));
  const report=await demoPreflight(stages);assert.equal(report.status,'blocked');assert.equal(report.failedCheck,'compose-services');assert.equal(report.checks.at(-1).status,'not_run');assert.equal(visited.length,4);assert.ok(!JSON.stringify(report).includes('private-canary'));
  assert.equal((await demoPreflight(Object.fromEntries(names.map(n=>[n,async()=>{}])))).status,'passed');
});
test('demo readiness requires distinct seeded organizations and role keys',()=>{
  let id=0,key=0;const config={organizations:Array.from({length:2},()=>({organizationId:'00000000-0000-0000-0000-'+(++id).toString(16).padStart(12,'0'),projectId:'00000000-0000-0000-0000-'+(++id).toString(16).padStart(12,'0'),credentials:['admin','editor','viewer'].map(role=>({role,token:(++key).toString(16).padStart(64,'0')}))}))};
  verifyDemoCredentials(config);config.organizations[1].credentials[0].token=config.organizations[0].credentials[0].token;assert.throws(()=>verifyDemoCredentials(config));
});
test('demo readiness rejects unavailable worker and API port mismatches',()=>{
  const rows=['api','db','worker'].map(Service=>({Service,State:'running',Health:Service==='worker'?'':'healthy',Publishers:Service==='api'?[{URL:'127.0.0.1',PublishedPort:4310,TargetPort:4310}]:[]}));
  verifyDemoServices(rows,'4310');assert.throws(()=>verifyDemoServices(rows,'4311'));rows[2].State='exited';assert.throws(()=>verifyDemoServices(rows,'4310'));
});
test('actual CLI rejects malformed secret-bearing PORT before accessing Docker or local files',()=>{
  const canary='private-port-canary';const result=spawnSync(process.execPath,['scripts/demo-preflight.mjs'],{encoding:'utf8',timeout:10000,env:{...process.env,PORT:canary}});assert.equal(result.status,1);const report=JSON.parse(result.stdout);assert.equal(report.failedCheck,'inputs');assert.ok(!result.stdout.includes(canary));assert.equal(result.stderr,'');
});

test('actual demo readiness refuses API-incompatible ports at the inputs stage',()=>{
 for(const port of ['80','1023','65536','04310']){
  const result=spawnSync(process.execPath,['scripts/demo-preflight.mjs'],{encoding:'utf8',timeout:10000,windowsHide:true,env:{...process.env,PORT:port}});
  assert.equal(result.status,1);const report=JSON.parse(result.stdout);assert.equal(report.failedCheck,'inputs');assert.ok(report.checks.slice(1).every(c=>c.status==='not_run'));
 }
});
