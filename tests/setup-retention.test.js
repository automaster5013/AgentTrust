import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { initializeSeedData } from '../scripts/setup.mjs';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

test('repeated setup never reseeds existing projects or rewrites credentials',async()=>{
  const file='.local/credentials.json',before=digest(await readFile(file)),queries=[];
  const client={query:async sql=>{queries.push(sql);assert.ok(!/INSERT|UPDATE|DELETE/.test(sql));return {rows:[{count:'2'}]};},release:()=>{}};const database={connect:async()=>client};
  assert.deepEqual(await initializeSeedData(database,{credentialsFile:file}),{seeded:false});
  assert.deepEqual(queries,['BEGIN','SELECT pg_advisory_xact_lock(4310002)','SELECT count(*) FROM agenttrust.organizations','COMMIT']);assert.equal(digest(await readFile(file)),before);
});

test('an empty database cannot overwrite pre-existing recovery credentials',async()=>{
  const file='.local/credentials.json',before=digest(await readFile(file));
  const client={query:async sql=>{assert.ok(!/INSERT|UPDATE|DELETE/.test(sql));return {rows:[{count:'0'}]};},release:()=>{}};const database={connect:async()=>client};
  await assert.rejects(initializeSeedData(database,{credentialsFile:file}),/credentials must be preserved/);assert.equal(digest(await readFile(file)),before);
});
