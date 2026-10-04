import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {generateKeyPairSync} from 'node:crypto';
import {once} from 'node:events';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {releaseResponseLimit} from '../scripts/release-gate.mjs';
const exec=promisify(execFile);
for(const [script,args] of [['portfolio-demo.mjs',[]],['portfolio-demo.mjs',['--compare']],['portfolio-demo.mjs',['--export-receipts']],['portfolio-demo.mjs',['--compare','--export-receipts']],['portfolio-roles.mjs',[]],['metadata-benchmark.mjs',[]]]){
 test(script+(args.length?' '+args.join(' '):'')+' rejects invalid UTF-8 and excessive login bodies before scenario reads and logs out',async t=>{
  const repository=process.cwd(),dir=await mkdtemp(join(repository,'.local','demo-response-test-'));
  await mkdir(join(dir,'.local','receipt-signing'),{recursive:true});
  const key='synthetic-demo-key-canary',cookie='synthetic-demo-cookie-canary';
  await writeFile(join(dir,'.local','credentials.json'),JSON.stringify({organizations:[{organizationId:'00000000-0000-0000-0000-000000000001',projectId:'00000000-0000-0000-0000-000000000002',credentials:['admin','editor','viewer'].map(role=>({role,token:key}))}]}));
  await writeFile(join(dir,'.local','receipt-signing','public.pem'),generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'}));
  let body,reads=0,logout=0;
  const server=createServer(async(req,res)=>{
   res.setHeader('Content-Type','application/json');
   if(req.url==='/v1/auth/login'){for await(const chunk of req){}res.setHeader('Set-Cookie',cookie+'=value; HttpOnly');res.end(body);return;}
   if(req.url==='/v1/auth/logout'){assert.equal(req.headers.cookie,cookie+'=value');logout++;res.end('{}');return;}
   reads++;res.end(JSON.stringify({role:'invalid',items:[]}));
  });server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));assert.ok(resolve(dir).startsWith(resolve(repository,'.local')+sep));await rm(dir,{recursive:true,force:true});});
  for(const value of [Buffer.concat([Buffer.from('{"ignored":"'),Buffer.from([255]),Buffer.from('"}')]),Buffer.from(JSON.stringify({ignored:'x'.repeat(releaseResponseLimit)}))]){
   body=value;const before=logout,priorReads=reads;let result;
   try{result=await exec(process.execPath,[join(repository,'scripts',script),...args],{cwd:dir,windowsHide:true,timeout:15000,env:{...process.env,PORT:String(server.address().port)}});}catch(error){result=error;}
   assert.equal(result.code,1);assert.equal(logout,before+1);assert.equal(reads,priorReads);
   const report=JSON.parse(result.stdout.trim().split('\n').at(-1));assert.equal(report.status,'blocked');
   assert.equal(report.sessionLoggedOut??report.sessionsLoggedOut,true);
   for(const canary of [key,cookie]){assert.ok(!result.stdout.includes(canary));assert.ok(!result.stderr.includes(canary));}
  }
 });
}

test('portfolio demo rejects duplicate and unsupported demo options before credentials or HTTP requests',async t=>{
  const repository=process.cwd(),dir=await mkdtemp(join(repository,'.local','demo-input-test-'));await mkdir(join(dir,'.local'));
  let requests=0;const server=createServer((req,res)=>{requests++;res.end('{}');});server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));assert.ok(resolve(dir).startsWith(resolve(repository,'.local')+sep));await rm(dir,{recursive:true,force:true});});
  for(const args of [['--unknown'],['--compare','--compare'],['--compare=true'],['--export-receipts','--export-receipts'],['--compare','--export-receipts','--compare']]){
    let result;try{result=await exec(process.execPath,[join(repository,'scripts','portfolio-demo.mjs'),...args],{cwd:dir,windowsHide:true,timeout:10000,env:{...process.env,PORT:String(server.address().port)}});}catch(error){result=error;}
    assert.equal(result.code,1);assert.equal(requests,0);const report=JSON.parse(result.stdout.trim().split('\n').at(-1));assert.equal(report.status,'blocked');assert.equal(report.sessionLoggedOut,true);
  }
});
