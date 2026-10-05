import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {checkAcceptanceProfile,parseAcceptanceCheckFiles} from '../scripts/check-acceptance-profile.mjs';
const cliPath=fileURLToPath(new URL('../scripts/check-acceptance-profile.mjs',import.meta.url));
async function profile(){return JSON.parse(await readFile(new URL('../examples/connector-contract/acceptance-profile.json',import.meta.url),'utf8'));}
async function fixture(t){const dir=await mkdtemp(join(process.cwd(),'.local','acceptance-check-test-'));t.after(async()=>{assert.ok(resolve(dir).startsWith(resolve(process.cwd(),'.local')+sep));await rm(dir,{recursive:true,force:true});});return dir;}
test('offline acceptance check summarizes all synthetic outcomes without echoing private criteria',async()=>{
 const p=await profile();p.dataset.name='private-label-canary';p.policy.name='private-policy-canary';const before=JSON.stringify(p),r=checkAcceptanceProfile(p);assert.equal(r.status,'passed');assert.equal(r.cases,2);assert.equal(r.rules,5);assert.equal(r.expectedOutcomes.length,5);assert.equal(r.manualApprovalRequired,true);assert.equal(r.businessDataWrites,false);assert.equal(r.networkRequestsMade,0);assert.equal(r.releaseGateEvaluated,false);assert.equal(r.deploymentAllowed,false);assert.ok(!JSON.stringify(r).includes('canary'));assert.equal(JSON.stringify(p),before);
});
test('offline profile check rejects weakened policies or synthetic criteria that do not exercise acceptance failures',async()=>{
 for(const change of [p=>p.synthetic=false,p=>p.policy.requiresManualApproval=false,p=>p.policy.minimumPassRate=0.5,p=>p.dataset.cases[0].mock.output='Invalid compliant response']){const p=await profile();change(p);assert.throws(()=>checkAcceptanceProfile(p));}
});
test('actual offline acceptance checker completes with network APIs disabled and no local credential loading',async t=>{
 const dir=await fixture(t),guard=join(dir,'guard.mjs');await writeFile(guard,"import https from 'node:https';import dns from 'node:dns';import fs from 'node:fs/promises';import {syncBuiltinESMExports} from 'node:module';https.request=()=>{throw Error('Network prohibited');};dns.promises.lookup=()=>{throw Error('DNS prohibited');};globalThis.fetch=()=>{throw Error('Network prohibited');};const original=fs.readFile;fs.readFile=async(path,...args)=>{if(String(path).includes('credentials.json')||String(path).includes('.env'))throw Error('Credential reads prohibited');return original(path,...args);};syncBuiltinESMExports();");const r=spawnSync(process.execPath,['--import',pathToFileURL(guard).href,cliPath],{encoding:'utf8',windowsHide:true,timeout:10000});assert.equal(r.status,0);const summary=JSON.parse(r.stdout);assert.equal(summary.syntheticExample,true);assert.equal(summary.networkRequestsMade,0);assert.equal(summary.businessDataWrites,false);assert.equal(r.stderr,'');
});
test('actual offline profile checker rejects malformed input with bounded output and strict options',async t=>{
 const dir=await fixture(t),file=join(dir,'private-path-canary.json'),p=await profile();p.policy.name='private-policy-canary';p.policy.minimumPassRate=0.5;await writeFile(file,JSON.stringify(p));let r=spawnSync(process.execPath,[cliPath,'--profile',file],{encoding:'utf8',windowsHide:true,timeout:10000});assert.equal(r.status,1);assert.equal(JSON.parse(r.stdout).failedStage,'profile');assert.ok(!r.stdout.includes('canary'));assert.equal(r.stderr,'');for(const args of [['--profile'],['--unknown','a'],['--profile','a','--profile','b']])assert.throws(()=>parseAcceptanceCheckFiles(args));assert.equal(parseAcceptanceCheckFiles([]).syntheticExample,true);assert.equal(parseAcceptanceCheckFiles(['--profile',file]).syntheticExample,false);
});
