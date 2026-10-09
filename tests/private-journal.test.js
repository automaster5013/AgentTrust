import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,open,rename,unlink} from 'node:fs/promises';
import {privateJournal} from '../scripts/private-journal.mjs';
const path=()=>'.local/staging-benchmark-'+randomUUID()+'.json';
test('private journal replaces complete JSON atomically, restricts paths and refuses initialization over existing evidence',async()=>{
 await mkdir('.local',{recursive:true});const p=path(),journal=privateJournal(p);
 try{await assert.rejects(journal.checkpoint({value:1}));await journal.initialize({value:1});await journal.checkpoint({value:2});assert.deepEqual(JSON.parse(await readFile(p,'utf8')),{value:2});await assert.rejects(journal.initialize({value:3}));await assert.rejects(privateJournal(p).initialize({value:3}));assert.deepEqual(JSON.parse(await readFile(p,'utf8')),{value:2});}
 finally{await unlink(p);}
 for(const p of ['.env','.local/existing.json','../.local/staging-benchmark-'+randomUUID()+'.json','.local/staging-benchmark-'+randomUUID()+'.json/extra'])assert.throws(()=>privateJournal(p));
});
test('failed replacement preserves the previous parseable checkpoint and removes only its own temporary file',async()=>{
 const p=path();let temporary;
 const journal=privateJournal(p,{replace:async(from,to)=>{temporary=from;assert.equal(to,p);assert.deepEqual(JSON.parse(await readFile(p,'utf8')),{value:1});throw Error('Simulated replacement failure');}});
 try{await journal.initialize({value:1});await assert.rejects(journal.checkpoint({value:2}));assert.deepEqual(JSON.parse(await readFile(p,'utf8')),{value:1});await assert.rejects(readFile(temporary));}
 finally{await unlink(p);}
});
test('serialization or size failure never touches existing journal bytes or attempts a rename',async()=>{
 const p=path();let replacements=0;const journal=privateJournal(p,{replace:async(...args)=>{replacements++;return rename(...args);}});
 try{await journal.initialize({value:1});for(const value of [{big:'x'.repeat(1048576)},(()=>{const x={};x.self=x;return x;})()])await assert.rejects(journal.checkpoint(value));assert.equal(replacements,0);assert.deepEqual(JSON.parse(await readFile(p,'utf8')),{value:1});}
 finally{await unlink(p);}
});
test('concurrent checkpoints cannot replace newer evidence with an older write',async()=>{
 const p=path();let release;const gate=new Promise(resolve=>release=resolve);let entered;const wait=new Promise(resolve=>entered=resolve);
 const journal=privateJournal(p,{create:async(file,...args)=>{const h=await open(file,...args);return {close:()=>h.close(),writeFile:async data=>{if(file!==p){entered();await gate;}return h.writeFile(data);}};}});
 try{await journal.initialize({value:1});const first=journal.checkpoint({value:2});await wait;await assert.rejects(journal.checkpoint({value:3}));release();await first;assert.deepEqual(JSON.parse(await readFile(p,'utf8')),{value:2});}
 finally{release();await unlink(p);}
});
test('partial failed writes cannot corrupt the prior checkpoint and their owned temporary file is cleaned',async()=>{
 const p=path();let temporary;const journal=privateJournal(p,{create:async(file,...args)=>{const h=await open(file,...args);return {close:()=>h.close(),writeFile:async data=>{if(file===p)return h.writeFile(data);temporary=file;await h.writeFile('{');throw Error('Simulated disk failure');}};}});
 try{await journal.initialize({value:1});await assert.rejects(journal.checkpoint({value:2}));assert.deepEqual(JSON.parse(await readFile(p,'utf8')),{value:1});await assert.rejects(readFile(temporary));}
 finally{await unlink(p);if(temporary)await unlink(temporary).catch(()=>{});}
});
test('exclusive temporary creation failure never removes a file this journal did not create',async()=>{
 const p=path();let removals=0;const journal=privateJournal(p,{create:async(file,...args)=>{if(file!==p){const error=Error('Existing unrelated file');error.code='EEXIST';throw error;}return open(file,...args);},remove:async()=>{removals++;}});
 try{await journal.initialize({value:1});await assert.rejects(journal.checkpoint({value:2}));assert.equal(removals,0);assert.deepEqual(JSON.parse(await readFile(p,'utf8')),{value:1});}
 finally{await unlink(p);}
});
test('initial partial write failure removes its owned file before any business operation can begin',async()=>{
 const p=path(),journal=privateJournal(p,{create:async(file,...args)=>{const h=await open(file,...args);return {close:()=>h.close(),writeFile:async()=>{await h.writeFile('{');throw Error('Initial disk failure');}};}});
 await assert.rejects(journal.initialize({value:1}));await assert.rejects(readFile(p));
});
