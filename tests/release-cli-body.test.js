import test from 'node:test';
import assert from 'node:assert/strict';
import {readReleaseResponse,releaseResponseLimit} from '../scripts/release-gate.mjs';
test('release reader accepts fragmented UTF-8 JSON within byte limit',async()=>{
 const bytes=Buffer.from(JSON.stringify({reason:'합성 근거'})),stream=new ReadableStream({start(controller){for(const byte of bytes)controller.enqueue(Uint8Array.of(byte));controller.close();}});assert.deepEqual(await readReleaseResponse(new Response(stream)),{reason:'합성 근거'});
});
test('release reader rejects oversized streaming body and cancels further reading',async()=>{
 let reads=0,cancelled=false;const stream=new ReadableStream({pull(controller){reads++;controller.enqueue(new Uint8Array(1024*1024));},cancel(){cancelled=true;}});await assert.rejects(readReleaseResponse(new Response(stream)),/size limit/);assert.equal(cancelled,true);assert.ok(reads<=releaseResponseLimit/(1024*1024)+2);
});
test('release reader refuses missing, malformed and invalid UTF-8 response bodies',async()=>{
 await assert.rejects(readReleaseResponse(new Response(null)),/missing/);await assert.rejects(readReleaseResponse(new Response('not JSON')));await assert.rejects(readReleaseResponse(new Response(Uint8Array.of(123,34,120,34,58,34,255,34,125))));
});
