import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { initializeSeedData } from '../scripts/setup.mjs';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

test('repeated setup never reseeds existing projects or rewrites credentials',async()=>{
  const file='.local/credentials.json',before=digest(await readFile(file)),queries=[];
  const database={query:async sql=>{queries.push(sql);return {rows:[{count:'2'}]};},connect:()=>{throw new Error('Existing data must not be mutated.');}};
  assert.deepEqual(await initializeSeedData(database,{credentialsFile:file}),{seeded:false});
  assert.deepEqual(queries,['SELECT count(*) FROM agenttrust.organizations']);assert.equal(digest(await readFile(file)),before);
});

test('an empty database cannot overwrite pre-existing recovery credentials',async()=>{
  const file='.local/credentials.json',before=digest(await readFile(file));
  const database={query:async()=>({rows:[{count:'0'}]}),connect:()=>{throw new Error('Must reject before seed writes.');}};
  await assert.rejects(initializeSeedData(database,{credentialsFile:file}),/credentials must be preserved/);assert.equal(digest(await readFile(file)),before);
});
