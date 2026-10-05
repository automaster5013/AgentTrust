import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {checkConnectorContract,readConnectorJson,parseConnectorFiles,connectorFileLimit} from '../scripts/check-connector-contract.mjs';
import {buildHttpsRequest,httpsEvidence} from '../packages/evaluator/https-adapter.js';
const request={caseId:'synthetic-case',input:'private-input-canary',agentVersionId:'synthetic-version'};
const response={output:'private-response-canary',toolEvents:[]};
async function fixture(t){const dir=await mkdtemp(join(process.cwd(),'.local','connector-contract-test-'));t.after(async()=>{assert.ok(resolve(dir).startsWith(resolve(process.cwd(),'.local')+sep));await rm(dir,{recursive:true,force:true});});return dir;}
const cli=(args,extra=[])=>spawnSync(process.execPath,[...extra,'scripts/check-connector-contract.mjs',...args],{encoding:'utf8',windowsHide:true,timeout:10000});
test('connector request construction excludes dataset mocks, policy and rules and rejects invalid requests before DNS',async()=>{
 const endpoint='https://example.com/evaluate',snapshot={agent:{id:request.agentVersionId,connectorId:'synthetic',endpointHash:createHash('sha256').update(endpoint).digest('hex')},policy:{private:'policy-canary'},dataset:{private:'dataset-canary'}},sample={id:request.caseId,input:request.input,mock:response,rules:[{private:'rule-canary'}]};
 assert.deepEqual(buildHttpsRequest(snapshot,sample),request);let dns=0,network=0;
 const options={organizationId:'synthetic-org',configuration:JSON.stringify({'synthetic-org':{synthetic:endpoint}}),resolver:async()=>{dns++;return [];},transport:()=>{network++;}};
 for(const changes of [{id:''},{input:'\u0000'},{input:'x'.repeat(10001)}])await assert.rejects(httpsEvidence(snapshot,{...sample,...changes},options));assert.equal(dns,0);assert.equal(network,0);
});
test('offline contract rejects unsupported request fields, incomplete evidence and unsafe nested values',()=>{
 const passed=checkConnectorContract(request,response);assert.equal(passed.status,'passed');assert.equal(passed.deploymentAllowed,false);assert.equal(passed.releaseGateEvaluated,false);assert.equal(passed.networkRequestsMade,0);
 for(const changes of [{endpoint:'https://private.example'},{caseId:''},{agentVersionId:'x'.repeat(81)},{input:'\ud800'}])assert.throws(()=>checkConnectorContract({...request,...changes},response));
 for(const evidence of [{},{output:'x'}, {...response,extra:'private-extra-canary'},{output:'x',toolEvents:[{name:'lookup',args:{amount:Infinity}}]},{output:'x'.repeat(10001),toolEvents:[]}])assert.throws(()=>checkConnectorContract(request,evidence));
});
test('connector file reads enforce the byte limit, regular files and strict UTF-8',async t=>{
 const dir=await fixture(t),path=join(dir,'input.json');await writeFile(path,JSON.stringify(request));assert.deepEqual((await readConnectorJson(path)).value,request);
 await writeFile(path,' '.repeat(connectorFileLimit-2)+'{}');assert.equal((await readConnectorJson(path)).bytes,connectorFileLimit);
 for(const bytes of [Buffer.alloc(0),Buffer.alloc(connectorFileLimit+1,32),Buffer.from([0xc3,0x28]),Buffer.from('{"x":1e999}')]){await writeFile(path,bytes);await assert.rejects(readConnectorJson(path));}await assert.rejects(readConnectorJson(dir));
});
test('connector option parsing rejects partial, duplicate and unknown file options',()=>{
 assert.equal(parseConnectorFiles([]).syntheticExample,true);
 assert.deepEqual(parseConnectorFiles(['--response','response.json','--request','request.json']),{response:'response.json',request:'request.json',syntheticExample:false});
 for(const args of [['--request','private-path-canary'],['--request'],['--request','a','--request','b'],['--unknown','private-path-canary'],['--request','--response','--response','b']])assert.throws(()=>parseConnectorFiles(args));
});
test('actual connector CLI redacts valid content, invalid bodies and paths while identifying the failed stage',async t=>{
 const dir=await fixture(t),a=join(dir,'private-path-canary-request.json'),b=join(dir,'private-path-canary-response.json');await writeFile(a,JSON.stringify(request));await writeFile(b,JSON.stringify(response));
 const args=['--request',a,'--response',b];let result=cli(args),report=JSON.parse(result.stdout);assert.equal(result.status,0);assert.equal(report.syntheticExample,false);assert.equal(report.status,'passed');assert.ok(!result.stdout.includes('canary'));assert.equal(result.stderr,'');
 await writeFile(b,JSON.stringify({output:'private-response-canary'}));result=cli(args);assert.equal(result.status,1);report=JSON.parse(result.stdout);assert.equal(report.failedStage,'response');assert.ok(!result.stdout.includes('canary'));assert.equal(result.stderr,'');
 await writeFile(a,JSON.stringify({...request,endpoint:'private-endpoint-canary'}));result=cli(args);assert.equal(result.status,1);assert.equal(JSON.parse(result.stdout).failedStage,'request');assert.ok(!result.stdout.includes('canary'));assert.equal(result.stderr,'');
 result=cli(['--request','private-path-canary']);assert.equal(result.status,1);assert.equal(JSON.parse(result.stdout).failedStage,'inputs');assert.ok(!result.stdout.includes('canary'));
});
test('actual synthetic connector example passes with network entry points disabled and never grants a release',async t=>{
 const dir=await fixture(t),guard=join(dir,'network-guard.mjs');await writeFile(guard,"import https from 'node:https';import dns from 'node:dns';import {syncBuiltinESMExports} from 'node:module';https.request=()=>{throw Error('Network prohibited');};dns.promises.lookup=()=>{throw Error('DNS prohibited');};globalThis.fetch=()=>{throw Error('Network prohibited');};syncBuiltinESMExports();");
 const result=cli([],['--import',pathToFileURL(guard).href]);assert.equal(result.status,0);const report=JSON.parse(result.stdout);assert.equal(report.status,'passed');assert.equal(report.syntheticExample,true);assert.equal(report.networkRequestsMade,0);assert.equal(report.releaseGateEvaluated,false);assert.equal(report.deploymentAllowed,false);assert.equal(result.stderr,'');
});
