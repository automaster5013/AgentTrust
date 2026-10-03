import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Readable,Writable } from 'node:stream';
import { encryptBackup,decryptBackup } from '../packages/backup/cipher.js';

function sink(){const chunks=[];return {stream:new Writable({write(chunk,encoding,done){chunks.push(Buffer.from(chunk));done();}}),bytes:()=>Buffer.concat(chunks)};}
test('backup encryption authenticates bytes, key and recovery metadata',async()=>{
  const key=randomBytes(32),plain=Buffer.from('Synthetic PostgreSQL backup evidence'.repeat(10000)),metadata={name:'example',tables:{runs:{count:3,hash:'a'.repeat(64)}}};
  const encrypted=sink(),encryption=await encryptBackup(Readable.from([plain]),encrypted.stream,key,metadata),cipher=encrypted.bytes();
  assert.equal(cipher.includes(plain.subarray(0,100)),false);
  const restored=sink();await decryptBackup(Readable.from([cipher]),restored.stream,key,metadata,encryption);assert.deepEqual(restored.bytes(),plain);
  for(const scenario of [
    {bytes:cipher,key:randomBytes(32),metadata,encryption},
    {bytes:Buffer.concat([cipher.subarray(0,-1),Buffer.from([cipher.at(-1)^1])]),key,metadata,encryption},
    {bytes:cipher.subarray(0,-10),key,metadata,encryption},
    {bytes:cipher,key,metadata:{...metadata,name:'changed'},encryption},
    {bytes:cipher,key,metadata,encryption:{...encryption,tag:'00'.repeat(16)}},
    {bytes:cipher,key,metadata,encryption:{...encryption,algorithm:'aes-256-cbc'}}
  ])await assert.rejects(decryptBackup(Readable.from([scenario.bytes]),sink().stream,scenario.key,scenario.metadata,scenario.encryption));
});
test('backup encryption uses a fresh nonce and rejects invalid key lengths',async()=>{
  const key=randomBytes(32),outputs=[];
  for(let i=0;i<2;i++)outputs.push(await encryptBackup(Readable.from(['same']),sink().stream,key,{}));
  assert.notEqual(outputs[0].nonce,outputs[1].nonce);
  await assert.rejects(encryptBackup(Readable.from(['same']),sink().stream,Buffer.alloc(16),{}),/32 bytes/);
});
