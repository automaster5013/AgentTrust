import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMetadataBenchmarkArgs,summarizeDurations,runMetadataBenchmark} from '../scripts/metadata-benchmark-scenario.mjs';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const exec=promisify(execFile);
test('metadata sample arguments are bounded and unambiguous',()=>{
 assert.deepEqual(parseMetadataBenchmarkArgs([]),{samples:20,concurrency:1,organizationIndex:0});assert.deepEqual(parseMetadataBenchmarkArgs(['--samples','100']),{samples:100,concurrency:1,organizationIndex:0});
 assert.deepEqual(parseMetadataBenchmarkArgs(['--concurrency','8','--samples','7']),{samples:7,concurrency:8,organizationIndex:0});
 for(const args of [['--samples','0'],['--samples','101'],['--samples','01'],['--samples','1\n'],['--samples'],['--unknown','5'],['--samples','5','--samples','5']])assert.throws(()=>parseMetadataBenchmarkArgs(args));
 for(const args of [['--concurrency','0'],['--concurrency','9'],['--concurrency','01'],['--concurrency'],['--concurrency','2','--concurrency','3']])assert.throws(()=>parseMetadataBenchmarkArgs(args));
});
test('metadata percentiles use sorted nearest ranks without mutating samples',()=>{
 const values=[10,2,7,1,5];assert.deepEqual(summarizeDurations(values),{samples:5,minMs:1,p50Ms:5,p95Ms:10,maxMs:10});assert.deepEqual(values,[10,2,7,1,5]);
 for(const v of [[],[NaN],[-1],[Infinity]])assert.throws(()=>summarizeDurations(v));
});
test('metadata benchmark excludes warmup and follows only fixed read routes',async()=>{
 const calls=[];let clock=0;const report=await runMetadataBenchmark({samples:3,call:async path=>calls.push(path),now:()=>clock++});
 assert.equal(report.requests,20);assert.equal(calls.length,20);assert.equal(report.results.length,4);
 assert.ok(report.results.every(x=>x.samples===3&&x.p95Ms===1));assert.ok(calls.every(x=>['/v1/me','/v1/catalog','/v1/runs?limit=25','/v1/usage'].includes(x)));assert.equal(report.readOnlyMetadata,true);
});
test('failed or invalid timing samples cannot produce a successful benchmark',async()=>{
 let calls=0;await assert.rejects(runMetadataBenchmark({samples:101,call:async()=>calls++}));assert.equal(calls,0);
 await assert.rejects(runMetadataBenchmark({call:async()=>{throw Error('Synthetic read failed');}}));
 let time=0;await assert.rejects(runMetadataBenchmark({samples:1,call:async()=>{},now:()=>time--}),/timing/);
});

test('parallel metadata waves respect the bound and drain failures before returning',async()=>{
 let active=0,peak=0,calls=0;
 const report=await runMetadataBenchmark({samples:7,concurrency:3,call:async()=>{
  calls++;active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,5));active--;
 }});
 assert.equal(calls,36);assert.equal(active,0);assert.equal(peak,3);assert.equal(report.maximumInFlightRequests,3);
 assert.equal(report.concurrency,3);assert.equal(report.oneViewerSession,true);assert.equal(report.requests,36);
 assert.ok(report.results.every(result=>result.samples===7));
 calls=0;active=0;let settled=0;
 await assert.rejects(runMetadataBenchmark({samples:7,concurrency:3,call:async()=>{
  const index=++calls;if(index<=2)return;
  active++;
  try{if(index===3)throw Error('Synthetic measured failure');await new Promise(r=>setTimeout(r,20));}
  finally{active--;settled++;}
 }}),/Synthetic measured failure/);
 assert.equal(calls,5);assert.equal(active,0);assert.equal(settled,3);
 for(const concurrency of [0,9,1.5,NaN]){
  let attempted=0;await assert.rejects(runMetadataBenchmark({concurrency,call:async()=>attempted++}));assert.equal(attempted,0);
 }
});

test('actual metadata command measures fixed viewer reads and cleans sessions on success and failure',async t=>{
 const repository=process.cwd(),dir=await mkdtemp(join(repository,'.local','metadata-test-'));
 await mkdir(join(dir,'.local'));
 const secret='synthetic-metadata-key-canary',session='synthetic-metadata-cookie-canary';
 await writeFile(join(dir,'.local','credentials.json'),JSON.stringify({organizations:[{organizationId:'00000000-0000-4000-8000-000000000000',projectId:'10000000-0000-4000-8000-000000000000',credentials:[{role:'viewer',token:secret}]}]}));
 let failure='',calls=[],logout=0,parallel=false,active=0,peak=0,identityReads=0,failMeasured=false,logoutWithPending=false;
 const server=createServer(async(req,res)=>{
  calls.push([req.method,req.url]);res.setHeader('Content-Type','application/json');
  if(req.url==='/v1/auth/login'){
   let body='';for await(const chunk of req)body+=chunk;
   if(JSON.parse(body).accessKey!==secret){res.writeHead(401);res.end('{}');return;}
   res.setHeader('Set-Cookie',session+'=value; HttpOnly');res.end('{}');return;
  }
  if(req.headers.cookie!==session+'=value'){res.writeHead(401);res.end('{}');return;}
  if(req.url==='/v1/auth/logout'){logout++;if(active)logoutWithPending=true;}
  if(req.method==='GET'&&parallel){
   active++;peak=Math.max(peak,active);
   if(req.url==='/v1/me')identityReads++;
   try{
    if(failMeasured&&req.url==='/v1/me'&&identityReads===4){res.writeHead(500);res.end('{}');return;}
    await new Promise(r=>setTimeout(r,30));
   }finally{active--;}
  }
  if(req.url===failure){res.writeHead(500);res.end('{}');return;}
  res.end(JSON.stringify(req.url==='/v1/me'?{role:'viewer',organizationId:'00000000-0000-4000-8000-000000000000',projectId:'10000000-0000-4000-8000-000000000000'}:{}));
 });server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));assert.ok(resolve(dir).startsWith(resolve(repository,'.local')+requireSeparator()));await rm(dir,{recursive:true,force:true});});
 const options={cwd:dir,windowsHide:true,env:{...process.env,PORT:String(server.address().port)}};
 const run=async args=>{try{return{...await exec(process.execPath,[join(repository,'scripts','metadata-benchmark.mjs'),...args],options),code:0};}catch(e){return e;}};
 const inspect=async result=>{
  const output=JSON.parse(result.stdout),report=await readFile(join(dir,output.reportPath),'utf8');
  for(const value of [secret,session]){assert.ok(!result.stdout.includes(value));assert.ok(!result.stderr.includes(value));assert.ok(!report.includes(value));}
  return {output,report:JSON.parse(report)};
 };
 let result=await run(['--samples','1']),checked=await inspect(result);
 assert.equal(result.code,0);assert.equal(checked.output.status,'passed');assert.equal(checked.report.requests,12);assert.equal(logout,1);
 assert.ok(calls.every(([method,path])=>method==='GET'||['/v1/auth/login','/v1/auth/logout'].includes(path)));
 assert.deepEqual([...new Set(calls.filter(([m])=>m==='GET').map(([,p])=>p))],['/v1/me','/v1/catalog','/v1/runs?limit=25','/v1/usage']);
 failure='/v1/catalog';result=await run(['--samples','1']);checked=await inspect(result);
 assert.equal(result.code,1);assert.equal(checked.output.status,'blocked');assert.equal(checked.report.completed,false);assert.equal(checked.report.sessionLoggedOut,true);assert.equal(logout,2);assert.equal(checked.output.results,undefined);
 failure='/v1/auth/logout';result=await run(['--samples','1']);checked=await inspect(result);
 assert.equal(result.code,1);assert.equal(checked.report.sessionLoggedOut,false);assert.equal(checked.output.status,'blocked');
 const previousCalls=calls.length;result=await run(['--samples','101']);checked=await inspect(result);assert.equal(result.code,1);assert.equal(calls.length,previousCalls);assert.equal(checked.report.completed,false);
 failure='';parallel=true;identityReads=0;peak=0;
 result=await run(['--samples','7','--concurrency','3']);checked=await inspect(result);
 assert.equal(result.code,0);assert.equal(checked.report.requests,36);assert.equal(checked.report.maximumInFlightRequests,3);assert.equal(peak,3);assert.equal(active,0);assert.equal(logoutWithPending,false);
 failMeasured=true;identityReads=0;const failedStart=calls.length;
 result=await run(['--concurrency','3','--samples','7']);checked=await inspect(result);
 assert.equal(result.code,1);assert.equal(checked.report.completed,false);assert.equal(checked.report.sessionLoggedOut,true);
 assert.equal(active,0);assert.equal(logoutWithPending,false);assert.equal(calls.slice(failedStart).filter(([method])=>method==='GET').length,6);
 const invalidStart=calls.length;result=await run(['--concurrency','9']);checked=await inspect(result);
 assert.equal(result.code,1);assert.equal(calls.length,invalidStart);assert.equal(checked.report.completed,false);
});

function requireSeparator(){return process.platform==='win32'?'\\':'/';}


test('metadata organization selector is canonical, bounded and compatible with measurement options',()=>{
 assert.deepEqual(parseMetadataBenchmarkArgs(['--organization-index','1','--samples','5','--concurrency','4']),{samples:5,concurrency:4,organizationIndex:1});
 for(const args of [['--organization-index','01'],['--organization-index','-1'],['--organization-index','100'],['--organization-index'],['--organization-index','1','--organization-index','0']])assert.throws(()=>parseMetadataBenchmarkArgs(args));
});

async function scopedMetadataFixture(t){
 const repository=process.cwd(),dir=await mkdtemp(join(repository,'.local','metadata-scoped-test-'));await mkdir(join(dir,'.local'));
 const organizations=[0,1].map(i=>({organizationId:`00000000-0000-4000-8000-00000000000${i}`,projectId:`10000000-0000-4000-8000-00000000000${i}`,credentials:[{role:'viewer',token:`synthetic-metadata-scope-${i}-canary`}]}));await writeFile(join(dir,'.local','credentials.json'),JSON.stringify({organizations}));
 t.after(async()=>{assert.ok(resolve(dir).startsWith(resolve(repository,'.local')+requireSeparator()));await rm(dir,{recursive:true,force:true});});return {repository,dir,organizations};
}

test('actual metadata command binds selected viewer scope before measurement and logs out wrong scopes',async t=>{
 const f=await scopedMetadataFixture(t),selected=f.organizations[1],session='synthetic-scoped-metadata-cookie';let changes={},reads=0,logins=0,logouts=0;
 const server=createServer(async(req,res)=>{res.setHeader('Content-Type','application/json');assert.equal(req.headers['x-agenttrust-project'],selected.projectId);
  if(req.url==='/v1/auth/login'){let raw='';for await(const chunk of req)raw+=chunk;assert.equal(JSON.parse(raw).accessKey,selected.credentials[0].token);logins++;res.setHeader('Set-Cookie',session+'=value; HttpOnly');res.end('{}');return;}
  assert.equal(req.headers.cookie,session+'=value');if(req.url==='/v1/auth/logout'){logouts++;res.end('{}');return;}assert.equal(req.method,'GET');if(req.url==='/v1/me'){res.end(JSON.stringify({role:'viewer',organizationId:selected.organizationId,projectId:selected.projectId,...changes}));return;}reads++;res.end('{}');
 });server.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
 const run=async()=>{try{return {...await exec(process.execPath,[join(f.repository,'scripts','metadata-benchmark.mjs'),'--organization-index','1','--samples','1'],{cwd:f.dir,windowsHide:true,timeout:15000,env:{...process.env,PORT:String(server.address().port)}}),code:0};}catch(e){return e;}};
 for(const mismatch of [{organizationId:f.organizations[0].organizationId},{projectId:f.organizations[0].projectId},{role:'admin'}]){changes=mismatch;const result=await run();assert.equal(result.code,1);const summary=JSON.parse(result.stdout),raw=await readFile(join(f.dir,summary.reportPath),'utf8'),report=JSON.parse(raw);assert.equal(report.organizationIndex,1);assert.equal(report.organizationId,selected.organizationId);assert.equal(report.projectId,selected.projectId);assert.equal(report.sessionScopeVerified,false);assert.equal(report.sessionLoggedOut,true);assert.equal(summary.results,undefined);for(const o of f.organizations)assert.ok(!raw.includes(o.credentials[0].token));assert.ok(!raw.includes(session));}assert.equal(reads,0);
 changes={};const result=await run(),summary=JSON.parse(result.stdout),report=JSON.parse(await readFile(join(f.dir,summary.reportPath),'utf8'));assert.equal(result.code,0);assert.equal(report.sessionScopeVerified,true);assert.equal(report.organizationIndex,1);assert.equal(report.requests,12);assert.equal(reads,9);assert.equal(logins,4);assert.equal(logouts,4);
});

test('actual metadata selector refuses nonexistent and invalid organizations before login',async t=>{
 const f=await scopedMetadataFixture(t);let calls=0;const server=createServer((req,res)=>{calls++;res.end('{}');});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
 for(const args of [['--organization-index','2'],['--organization-index','01'],['--organization-index'],['--organization-index','1','--organization-index','0']]){let result;try{result=await exec(process.execPath,[join(f.repository,'scripts','metadata-benchmark.mjs'),...args],{cwd:f.dir,windowsHide:true,timeout:15000,env:{...process.env,PORT:String(server.address().port)}});}catch(e){result=e;}assert.equal(result.code,1);const summary=JSON.parse(result.stdout);assert.equal(summary.status,'blocked');assert.equal(summary.sessionLoggedOut,true);}assert.equal(calls,0);
});
