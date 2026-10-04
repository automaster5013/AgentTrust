import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
const exec=promisify(execFile);
test('actual sustained command logs out issued sessions when login evidence is malformed or rejected',async t=>{
 const repository=process.cwd(),dir=await mkdtemp(join(repository,'.local','sustained-cleanup-test-'));
 await mkdir(join(dir,'.local','receipt-signing'),{recursive:true});
 const secret='synthetic-soak-key-canary',session='synthetic-soak-session-canary';
 await writeFile(join(dir,'.local','credentials.json'),JSON.stringify({organizations:[{credentials:[{role:'admin',token:secret}]}]}));
 await writeFile(join(dir,'.local','receipt-signing','public.pem'),'synthetic-unused-public-key');
 let status=200,body='{invalid',logout=0,login=0;
 const server=createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json');
  if(req.url==='/v1/auth/login'){
   login++;let input='';for await(const chunk of req)input+=chunk;
   assert.equal(JSON.parse(input).accessKey,secret);res.setHeader('Set-Cookie',session+'=value; HttpOnly');res.writeHead(status);res.end(body);return;
  }
  assert.equal(req.url,'/v1/auth/logout');assert.equal(req.headers.cookie,session+'=value');logout++;res.end('{}');
 });server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));assert.ok(resolve(dir).startsWith(resolve(repository,'.local')+sep));await rm(dir,{recursive:true,force:true});});
 const run=async()=>{
  let result;try{result=await exec(process.execPath,[join(repository,'scripts','sustained-smoke.mjs'),'--cycles','1','--interval-ms','1000'],{cwd:dir,windowsHide:true,env:{...process.env,PORT:String(server.address().port),OWNER_DATABASE_URL:'postgres://synthetic:synthetic@127.0.0.1:1/unused'}});}catch(error){result=error;}
  assert.equal(result.code,1);const output=JSON.parse(result.stdout.trim().split('\n').at(-1)),raw=await readFile(join(dir,output.reportPath),'utf8'),report=JSON.parse(raw);
  for(const value of [secret,session]){assert.ok(!result.stdout.includes(value));assert.ok(!result.stderr.includes(value));assert.ok(!raw.includes(value));}
  assert.equal(report.completed,false);assert.equal(report.failed,true);assert.equal(report.sessionLoggedOut,true);assert.equal(report.runs.length,0);
 };
 await run();assert.equal(logout,1);status=500;body='{}';await run();assert.equal(logout,2);assert.equal(login,2);
});
