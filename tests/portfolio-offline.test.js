import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {demonstrateOffline,loadOfflineExamples,parseOfflineOptions,formatOfflineReport} from '../scripts/portfolio-offline.mjs';

test('offline reviewer demonstration uses real evaluation and comparison without granting deployment or mutating examples',async()=>{
  const input=await loadOfflineExamples(),before=JSON.stringify(input),report=demonstrateOffline(input);
  assert.equal(report.status,'passed');assert.equal(report.evaluations.length,5);assert.equal(report.recordedEvaluations.length,4);assert.equal(report.comparisons.length,3);
  assert.deepEqual(report.evaluations.map(r=>r.evaluationDecision),['pass','block','block','inconclusive','inconclusive']);
  assert.deepEqual(report.comparisons.map(r=>r.comparable),[true,true,false]);
  assert.equal(report.comparisons[1].regressions,1);assert.equal(report.networkRequestsMade,0);
  for(const field of ['businessDataWrites','credentialsRead','recordedSourceVerified','releaseGateEvaluated','administratorApprovalPerformed','deploymentAllowed'])assert.equal(report[field],false);
  assert.equal(JSON.stringify(input),before);assert.ok(formatOfflineReport(report).includes('관리자 승인은 별도'));
});

test('offline reviewer demonstration rejects weakened criteria and incorrectly bound recorded requests',async()=>{
  const original=await loadOfflineExamples();
  for(const change of [p=>p.profile.policy.requiresManualApproval=false,p=>p.policy.requiresManualApproval=false,p=>p.trace.entries[0].request.input='different-input']){
    const input=structuredClone(original);change(input);assert.throws(()=>demonstrateOffline(input));
  }
});

test('offline reviewer output omits input bodies, case identifiers and labels',async()=>{
  const input=await loadOfflineExamples();input.dataset.name='private-name-canary';input.profile.dataset.name='private-name-canary';input.policy.name='private-policy-canary';input.trace.entries[1].request.caseId=input.dataset.cases[1].id='private-case-canary';input.trace.entries[1].request.input=input.dataset.cases[1].input='private-input-canary';
  const report=demonstrateOffline(input);assert.ok(!JSON.stringify(report).includes('canary'));assert.ok(!formatOfflineReport(report).includes('canary'));
});

test('actual offline CLI runs from another directory with network, process launch, credentials and writes prohibited',async t=>{
  const dir=await mkdtemp(join(process.cwd(),'.local','offline-reviewer-test-'));
  t.after(async()=>{assert.ok(resolve(dir).startsWith(resolve(process.cwd(),'.local')+sep));await rm(dir,{recursive:true,force:true});});
  const guard=join(dir,'guard.mjs');
  await writeFile(guard,"import fs from 'node:fs/promises';import http from 'node:http';import https from 'node:https';import net from 'node:net';import dns from 'node:dns';import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';const denied=()=>{throw Error('Operation prohibited');};globalThis.fetch=denied;http.request=denied;https.request=denied;net.connect=denied;dns.lookup=denied;dns.promises.lookup=denied;for(const n of ['exec','execFile','spawn','execSync','execFileSync','spawnSync'])cp[n]=denied;for(const n of ['writeFile','appendFile','mkdir','rm','unlink','rename'])fs[n]=denied;const open=fs.open;fs.open=async(p,f,...args)=>{if(f!=='r'||String(p).includes('.local')||String(p).includes('.env'))throw Error('Private read prohibited');return open(p,f,...args);};syncBuiltinESMExports();");
  const result=spawnSync(process.execPath,['--import',pathToFileURL(guard).href,resolve('scripts/portfolio-offline.mjs'),'--json'],{cwd:dir,encoding:'utf8',windowsHide:true,timeout:10000});
  assert.equal(result.status,0,result.stderr);assert.equal(result.stderr,'');const report=JSON.parse(result.stdout);assert.equal(report.status,'passed');assert.equal(report.deploymentAllowed,false);assert.equal(report.credentialsRead,false);
});

test('actual offline CLI has strict options and a bounded failure without echoing unknown arguments',()=>{
  for(const args of [['--json','--json'],['--profile','private-path-canary'],['--unknown'],['--json=true']]){
    assert.throws(()=>parseOfflineOptions(args));const result=spawnSync(process.execPath,['scripts/portfolio-offline.mjs',...args],{encoding:'utf8',windowsHide:true,timeout:10000});
    assert.equal(result.status,1);assert.equal(result.stderr,'');assert.ok(!result.stdout.includes('canary'));const report=JSON.parse(result.stdout);assert.equal(report.status,'blocked');assert.equal(report.failedStage,'inputs');assert.equal(report.deploymentAllowed,false);
  }
  assert.deepEqual(parseOfflineOptions([]),{json:false});assert.deepEqual(parseOfflineOptions(['--json']),{json:true});
});
