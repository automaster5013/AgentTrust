import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import pg from 'pg';
import {hash} from '../packages/contracts/hash.js';
import {revisionMigrations,verifyMigrationLedger,verifyDatabaseTarget,readAppliedMigrations} from '../scripts/deployment-schema.mjs';

test('migration gate rejects missing, extra, duplicate or changed applied migrations',()=>{
  const sources=[{name:'001_initial.sql',sql:'SELECT 1;\n'},{name:'002_next.sql',sql:'\uFEFFSELECT 2;\r\n'}];
  const rows=[{name:'001_initial.sql',checksum:hash('SELECT 1;')},{name:'002_next.sql',checksum:hash('SELECT 2;\n')}];
  assert.equal(verifyMigrationLedger(rows,sources).migrationCount,2);
  assert.equal(verifyMigrationLedger([...rows].reverse(),sources).migrationHash,verifyMigrationLedger(rows,sources).migrationHash);
  for(const invalid of [rows.slice(1),[...rows,{name:'003_future.sql',checksum:hash('SELECT 3;')}],[rows[0],rows[0]],[rows[0],{...rows[1],checksum:hash('SELECT 999;')}]])assert.throws(()=>verifyMigrationLedger(invalid,sources));
  assert.throws(()=>verifyMigrationLedger(rows,[sources[0],{...sources[1],sql:'SELECT 999;'}]));
});
test('preflight database target is bound to the selected loopback compose database',()=>{
  const config={services:{db:{ports:[{published:'55432'}],environment:{POSTGRES_DB:'agenttrust',POSTGRES_USER:'agenttrust_owner',POSTGRES_PASSWORD:'synthetic-password'}}}};
  const valid='postgres://agenttrust_owner:synthetic-password@127.0.0.1:55432/agenttrust';
  verifyDatabaseTarget(valid,config);
  for(const invalid of [valid.replace('127.0.0.1','example.com'),valid.replace('55432','5432'),valid.replace('/agenttrust','/other'),valid.replace('agenttrust_owner','other'),valid.replace('synthetic-password','wrong'),valid+'?options=anything'])assert.throws(()=>verifyDatabaseTarget(invalid,config));
});
test('real database migration ledger matches committed revision using a read-only transaction',async()=>{
  assert.ok(process.env.TEST_OWNER_DATABASE_URL,'Test database must be prepared with npm run setup.');
  const client=new pg.Client({connectionString:process.env.TEST_OWNER_DATABASE_URL,connectionTimeoutMillis:5000,statement_timeout:5000});
  try{
    await client.connect();
    const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
    const rows=await readAppliedMigrations(client);
    assert.equal(verifyMigrationLedger(rows,revisionMigrations(revision)).migrationLedgerVerified,true);
    await client.query('BEGIN READ ONLY');
    await assert.rejects(client.query('UPDATE public.agenttrust_migrations SET checksum=checksum WHERE false'),error=>error.code==='25006');
    await client.query('ROLLBACK');
    assert.deepEqual(await readAppliedMigrations(client),rows);
    assert.equal((await client.query('SHOW transaction_read_only')).rows[0].transaction_read_only,'off');
  }finally{await client.end();}
});
