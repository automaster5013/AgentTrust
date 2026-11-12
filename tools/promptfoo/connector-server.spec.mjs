import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {connectorServer} from './connector-server.mjs';
import {CONTRACT,digest,profileHash} from './connector-policy.mjs';
const require=createRequire(process.env.AGENTTRUST_EXISTING_PROMPTFOO_PACKAGE??new URL('./package.json',import.meta.url));
const Ajv=require('ajv'),token='a'.repeat(64),c=JSON.parse(readFileSync(new URL('./connector-cases.json',import.meta.url),'utf8')).cases[0];
const sample={contract:CONTRACT,case:c,contentSha256:digest({contract:CONTRACT,case:c})};
test('bounded internal connector grade authenticates and preserves reference routing',async()=>{
 const reference=createServer((req,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({referencePath:req.url}))});
 const server=connectorServer(token,Ajv,reference);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port;
 const send=(body,headers={})=>fetch(url+'/recorded-grade',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body)});
 const body={sample,validatorProfileSha256:profileHash()},auth={'X-AgentTrust-Worker-Token':token};
 try{
  assert.equal((await send(body)).status,401);assert.equal((await send(body,{'X-AgentTrust-Worker-Token':'b'.repeat(64)})).status,401);
  assert.equal((await send({...body,validatorProfileSha256:'b'.repeat(64)},auth)).status,409);
  const good=await send(body,auth);assert.equal(good.status,200);const proof=await good.json();assert.deepEqual(proof.statuses,['pass','pass','pass']);assert.equal(proof.caseSha256,sample.contentSha256);assert.equal(proof.ajvVersion,'8.20.0');
  assert.equal((await send(JSON.stringify(body).slice(0,-1)+',"sample":{}}',auth)).status,400);
  assert.equal((await send(' '.repeat(8193),auth)).status,413);
  assert.equal((await fetch(url+'/grade',{method:'POST'})).status,200);assert.deepEqual(await (await fetch(url+'/health')).json(),{referencePath:'/health'});
  assert.equal((await fetch(url+'/outside')).status,404);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
});
