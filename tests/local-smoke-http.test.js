import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {localSmokeBase,fetchLocalSmoke} from '../scripts/local-smoke-http.mjs';
const exec=promisify(execFile);
test('local smoke port validation refuses authority injection and invalid port ranges',()=>{
 for(const port of ['1024','4310','65535'])assert.equal(localSmokeBase(port),'http://127.0.0.1:'+port);
 for(const port of ['',null,4310,'80','1023','65536','04310','4310@untrusted.example','4310/path','4310?x=1','4310#fragment',' 4310','4310\n','4310\r\n'])assert.throws(()=>localSmokeBase(port),/valid local smoke port/);
});
test('local smoke requests reject non-loopback targets and origin-changing paths before fetch',async()=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('Unexpected request');};
 try{
  for(const base of ['https://127.0.0.1:4310','http://localhost:4310','http://127.0.0.1:4310@untrusted.example','http://127.0.0.1:4310/path','http://127.0.0.1:4310?x=1'])await assert.rejects(fetchLocalSmoke(base,'/v1/auth/login'));
  for(const path of ['//untrusted.example/login','https://untrusted.example/login','/\\untrusted.example/login'])await assert.rejects(fetchLocalSmoke(localSmokeBase('4310'),path));
  assert.equal(calls,0);
 }finally{globalThis.fetch=original;}
});
test('actual local smoke transport rejects redirects without forwarding synthetic login data',async t=>{
 let destinationCalls=0;
 const destination=createServer((req,res)=>{destinationCalls++;res.end('{}');});destination.listen(0,'127.0.0.1');await once(destination,'listening');
 const server=createServer((req,res)=>{if(req.url==='/redirect'){res.writeHead(307,{Location:'http://127.0.0.1:'+destination.address().port+'/login'});res.end();}else{res.setHeader('Content-Type','application/json');res.end('{"synthetic":true}');}});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{for(const s of [server,destination]){s.closeAllConnections();await new Promise(resolve=>s.close(resolve));}});
 const base=localSmokeBase(String(server.address().port));
 await assert.rejects(fetchLocalSmoke(base,'/redirect',{method:'POST',redirect:'follow',headers:{Cookie:'synthetic-cookie'},body:'synthetic-key'}));assert.equal(destinationCalls,0);
 assert.equal((await (await fetchLocalSmoke(base,'/health')).json()).synthetic,true);
 const controller=new AbortController();controller.abort();await assert.rejects(fetchLocalSmoke(base,'/health',{signal:controller.signal}),error=>error.name==='AbortError');
});
test('all legacy smoke commands reject malformed ports before reading private local setup',async t=>{
 const repository=process.cwd(),dir=await mkdtemp(join(repository,'.local','invalid-smoke-port-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 for(const script of ['smoke.mjs','resilience-smoke.mjs','ci-smoke.mjs','manual-review-smoke.mjs','sustained-smoke.mjs']){
  await assert.rejects(exec(process.execPath,[join(repository,'scripts',script)],{cwd:dir,windowsHide:true,env:{...process.env,PORT:'4310@synthetic-canary.invalid'}}),error=>error.code!==0&&error.stdout===''&&error.stderr.includes('A valid local smoke port is required.')&&!error.stderr.includes('synthetic-canary.invalid'));
 }
});
