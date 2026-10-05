import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {generateKeyPairSync} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
const exec=promisify(execFile);
async function fixture(t){
 const repository=process.cwd(),dir=await mkdtemp(join(repository,'.local','burst-organization-test-'));await mkdir(join(dir,'.local','receipt-signing'),{recursive:true});
 const organizations=[0,1].map(i=>({organizationId:`00000000-0000-4000-8000-00000000000${i}`,projectId:`10000000-0000-4000-8000-00000000000${i}`,credentials:[{role:'editor',token:`synthetic-burst-scope-${i}-canary`}]}));await writeFile(join(dir,'.local','credentials.json'),JSON.stringify({organizations}));await writeFile(join(dir,'.local','receipt-signing','public.pem'),generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'}));
 t.after(async()=>{assert.ok(resolve(dir).startsWith(resolve(repository,'.local')+sep));await rm(dir,{recursive:true,force:true});});return {repository,dir,organizations};
}
async function run(f,port,args){try{return {...await exec(process.execPath,[join(f.repository,'scripts','burst-smoke.mjs'),...args],{cwd:f.dir,windowsHide:true,timeout:15000,env:{...process.env,PORT:String(port),OWNER_DATABASE_URL:'postgres://synthetic:synthetic@127.0.0.1:1/synthetic'}}),code:0};}catch(e){return e;}}

test('burst command binds default and selected editor scopes before any scenario reads or writes',async t=>{
 const f=await fixture(t);let selected,changes,logins=0,logouts=0,unexpected=0;const headerScopes=[];const session='synthetic-burst-scope-cookie';
 const server=createServer(async(req,res)=>{res.setHeader('Content-Type','application/json');headerScopes.push([req.headers['x-agenttrust-project'],selected.projectId]);
  if(req.url==='/v1/auth/login'){let raw='';for await(const chunk of req)raw+=chunk;assert.equal(JSON.parse(raw).accessKey,selected.credentials[0].token);logins++;res.setHeader('Set-Cookie',session+'=value; HttpOnly');res.end('{}');return;}
  assert.equal(req.headers.cookie,session+'=value');if(req.url==='/v1/me'){res.end(JSON.stringify({role:'editor',organizationId:selected.organizationId,projectId:selected.projectId,...changes}));return;}if(req.url==='/v1/auth/logout'){logouts++;res.end('{}');return;}unexpected++;res.writeHead(500);res.end('{}');
 });server.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
 for(const index of [0,1]){selected=f.organizations[index];for(const mismatch of [{organizationId:f.organizations[1-index].organizationId},{projectId:f.organizations[1-index].projectId},{role:'admin'}]){changes=mismatch;const result=await run(f,server.address().port,index===0?['--runs','6']:['--organization-index','1','--runs','6']);assert.equal(result.code,1);const summary=JSON.parse(result.stdout),raw=await readFile(join(f.dir,summary.reportPath),'utf8'),report=JSON.parse(raw);assert.equal(report.organizationIndex,index);assert.equal(report.organizationId,selected.organizationId);assert.equal(report.projectId,selected.projectId);assert.equal(report.sessionScopeVerified,false);assert.equal(report.sessionLoggedOut,true);assert.equal(report.runs?.length??0,0);for(const o of f.organizations)assert.ok(!raw.includes(o.credentials[0].token));assert.ok(!raw.includes(session));}}
 assert.equal(logins,6);assert.equal(logouts,6);assert.equal(unexpected,0);assert.ok(headerScopes.every(([actual,expected])=>actual===expected));
});

test('burst command refuses malformed and nonexistent organization choices before login',async t=>{
 const f=await fixture(t);let calls=0;const server=createServer((req,res)=>{calls++;res.end('{}');});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
 for(const args of [['--organization-index','2'],['--organization-index','01'],['--organization-index'],['--organization-index','1','--organization-index','0'],['--organization-index','-1'],['--organization-index','100']]){const result=await run(f,server.address().port,args);assert.ok([1,2].includes(result.code));}assert.equal(calls,0);
});


test('burst organization options preserve existing run bounds and reject duplicate or unknown selections',async()=>{
 const {parseBurstOptions}=await import('../scripts/burst-smoke-scenario.mjs');assert.deepEqual(parseBurstOptions([]),{runs:12,organizationIndex:0});assert.deepEqual(parseBurstOptions(['--runs','20','--organization-index','1']),{runs:20,organizationIndex:1});assert.deepEqual(parseBurstOptions(['--organization-index','99','--runs','2']),{runs:2,organizationIndex:99});
 for(const args of [['--runs','1'],['--runs','21'],['--runs','02'],['--runs','2','--runs','3'],['--unknown','2'],['--organization-index','01'],['--organization-index','100'],['--organization-index','1','--organization-index','0']])assert.throws(()=>parseBurstOptions(args));
});


test('actual burst CLI stops before catalog or creates when scoped capacity database observation is unavailable and logs out',async t=>{
 const f=await fixture(t),selected=f.organizations[1];let catalogOrWrites=0,logouts=0;
 const server=createServer(async(req,res)=>{res.setHeader('Content-Type','application/json');
  if(req.url==='/v1/auth/login'){res.setHeader('Set-Cookie','synthetic-capacity-session=value; HttpOnly');res.end('{}');return;}
  if(req.url==='/v1/me'){res.end(JSON.stringify({role:'editor',organizationId:selected.organizationId,projectId:selected.projectId}));return;}
  if(req.url==='/v1/auth/logout'){logouts++;res.end('{}');return;}
  catalogOrWrites++;res.writeHead(500);res.end('{}');
 });server.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
 const result=await run(f,server.address().port,['--organization-index','1','--runs','6']);assert.equal(result.code,1);const summary=JSON.parse(result.stdout),report=JSON.parse(await readFile(join(f.dir,summary.reportPath),'utf8'));
 assert.equal(summary.capacityPreflightStatus,'unavailable');assert.equal(report.capacityPreflight.requestedRuns,6);assert.equal(report.capacityPreflight.requiredActiveSlots,4);assert.equal(report.sessionScopeVerified,true);assert.equal(report.sessionLoggedOut,true);assert.equal(report.completed,false);assert.equal(catalogOrWrites,0);assert.equal(logouts,1);
});
