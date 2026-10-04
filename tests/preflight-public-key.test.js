import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:http';
import {once} from 'node:events';
const exec=promisify(execFile);

test('actual demo preflight requires one bounded public key before Docker or health',async t=>{
 const repository=process.cwd(),root=resolve('.local'),dir=await mkdtemp(join(root,'preflight-public-test-'));
 assert.ok(dir.startsWith(root+sep));await mkdir(join(dir,'.local','receipt-signing'),{recursive:true});await writeFile(join(dir,'.env'),'');
 const pair=generateKeyPairSync('ed25519'),privatePem=pair.privateKey.export({type:'pkcs8',format:'pem'}),publicPem=pair.publicKey.export({type:'spki',format:'pem'});
 await writeFile(join(dir,'.local','receipt-signing','private.pem'),privatePem);const publicPath=join(dir,'.local','receipt-signing','public.pem');
 let id=0,key=0;const credentials={organizations:Array.from({length:2},()=>({organizationId:'00000000-0000-0000-0000-'+(++id).toString(16).padStart(12,'0'),projectId:'00000000-0000-0000-0000-'+(++id).toString(16).padStart(12,'0'),credentials:['admin','editor','viewer'].map(role=>({role,token:(++key).toString(16).padStart(64,'0')}))}))};
 await writeFile(join(dir,'.local','credentials.json'),JSON.stringify(credentials));let healthCalls=0;
 const server=createServer((_req,res)=>{healthCalls++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status:'ok',mode:'local-mock',persistent:true}));});server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));assert.ok(resolve(dir).startsWith(root+sep));await rm(dir,{recursive:true,force:true});});
 const port=server.address().port,marker=join(dir,'docker-accessed'),hook=join(dir,'docker.cjs');
 const rows=['api','db','worker'].map(Service=>({Service,State:'running',Health:Service==='worker'?'':'healthy',Publishers:Service==='api'?[{URL:'127.0.0.1',PublishedPort:port,TargetPort:4310}]:[]}));
 await writeFile(hook,`const cp=require('node:child_process'),fs=require('node:fs');cp.execFileSync=()=>{fs.writeFileSync(${JSON.stringify(marker)},'read');return ${JSON.stringify(JSON.stringify(rows))};};require('node:module').syncBuiltinESMExports();`);
 const run=async()=>{const result=await exec(process.execPath,['--require',hook,join(repository,'scripts','demo-preflight.mjs')],{cwd:dir,windowsHide:true,timeout:10000,env:{...process.env,PORT:String(port)}}).catch(e=>e);assert.equal(result.stderr,'');assert.ok(!result.stdout.includes(privatePem));return {result,report:JSON.parse(result.stdout)};};
 for(const bytes of [privatePem,publicPem+privatePem,publicPem+publicPem,publicPem+' '.repeat(1024),Buffer.concat([Buffer.from(publicPem),Buffer.from([0xff])])]){
  await writeFile(publicPath,bytes);const {result,report}=await run();assert.equal(result.code,1);assert.equal(report.failedCheck,'signing-key-pair');assert.ok(report.checks.slice(3).every(c=>c.status==='not_run'));assert.equal(healthCalls,0);
  await assert.rejects(readFile(marker),{code:'ENOENT'});
 }
 await writeFile(publicPath,publicPem.replaceAll('\n','\r\n'));const {result,report}=await run();assert.equal(result.code,undefined);assert.equal(report.status,'passed');assert.equal(healthCalls,1);assert.equal(await readFile(marker,'utf8'),'read');
});
