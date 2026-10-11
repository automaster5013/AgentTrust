import test from 'node:test';import assert from 'node:assert/strict';
import {createServer} from 'node:http';import {once} from 'node:events';
import {boundedUtf8,BoundedTextError} from '../src/lib/bounded-utf8.ts';
const bytes=(s:string)=>new TextEncoder().encode(s);
const stream=(chunks:Uint8Array[])=>new ReadableStream<Uint8Array>({start(controller){for(const chunk of chunks)controller.enqueue(chunk);controller.close()}});
async function fixtureDeadline<T>(result:Promise<T>):Promise<T>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([result,new Promise<T>((_resolve,reject)=>{timer=setTimeout(()=>reject(Error('FIXTURE_DEADLINE')),2000)})])}finally{clearTimeout(timer)}}
test('byte limits retain exact multilingual text even across emoji UTF-8 boundaries',async()=>{
 const value=bytes('한국어 🚀'),result=await boundedUtf8(stream([value.slice(0,11),value.slice(11,12),value.slice(12)]),value.length);assert.equal(result,'한국어 🚀');assert.equal(await boundedUtf8(null,16),'');assert.equal(await boundedUtf8(stream([]),16),'');
});
test('limits count UTF-8 bytes and cancel before consuming the remainder',async()=>{
 let cancelled=false,read=0;const body=new ReadableStream<Uint8Array>({pull(controller){read++;controller.enqueue(bytes('🚀'))},cancel(){cancelled=true}},{highWaterMark:0});
 await assert.rejects(boundedUtf8(body,3),(error:unknown)=>error instanceof BoundedTextError&&error.code==='BYTE_LIMIT');assert.equal(cancelled,true);assert.equal(read,1);assert.equal(body.locked,false);
});
test('exact limit is accepted and one excess byte is refused across chunks',async()=>{
 assert.equal(await boundedUtf8(stream([bytes('ab'),bytes('c')]),3),'abc');await assert.rejects(boundedUtf8(stream([bytes('ab'),bytes('cd')]),3),(error:unknown)=>error instanceof BoundedTextError&&error.code==='BYTE_LIMIT');
});
test('invalid and incomplete UTF-8 cannot be silently replaced; streams unlock',async()=>{
 for(const chunk of [new Uint8Array([0xc0,0xaf]),new Uint8Array([0xed,0xa0,0x80]),new Uint8Array([0xf0,0x9f])]){const body=stream([chunk]);await assert.rejects(boundedUtf8(body,16),(error:unknown)=>error instanceof BoundedTextError&&error.code==='INVALID_UTF8');assert.equal(body.locked,false)}
});
test('underlying stream failures retain their error and impossible limits fail before reads',async()=>{
 const failure=Error('SYNTHETIC_STREAM_ERROR'),body=new ReadableStream<Uint8Array>({start(controller){controller.error(failure)}});await assert.rejects(boundedUtf8(body,16),error=>error===failure);assert.equal(body.locked,false);
 for(const value of [0,-1,1.5,1048577,Infinity])await assert.rejects(boundedUtf8(null,value),/INVALID_TEXT_LIMIT/);
});

test('aborting a stalled body cancels its stream and releases the pending read',async()=>{
 let cancelled=false;const body=new ReadableStream<Uint8Array>({cancel(){cancelled=true}}),controller=new AbortController(),failure=Error('SYNTHETIC_DEADLINE');const reading=boundedUtf8(body,16,controller.signal);controller.abort(failure);await assert.rejects(reading,error=>error===failure);assert.equal(cancelled,true);assert.equal(body.locked,false);
});
test('a cancelled request is rejected before locking or reading its body',async()=>{
 const body=stream([bytes('abc')]),controller=new AbortController(),failure=Error('SYNTHETIC_REQUEST_CANCEL');controller.abort(failure);await assert.rejects(boundedUtf8(body,16,controller.signal),error=>error===failure);assert.equal(body.locked,false);
});

test('real loopback fetch cancels an oversized HTTP body without draining it',{timeout:5000},async()=>{
 let closed!:()=>void;const connectionClosed=new Promise<void>(resolve=>{closed=resolve});
 const server=createServer((_request,response)=>{response.writeHead(200,{'Content-Type':'application/json'});response.write('x'.repeat(32));const timer=setInterval(()=>response.write('x'.repeat(32)),5);response.once('close',()=>{clearInterval(timer);closed()})});server.listen(0,'127.0.0.1');await once(server,'listening');
 try{const address=server.address();assert.ok(address&&typeof address!=='string');const response=await fetch('http://127.0.0.1:'+address.port);await assert.rejects(fixtureDeadline(boundedUtf8(response.body,16)),(error:unknown)=>error instanceof BoundedTextError&&error.code==='BYTE_LIMIT');await fixtureDeadline(connectionClosed);assert.equal(response.body!.locked,false)}finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
});
test('real loopback fetch deadline cancels a stalled HTTP response after headers',{timeout:5000},async()=>{
 let closed!:()=>void;const connectionClosed=new Promise<void>(resolve=>{closed=resolve});
 const server=createServer((_request,response)=>{response.writeHead(200,{'Content-Type':'application/json'});response.write('{"pending":');response.once('close',closed)});server.listen(0,'127.0.0.1');await once(server,'listening');
 try{const address=server.address();assert.ok(address&&typeof address!=='string');const response=await fetch('http://127.0.0.1:'+address.port);const signal=AbortSignal.timeout(50);await assert.rejects(fixtureDeadline(boundedUtf8(response.body,1024,signal)),error=>error===signal.reason);await fixtureDeadline(connectionClosed);assert.equal(response.body!.locked,false)}finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
});
