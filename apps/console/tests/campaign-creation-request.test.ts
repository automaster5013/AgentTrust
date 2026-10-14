import test from 'node:test';import assert from 'node:assert/strict';
import {campaignCreationJson,CampaignCreationHttpError,CampaignCreationUncertainError} from '../src/lib/campaign-creation-request.ts';
import {uncertainCampaignWrite} from '../src/lib/campaign-write-error.ts';
const originalFetch=globalThis.fetch;
async function mocked(fetcher:typeof fetch,action:()=>Promise<void>){globalThis.fetch=fetcher;try{await action()}finally{globalThis.fetch=originalFetch}}
test('campaign admission distinguishes explicit HTTP refusal from unknown server or gateway completion',async()=>{
 for(const status of [400,401,403,404,409,413,422,429])await mocked(async()=>new Response('fixture-private-http',{status}),async()=>{await assert.rejects(campaignCreationJson('campaigns',{method:'POST'}),e=>e instanceof CampaignCreationHttpError&&e.status===status&&!e.message.includes('fixture-private'))});
 for(const status of [500,502,503])await mocked(async()=>new Response('fixture-private-http',{status}),async()=>{await assert.rejects(campaignCreationJson('campaigns',{method:'POST'}),e=>e instanceof CampaignCreationUncertainError&&e.message===uncertainCampaignWrite)});
});
test('lost malformed oversized and invalid UTF8 campaign admission receipts remain unknown without resubmission',async()=>{
 for(const body of ['{fixture-private',new Uint8Array([0xff]),'x'.repeat(1048577)]){let calls=0;await mocked(async()=>{calls++;return new Response(body)},async()=>{await assert.rejects(campaignCreationJson('campaigns',{method:'POST'}),e=>e instanceof CampaignCreationUncertainError);assert.equal(calls,1)})}
 let calls=0;await mocked(async()=>{calls++;throw new TypeError('fixture-private-network')},async()=>{await assert.rejects(campaignCreationJson('campaigns',{method:'POST'}),e=>e instanceof CampaignCreationUncertainError);assert.equal(calls,1)});
});
test('campaign response body cancellation remains bounded and does not invent a successful admission',async()=>{
 const abort=new AbortController();let cancelled=false;await mocked(async()=>new Response(new ReadableStream({start(stream){stream.enqueue(new TextEncoder().encode('{'))},cancel(){cancelled=true}})),async()=>{const timer=setTimeout(()=>abort.abort(),5);try{await assert.rejects(campaignCreationJson('campaigns',{method:'POST',signal:abort.signal}),e=>e instanceof CampaignCreationUncertainError);assert.ok(cancelled)}finally{clearTimeout(timer)}});
 await mocked(async()=>new Response('fixture-private',{status:404}),async()=>{await assert.rejects(campaignCreationJson('campaign-requests/aaaaaaaa'),e=>e instanceof CampaignCreationHttpError&&e.status===404)});
});
