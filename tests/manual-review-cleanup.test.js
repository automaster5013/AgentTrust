import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
const exec=promisify(execFile);
test('actual manual review smoke keeps an ambiguously acknowledged approval blocked and logs out',async t=>{
 const repository=process.cwd(),dir=await mkdtemp(join(repository,'.local','manual-cleanup-test-'));
 await mkdir(join(dir,'.local'));const key='synthetic-manual-key-canary',cookie='synthetic-manual-cookie-canary',bodyCanary='synthetic-approval-response-canary';
 await writeFile(join(dir,'.local','credentials.json'),JSON.stringify({organizations:[{credentials:[{role:'admin',token:key}]}]}));
 const runId=randomUUID(),agentId=randomUUID(),datasetId=randomUUID(),policyId=randomUUID();let approvalStatus=200,allowed=false,decisions=[],logout=0;
 const server=createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json');let raw='';for await(const chunk of req)raw+=chunk;const input=raw?JSON.parse(raw):null;
  if(req.url==='/v1/auth/login'){assert.equal(input.accessKey,key);res.setHeader('Set-Cookie',cookie+'=value; HttpOnly');res.end('{}');return;}
  assert.equal(req.headers.cookie,cookie+'=value');
  if(req.url==='/v1/auth/logout'){logout++;res.end('{}');return;}
  if(req.url==='/v1/catalog'){res.end(JSON.stringify({agent:[{id:agentId,mode:'compliant'}],dataset:[{id:datasetId}]}));return;}
  if(req.url==='/v1/policy-versions'){res.end(JSON.stringify({id:policyId}));return;}
  if(req.url==='/v1/runs'){res.end(JSON.stringify({id:runId,state:'succeeded',gate:{evaluationPassed:true,deploymentAllowed:false}}));return;}
  if(req.url==='/v1/release-gate'){res.end(JSON.stringify({deploymentAllowed:false,manualApproval:{status:'missing'}}));return;}
  assert.equal(req.url,'/v1/runs/'+runId+'/reviews');decisions.push(input.decision);allowed=input.decision==='approved';
  if(allowed){res.writeHead(approvalStatus);res.end(approvalStatus===200?'{'+bodyCanary:'{}');}else res.end('{}');
 });server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));assert.ok(resolve(dir).startsWith(resolve(repository,'.local')+sep));await rm(dir,{recursive:true,force:true});});
 for(const status of [200,500]){
  approvalStatus=status;allowed=false;decisions=[];const before=logout;let result;
  try{result=await exec(process.execPath,[join(repository,'scripts','manual-review-smoke.mjs')],{cwd:dir,windowsHide:true,env:{...process.env,PORT:String(server.address().port)}});}catch(error){result=error;}
  assert.equal(result.code,1);assert.equal(logout,before+1);assert.deepEqual(decisions,['approved','rejected']);assert.equal(allowed,false);assert.equal(result.stdout,'');
  for(const value of [key,cookie,bodyCanary]){assert.ok(!result.stdout.includes(value));assert.ok(!result.stderr.includes(value));}
 }
});
