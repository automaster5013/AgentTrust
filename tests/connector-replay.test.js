import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {evaluateRecordedConnector} from '../packages/evaluator/connector-replay.js';
import {parseReplayFiles} from '../scripts/replay-connector-evidence.mjs';
async function input(){return Object.fromEntries(await Promise.all(['dataset','policy','trace'].map(async name=>[name,JSON.parse(await readFile(new URL('../examples/connector-contract/'+name+'.json',import.meta.url),'utf8'))])));}
async function fixture(t){const dir=await mkdtemp(join(process.cwd(),'.local','connector-replay-test-'));t.after(async()=>{assert.ok(resolve(dir).startsWith(resolve(process.cwd(),'.local')+sep));await rm(dir,{recursive:true,force:true});});return dir;}
const cli=(args,extra=[])=>spawnSync(process.execPath,[...extra,'scripts/replay-connector-evidence.mjs',...args],{encoding:'utf8',windowsHide:true,timeout:10000});
test('recorded connector evaluation uses supplied evidence, preserves its inputs and never grants a release',async()=>{
 const data=await input(),before=JSON.stringify(data);let r=evaluateRecordedConnector(data);assert.equal(r.evaluationDecision,'pass');assert.equal(r.summary.rules,5);assert.equal(r.deploymentAllowed,false);assert.equal(r.manualApprovalRequired,true);assert.equal(r.recordedSourceVerified,false);assert.equal(r.releaseGateEvaluated,false);assert.equal(r.networkRequestsMade,0);assert.equal(JSON.stringify(data),before);
 data.policy={name:'Synthetic automatic criteria',minimumPassRate:1};r=evaluateRecordedConnector(data);assert.equal(r.evaluationPassed,true);assert.equal(r.manualApprovalRequired,false);assert.equal(r.deploymentAllowed,false);
 data.dataset.cases[0].mock.output='Invalid seeded fallback';assert.equal(evaluateRecordedConnector(data).evaluationDecision,'pass');data.trace.entries[0].response.output='Recorded regression';assert.equal(evaluateRecordedConnector(data).evaluationDecision,'block');
});
test('unknown, duplicate or mismatched recorded requests cannot be attributed to valid evaluation inputs',async()=>{
 for(const kind of ['unknown','duplicate','input','agent','extra']){
  const data=await input();if(kind==='unknown')data.trace.entries[0].request.caseId='unknown-case';if(kind==='duplicate')data.trace.entries.push(structuredClone(data.trace.entries[0]));if(kind==='input')data.trace.entries[0].request.input='Different synthetic request';if(kind==='agent')data.trace.entries[0].request.agentVersionId='different-version';if(kind==='extra')data.trace.entries[0].request.secret='private-secret-canary';assert.throws(()=>evaluateRecordedConnector(data));
 }
});
test('missing or malformed recorded evidence is inconclusive without any dataset-mock fallback',async()=>{
 for(const kind of ['empty','missing','malformed','extra']){const data=await input();if(kind==='empty')data.trace.entries=[];if(kind==='missing')delete data.trace.entries[0].response;if(kind==='malformed')data.trace.entries[0].response={};if(kind==='extra')data.trace.entries[0].response.private='private-response-canary';const r=evaluateRecordedConnector(data);assert.equal(r.evaluationDecision,'inconclusive');assert.equal(r.state,'failed');assert.equal(r.deploymentAllowed,false);assert.equal(r.caseResults[0].adapterFailed,true);assert.ok(!JSON.stringify(r).includes('canary'));}
});
test('recorded tool policies, argument schemas, structured output and optional-rule thresholds use production evaluation rules',async()=>{
 for(const kind of ['tool','args','json']){const data=await input();if(kind==='tool')data.trace.entries[0].response.toolEvents[0].name='transfer_funds';if(kind==='args')data.trace.entries[0].response.toolEvents[0].args.orderId=22;if(kind==='json')data.trace.entries[1].response.output='{"status":"approved"}';assert.equal(evaluateRecordedConnector(data).evaluationDecision,'block');}
 const data=await input();data.dataset.cases[0].rules.push({id:'optional-rule',type:'not_contains',value:'refund',required:false});data.policy.minimumPassRate=0.9;assert.equal(evaluateRecordedConnector(data).evaluationDecision,'block');data.policy.minimumPassRate=0.8;assert.equal(evaluateRecordedConnector(data).evaluationDecision,'pass');
});
test('recorded evaluation summaries redact case IDs, input, output, rule text and dataset labels',async()=>{
 const data=await input();data.dataset.name='private-label-canary';const c=data.dataset.cases[0],e=data.trace.entries[0];c.id=e.request.caseId='private-case-canary';c.input=e.request.input='private-input-canary';c.rules[0].id='private-rule-canary';e.response.output+=' private-output-canary';const r=evaluateRecordedConnector(data);assert.equal(r.evaluationDecision,'pass');assert.ok(!JSON.stringify(r).includes('canary'));assert.equal(r.caseResults[0].caseNumber,1);
});
test('actual recorded CLI distinguishes pass, failed evaluation and invalid input without exposing private bodies',async t=>{
 const dir=await fixture(t),data=await input(),args=[];async function save(){for(const name of ['dataset','policy','trace'])await writeFile(join(dir,name+'.json'),JSON.stringify(data[name]));}
 for(const name of ['dataset','policy','trace'])args.push('--'+name,join(dir,name+'.json'));await save();let result=cli(args);assert.equal(result.status,0);assert.equal(JSON.parse(result.stdout).syntheticExample,false);assert.equal(result.stderr,'');
 data.trace.entries[0].response.output='private-response-canary';await save();result=cli(args);assert.equal(result.status,1);assert.equal(JSON.parse(result.stdout).evaluationDecision,'block');assert.ok(!result.stdout.includes('canary'));
 delete data.trace.entries[0].response;await save();result=cli(args);assert.equal(result.status,1);assert.equal(JSON.parse(result.stdout).evaluationDecision,'inconclusive');
 data.trace.entries[0].request.input='private-request-canary';await save();result=cli(args);assert.equal(result.status,2);assert.equal(JSON.parse(result.stdout).failedStage,'evaluation');assert.ok(!result.stdout.includes('canary'));assert.equal(result.stderr,'');
});
test('actual recorded example completes while network APIs are disabled',async t=>{
 const dir=await fixture(t),guard=join(dir,'guard.mjs');await writeFile(guard,"import https from 'node:https';import dns from 'node:dns';import {syncBuiltinESMExports} from 'node:module';https.request=()=>{throw Error('Network prohibited');};dns.promises.lookup=()=>{throw Error('DNS prohibited');};globalThis.fetch=()=>{throw Error('Network prohibited');};syncBuiltinESMExports();");const result=cli([],['--import',pathToFileURL(guard).href]);assert.equal(result.status,0);const r=JSON.parse(result.stdout);assert.equal(r.networkRequestsMade,0);assert.equal(r.deploymentAllowed,false);assert.equal(r.syntheticExample,true);assert.equal(result.stderr,'');
});
test('recorded options and trace size reject ambiguous or unbounded inputs',async()=>{
 assert.equal(parseReplayFiles([]).syntheticExample,true);for(const args of [['--trace','private-file-canary'],['--dataset'],['--dataset','a','--policy','b','--trace','c','--trace','d'],['--unknown','x']])assert.throws(()=>parseReplayFiles(args));const data=await input();data.trace.entries=Array.from({length:101},()=>data.trace.entries[0]);assert.throws(()=>evaluateRecordedConnector(data));
});
