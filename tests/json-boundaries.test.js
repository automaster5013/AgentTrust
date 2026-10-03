import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJson } from '../packages/contracts/json.js';
import { validate,InputError } from '../packages/contracts/index.js';
import { validateEvidence } from '../packages/evaluator/https-adapter.js';
import { once } from 'node:events';
import { createApp } from '../apps/api/server.js';
import { sampleDataset } from '../packages/contracts/samples.js';

test('JSON decoding rejects malformed UTF-8, overflow numbers and unstorable Unicode',()=>{
 for(const bytes of [Buffer.from([0x22,0xc0,0xaf,0x22]),Buffer.from([0x22,0xed,0xa0,0x80,0x22]),Buffer.from('1e999'),Buffer.from('"\\u0000"'),Buffer.from('"\\ud800"'),Buffer.from('{"\\udc00":1}')])assert.throws(()=>parseJson(bytes));
 assert.deepEqual(parseJson(Buffer.from('{"message":"한글 😀","value":1e20,"escaped":"\\n"}')),{message:'한글 😀',value:1e20,escaped:'\n'});
});
test('version validation rejects unstorable nested mock values before hashing or persistence',()=>{
 for(const value of [Infinity,-Infinity,NaN,'\u0000','\ud800']){const data=structuredClone(sampleDataset);data.cases[0].mock.toolEvents=[{name:'lookup_order',args:{value}}];assert.throws(()=>validate('dataset',data),InputError);}
 const data=structuredClone(sampleDataset);data.cases[0].mock.toolEvents=[{name:'lookup_order',args:{['bad\u0000']:1}}];assert.throws(()=>validate('dataset',data),InputError);
});
test('external evidence rejects values that cannot be stored as immutable JSONB',()=>{
 for(const output of ['\u0000','\udfff'])assert.throws(()=>validateEvidence({output,toolEvents:[]}),InputError);
 assert.throws(()=>validateEvidence({output:'response',toolEvents:[{name:'lookup',args:{amount:Infinity}}]}),InputError);
 assert.equal(validateEvidence({output:'정상 😀',toolEvents:[]}).output,'정상 😀');
});

test('native HTTP rejects invalid JSON encoding before credential lookup',async t=>{
 const safe={rolname:'agenttrust_api',rolcanlogin:true,rolbypassrls:false,rolsuper:false,rolcreaterole:false,rolcreatedb:false,rolreplication:false,memberships:false,schema_create:false,database_create:false,owns_tables:false,owns_functions:false};
 let logins=0;const auth={login:async()=>{logins++;return {token:'a'.repeat(64)};}};
 const server=createApp({database:{query:async()=>({rows:[safe]})},auth});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();});
 const url=`http://127.0.0.1:${server.address().port}/v1/auth/login`,headers={'Content-Type':'application/json','X-AgentTrust-Request':'local-ui'};
 for(const body of [Buffer.concat([Buffer.from('{"accessKey":"'),Buffer.from([0xc0,0xaf]),Buffer.from('"}')]),Buffer.from('{"accessKey":"\\u0000"}'),Buffer.from('{"accessKey":"\\ud800"}'),Buffer.from('{"accessKey":1e999}')]){
  const res=await fetch(url,{method:'POST',headers,body});assert.equal(res.status,400);assert.equal((await res.json()).error,'Invalid JSON body.');assert.equal(logins,0);
 }
 const valid=await fetch(url,{method:'POST',headers,body:JSON.stringify({accessKey:'b'.repeat(64)})});assert.equal(valid.status,200);assert.equal(logins,1);
});
