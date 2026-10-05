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
 const repository=process.cwd(),dir=await mkdtemp(join(repository,'.local','portfolio-organization-test-'));await mkdir(join(dir,'.local','receipt-signing'),{recursive:true});
 const organizations=[0,1].map(i=>({organizationId:`00000000-0000-4000-8000-00000000000${i}`,projectId:`10000000-0000-4000-8000-00000000000${i}`,credentials:['admin','editor','viewer'].map(role=>({role,token:`synthetic-organization-${i}-${role}-canary`}))}));
 await writeFile(join(dir,'.local','credentials.json'),JSON.stringify({organizations}));await writeFile(join(dir,'.local','receipt-signing','public.pem'),generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'}));
 t.after(async()=>{assert.ok(resolve(dir).startsWith(resolve(repository,'.local')+sep));await rm(dir,{recursive:true,force:true});});
 return {repository,dir,organizations};
}
async function run(f,port,script,args){try{return await exec(process.execPath,[join(f.repository,'scripts',script),...args],{cwd:f.dir,windowsHide:true,timeout:15000,env:{...process.env,PORT:String(port)}});}catch(error){return error;}}
test('portfolio selected organization authenticates only its key, refuses wrong session scope before scenario writes and logs out',async t=>{
 const f=await fixture(t),selected=f.organizations[1],session='synthetic-selected-cookie-canary';let mismatch,logins=0,logouts=0,unexpected=0;
 const server=createServer(async(req,res)=>{res.setHeader('Content-Type','application/json');assert.equal(req.headers['x-agenttrust-project'],selected.projectId);
  if(req.url==='/v1/auth/login'){let raw='';for await(const chunk of req)raw+=chunk;assert.equal(JSON.parse(raw).accessKey,selected.credentials.find(x=>x.role==='admin').token);logins++;res.setHeader('Set-Cookie',session+'=value; HttpOnly');res.end('{}');return;}
  assert.equal(req.headers.cookie,session+'=value');if(req.url==='/v1/me'){res.end(JSON.stringify(mismatch));return;}if(req.url==='/v1/auth/logout'){logouts++;res.end('{}');return;}unexpected++;res.writeHead(500);res.end('{}');
 });server.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
 for(const changes of [{organizationId:f.organizations[0].organizationId},{projectId:f.organizations[0].projectId},{role:'viewer'}]){
  mismatch={organizationId:selected.organizationId,projectId:selected.projectId,role:'admin',...changes};const result=await run(f,server.address().port,'portfolio-demo.mjs',['--compare','--organization-index','1','--export-receipts']);assert.equal(result.code,1);
  const summary=JSON.parse(result.stdout.trim().split('\n').at(-1)),raw=await readFile(join(f.dir,summary.reportPath),'utf8'),report=JSON.parse(raw);assert.equal(report.sessionLoggedOut,true);assert.equal(report.completed,false);assert.equal(report.organizationIndex,1);assert.equal(report.organizationId,selected.organizationId);assert.equal(report.projectId,selected.projectId);assert.equal(report.steps?.length??0,0);assert.equal(report.evidenceBundle,undefined);
  for(const secret of [session,...f.organizations.flatMap(o=>o.credentials.map(c=>c.token))]){assert.ok(!result.stdout.includes(secret));assert.ok(!result.stderr.includes(secret));assert.ok(!raw.includes(secret));}
 }
 assert.equal(logins,3);assert.equal(logouts,3);assert.equal(unexpected,0);
});
test('portfolio organization selector rejects malformed, repeated and unavailable choices before HTTP',async t=>{
 const f=await fixture(t);let requests=0;const server=createServer((req,res)=>{requests++;res.end('{}');});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
 for(const args of [['--organization-index','01'],['--organization-index','-1'],['--organization-index','100'],['--organization-index'],['--organization-index','1','--organization-index','0'],['--organization-index','2'],['--organization-index','1','--compare','--compare']]){const r=await run(f,server.address().port,'portfolio-demo.mjs',args);assert.equal(r.code,1);const summary=JSON.parse(r.stdout.trim().split('\n').at(-1));assert.equal(summary.status,'blocked');assert.equal(summary.sessionLoggedOut,true);}assert.equal(requests,0);
});

test('role demo selects primary roles from organization one and an independent outsider from organization zero',async t=>{
 const f=await fixture(t),selected=f.organizations[1],other=f.organizations[0];let logins=0,logouts=0,unexpected=0,wrongOutsider;
 const tokens=new Map(f.organizations.flatMap((o,index)=>o.credentials.map(c=>[c.token,{...o,role:c.role,index}])));
 const server=createServer(async(req,res)=>{res.setHeader('Content-Type','application/json');
  if(req.url==='/v1/auth/login'){let raw='';for await(const chunk of req)raw+=chunk;const expected=[selected.credentials[0],selected.credentials[1],selected.credentials[2],other.credentials[2]][logins%4];const token=JSON.parse(raw).accessKey;assert.equal(token,expected.token);const scope=tokens.get(token);assert.equal(req.headers['x-agenttrust-project'],scope.projectId);logins++;res.setHeader('Set-Cookie',`synthetic-role-${scope.index}-${scope.role}=value; HttpOnly`);res.end('{}');return;}
  const match=/^synthetic-role-([01])-(admin|editor|viewer)=value$/.exec(req.headers.cookie);assert.ok(match);const o=f.organizations[Number(match[1])];assert.equal(req.headers['x-agenttrust-project'],o.projectId);
  if(req.url==='/v1/me'){res.end(JSON.stringify({organizationId:o.organizationId,projectId:o.projectId,role:match[2],...(o===other?wrongOutsider:{})}));return;}
  if(req.url==='/v1/auth/logout'){logouts++;res.end('{}');return;}unexpected++;res.writeHead(500);res.end('{}');
 });server.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
 for(const changes of [{organizationId:selected.organizationId},{projectId:selected.projectId},{role:'admin'}]){
  wrongOutsider=changes;const result=await run(f,server.address().port,'portfolio-roles.mjs',['--organization-index','1']);assert.equal(result.code,1);const summary=JSON.parse(result.stdout.trim().split('\n').at(-1)),raw=await readFile(join(f.dir,summary.reportPath),'utf8'),report=JSON.parse(raw);assert.equal(report.completed,false);assert.equal(report.sessionsLoggedOut,true);assert.equal(report.organizationIndex,1);assert.equal(report.organizationId,selected.organizationId);assert.equal(report.outsiderOrganizationId,other.organizationId);assert.equal(report.steps?.length??0,0);for(const secret of tokens.keys())assert.ok(!raw.includes(secret));assert.ok(!raw.includes('synthetic-role-'));
 }
 assert.equal(logins,12);assert.equal(logouts,12);assert.equal(unexpected,0);
});

test('role organization selector refuses missing or duplicated choices without authenticating',async t=>{
 const f=await fixture(t);let requests=0;const server=createServer((req,res)=>{requests++;res.end('{}');});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
 for(const args of [['--organization-index','2'],['--organization-index','01'],['--organization-index'],['--organization-index','0','--organization-index','1'],['--compare']]){const r=await run(f,server.address().port,'portfolio-roles.mjs',args);assert.equal(r.code,1);const summary=JSON.parse(r.stdout.trim().split('\n').at(-1));assert.equal(summary.status,'blocked');assert.equal(summary.sessionsLoggedOut,true);}assert.equal(requests,0);
});
