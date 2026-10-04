import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {generateKeyPairSync} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {seededDemoScope,assertDemoSessionScope} from '../scripts/demo-session-scope.mjs';
const exec=promisify(execFile);
const organizationId='00000000-0000-0000-0000-000000000abc',projectId='00000000-0000-0000-0000-000000000def';
test('seeded demo scope normalizes valid IDs and rejects missing or malformed configured boundaries',()=>{
  const scope=seededDemoScope({organizationId:organizationId.toUpperCase(),projectId:projectId.toUpperCase()});assert.deepEqual(scope,{organizationId,projectId});
  assertDemoSessionScope({role:'admin',...scope},scope,'admin');
  for(const config of [undefined,{}, {organizationId,projectId:'../other'},{organizationId:'other',projectId}])assert.throws(()=>seededDemoScope(config));
  for(const field of ['organizationId','projectId','role'])assert.throws(()=>assertDemoSessionScope({role:'admin',...scope,[field]:'other'},scope,'admin'));
});
for(const [script,args] of [['portfolio-demo.mjs',[]],['portfolio-demo.mjs',['--compare','--export-receipts']],['portfolio-roles.mjs',[]]]){
  test(script+' '+args.join(' ')+' rejects mismatched live session scope before any scenario read or mutation and logs out',async t=>{
    const repository=process.cwd(),dir=await mkdtemp(join(repository,'.local','demo-scope-test-'));
    await mkdir(join(dir,'.local','receipt-signing'),{recursive:true});
    const token='synthetic-session-scope-key-canary',cookie='synthetic-session-scope-cookie-canary';
    await writeFile(join(dir,'.local','credentials.json'),JSON.stringify({organizations:[{organizationId,projectId,credentials:['admin','editor','viewer'].map(role=>({role,token}))}]}));
    await writeFile(join(dir,'.local','receipt-signing','public.pem'),generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'}));
    let me,logins=0,profiles=0,logouts=0,other=0;const headers=[];
    const server=createServer(async(req,res)=>{
      headers.push(req.headers['x-agenttrust-project']);res.setHeader('Content-Type','application/json');
      if(req.url==='/v1/auth/login'){for await(const chunk of req){}logins++;res.setHeader('Set-Cookie',cookie+'=value; HttpOnly');res.end('{}');return;}
      if(req.url==='/v1/me'){profiles++;res.end(JSON.stringify(me));return;}
      if(req.url==='/v1/auth/logout'){logouts++;res.end('{}');return;}
      other++;res.end('{}');
    });server.listen(0,'127.0.0.1');await once(server,'listening');
    t.after(async()=>{server.closeAllConnections();await new Promise(done=>server.close(done));assert.ok(resolve(dir).startsWith(resolve(repository,'.local')+sep));await rm(dir,{recursive:true,force:true});});
    for(const field of ['organizationId','projectId','role']){
      me={role:'admin',organizationId,projectId,[field]:'other'};const before={logins,profiles,logouts};
      let result;try{result=await exec(process.execPath,[join(repository,'scripts',script),...args],{cwd:dir,timeout:10000,windowsHide:true,env:{...process.env,PORT:String(server.address().port)}});}catch(error){result=error;}
      assert.equal(result.code,1);assert.equal(logins,before.logins+1);assert.equal(profiles,before.profiles+1);assert.equal(logouts,before.logouts+1);assert.equal(other,0);
      assert.ok(headers.every(header=>header===projectId));
      const report=JSON.parse(result.stdout.trim().split('\n').at(-1));assert.equal(report.status,'blocked');assert.equal(report.sessionLoggedOut??report.sessionsLoggedOut,true);
      for(const canary of [token,cookie]){assert.ok(!result.stdout.includes(canary));assert.ok(!result.stderr.includes(canary));}
    }
  });
}
