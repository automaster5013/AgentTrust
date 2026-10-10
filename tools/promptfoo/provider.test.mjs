import test from 'node:test';import assert from 'node:assert/strict';
import {callWorker} from './worker-provider.mjs';
const scope={organizationId:'11111111-1111-4111-8111-111111111111',projectId:'22222222-2222-4222-8222-222222222222'};
const token='a'.repeat(64);
test('only the fixed scoped worker endpoint is called; secrets are excluded from output',async()=>{
 const value=await callWorker('pass',scope,token,async(url,options)=>{assert.equal(url,'http://stack-ai-worker:8000/evaluate');assert.equal(options.redirect,'error');assert.equal(options.headers['X-AgentTrust-Worker-Token'],token);const body=JSON.parse(options.body);return new Response(JSON.stringify({...body,result:{decision:'pass'}}))});assert.deepEqual(JSON.parse(value.output),{decision:'pass'});assert.ok(!JSON.stringify(value).includes(token));
});
test('scope mismatch oversized output and unknown scenarios fail closed',async()=>{
 const foreign=await callWorker('pass',scope,token,async(url,options)=>new Response(JSON.stringify({...JSON.parse(options.body),organizationId:'33333333-3333-4333-8333-333333333333',result:{decision:'pass'}})));assert.ok(foreign.error);
 assert.ok((await callWorker('pass',scope,token,async()=>new Response('x'.repeat(8193)))).error);
 let called=false;assert.ok((await callWorker('http://outside.invalid',scope,token,async()=>{called=true})).error);assert.equal(called,false);
});
