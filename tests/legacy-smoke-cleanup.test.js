import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
const exec=promisify(execFile);
for(const script of ['smoke.mjs','ci-smoke.mjs','manual-review-smoke.mjs','resilience-smoke.mjs']){
 test(script+' closes issued sessions and redacts malformed/rejected login failures',async t=>{
  const repository=process.cwd(),dir=await mkdtemp(join(repository,'.local','legacy-cleanup-test-'));
  await mkdir(join(dir,'.local'));const secret='synthetic-legacy-key-canary',cookie='synthetic-legacy-session-canary',bodyCanary='synthetic-response-body-canary';
  await writeFile(join(dir,'.local','credentials.json'),JSON.stringify({organizations:[{credentials:[{role:'admin',token:secret}]}]}));
  await writeFile(join(dir,'.local','restart-check.json'),'{}');let status=200,body='{'+bodyCanary,logout=0;
  const server=createServer(async(req,res)=>{
   res.setHeader('Content-Type','application/json');
   if(req.url==='/v1/auth/login'){let input='';for await(const chunk of req)input+=chunk;assert.equal(JSON.parse(input).accessKey,secret);res.setHeader('Set-Cookie',cookie+'=value; HttpOnly');res.writeHead(status);res.end(body);return;}
   assert.equal(req.url,'/v1/auth/logout');assert.equal(req.headers.cookie,cookie+'=value');logout++;res.end('{}');
  });server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));assert.ok(resolve(dir).startsWith(resolve(repository,'.local')+sep));await rm(dir,{recursive:true,force:true});});
  for(const code of [200,500]){
   status=code;const before=logout;let result;
   try{result=await exec(process.execPath,[join(repository,'scripts',script),...(script==='smoke.mjs'?['before']:[])],{cwd:dir,windowsHide:true,env:{...process.env,PORT:String(server.address().port)}});}catch(error){result=error;}
   assert.equal(result.code,1);assert.equal(logout,before+1);
   for(const value of [secret,cookie,bodyCanary]){assert.ok(!result.stdout.includes(value));assert.ok(!result.stderr.includes(value));}
   assert.ok(!result.stderr.includes('SyntaxError'));assert.ok(!result.stderr.includes('node_modules'));assert.equal(result.stdout,'');
  }
 });
}
