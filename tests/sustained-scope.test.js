import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
const exec=promisify(execFile);
test('sustained organization selector rejects malformed or duplicate arguments before opening a session',async()=>{
 for(const args of [['--organization-index','-1'],['--organization-index','01'],['--organization-index','100'],['--organization-index','not-a-number'],['--organization-index'],['--organization-index','0','--organization-index','1']]){
  let result;try{result=await exec(process.execPath,[join(process.cwd(),'scripts','sustained-smoke.mjs'),...args],{windowsHide:true,env:{...process.env,PORT:'4311'}});}catch(error){result=error;}
  assert.equal(result.code,2);assert.equal(result.stdout,'');assert.match(result.stderr,/organization-index 0\.\.99/);
 }
});
test('selected sustained organization verifies session scope before catalog or evaluation and logs out mismatches',async t=>{
 const repository=process.cwd(),dir=await mkdtemp(join(repository,'.local','sustained-scope-test-'));
 await mkdir(join(dir,'.local','receipt-signing'),{recursive:true});
 const organizations=[0,1].map(i=>({organizationId:`00000000-0000-4000-8000-00000000000${i}`,projectId:`10000000-0000-4000-8000-00000000000${i}`,credentials:[{role:'admin',token:`synthetic-scope-key-canary-${i}`}]})),selected=organizations[1],session='synthetic-scope-session-canary';
 await writeFile(join(dir,'.local','credentials.json'),JSON.stringify({organizations}));await writeFile(join(dir,'.local','receipt-signing','public.pem'),'synthetic-unused-public-key');
 let mismatch,logins=0,logouts=0,unexpected=0;
 const server=createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json');assert.equal(req.headers['x-agenttrust-project'],selected.projectId);
  if(req.url==='/v1/auth/login'){let raw='';for await(const chunk of req)raw+=chunk;assert.equal(JSON.parse(raw).accessKey,selected.credentials[0].token);logins++;res.setHeader('Set-Cookie',session+'=value; HttpOnly');res.end('{}');return;}
  assert.equal(req.headers.cookie,session+'=value');
  if(req.url==='/v1/me'){res.end(JSON.stringify(mismatch));return;}
  if(req.url==='/v1/auth/logout'){logouts++;res.end('{}');return;}
  unexpected++;res.writeHead(500);res.end('{}');
 });server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));assert.ok(resolve(dir).startsWith(resolve(repository,'.local')+sep));await rm(dir,{recursive:true,force:true});});
 for(const changes of [{organizationId:organizations[0].organizationId},{projectId:organizations[0].projectId},{role:'viewer'}]){
  mismatch={organizationId:selected.organizationId,projectId:selected.projectId,role:'admin',...changes};let result;
  try{result=await exec(process.execPath,[join(repository,'scripts','sustained-smoke.mjs'),'--organization-index','1','--cycles','1','--interval-ms','1000'],{cwd:dir,windowsHide:true,env:{...process.env,PORT:String(server.address().port),OWNER_DATABASE_URL:'postgres://synthetic:synthetic@127.0.0.1:1/unused'}});}catch(error){result=error;}
  assert.equal(result.code,1);const output=JSON.parse(result.stdout.trim().split('\n').at(-1)),raw=await readFile(join(dir,output.reportPath),'utf8'),report=JSON.parse(raw);assert.equal(report.completed,false);assert.equal(report.sessionLoggedOut,true);assert.equal(report.runs.length,0);
  for(const secret of [session,...organizations.map(o=>o.credentials[0].token)]){assert.ok(!result.stdout.includes(secret));assert.ok(!result.stderr.includes(secret));assert.ok(!raw.includes(secret));}
 }
 assert.equal(logins,3);assert.equal(logouts,3);assert.equal(unexpected,0);
});


test('sustained preflight rejects unusable scoped capacity before creating any runs and logs out',async t=>{
 const repository=process.cwd(),dir=await mkdtemp(join(repository,'.local','sustained-capacity-test-'));await mkdir(join(dir,'.local','receipt-signing'),{recursive:true});
 const scope={organizationId:'00000000-0000-4000-8000-000000000001',projectId:'10000000-0000-4000-8000-000000000001'},secret='synthetic-capacity-access-canary',session='synthetic-capacity-session-canary';
 await writeFile(join(dir,'.local','credentials.json'),JSON.stringify({organizations:[{...scope,credentials:[{role:'admin',token:secret}]}]}));await writeFile(join(dir,'.local','receipt-signing','public.pem'),'synthetic-unused-key');
 let capacity,unexpected=0,logouts=0;
 const server=createServer(async(req,res)=>{res.setHeader('Content-Type','application/json');assert.equal(req.headers['x-agenttrust-project'],scope.projectId);
  if(req.url==='/v1/auth/login'){for await(const ignored of req){}res.setHeader('Set-Cookie',session+'=value; HttpOnly');res.end('{}');return;}
  assert.equal(req.headers.cookie,session+'=value');
  if(req.url==='/v1/me'){res.end(JSON.stringify({...scope,role:'admin'}));return;}
  if(req.url==='/v1/operations'){res.end(JSON.stringify({observedAt:'2026-01-01T00:00:00Z',executionCapacity:capacity}));return;}
  if(req.url==='/v1/auth/logout'){logouts++;res.end('{}');return;}
  unexpected++;res.writeHead(500);res.end('{}');
 });server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));assert.ok(resolve(dir).startsWith(resolve(repository,'.local')+sep));await rm(dir,{recursive:true,force:true});});
 const normal={scope:'organization',organizationId:scope.organizationId,retained:{used:1,limit:10000,remaining:9999},active:{used:0,limit:10,remaining:10}};
 for(const [value,expected] of [[{...normal,retained:{used:9999,limit:10000,remaining:1}},'insufficient_retained'],[{...normal,retained:{used:10,limit:10000,remaining:9990},active:{used:10,limit:10,remaining:0}},'no_active_slot'],[{...normal,organizationId:'00000000-0000-4000-8000-000000000002'},'invalid_capacity'],[undefined,'invalid_capacity']]){
  capacity=value;let result;try{result=await exec(process.execPath,[join(repository,'scripts','sustained-smoke.mjs'),'--cycles','2','--interval-ms','1000'],{cwd:dir,windowsHide:true,env:{...process.env,PORT:String(server.address().port),OWNER_DATABASE_URL:'postgres://synthetic:synthetic@127.0.0.1:1/unused'}});}catch(error){result=error;}
  assert.equal(result.code,1);const output=JSON.parse(result.stdout.trim().split('\n').at(-1)),raw=await readFile(join(dir,output.reportPath),'utf8'),report=JSON.parse(raw);
  assert.equal(report.sessionScopeVerified,true);assert.equal(report.capacityPreflight.status,expected);assert.equal(output.capacityPreflightStatus,expected);assert.equal(report.runs.length,0);assert.equal(report.completed,false);assert.equal(report.sessionLoggedOut,true);
  for(const value of [secret,session]){assert.ok(!raw.includes(value));assert.ok(!result.stdout.includes(value));assert.ok(!result.stderr.includes(value));}
 }
 assert.equal(logouts,4);assert.equal(unexpected,0);
});
