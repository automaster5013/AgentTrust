import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir,writeFile,unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { backupPath,verifyBackup,securityFingerprint } from '../scripts/recovery.mjs';
import { pool } from '../apps/api/database.js';

test('recovery accepts only generated backup names within the private backup directory',()=>{
  for(const name of ['../agenttrust.dump','C:\\Windows\\backup.dump','agenttrust.dump','agenttrust-'+randomUUID()+'.dump/../other',''])assert.throws(()=>backupPath(name));
  assert.match(backupPath('agenttrust-'+randomUUID()+'.dump'),/\.local[\\/]backups[\\/]agenttrust-/);
});

test('CI lookup owner cannot log in, modify credentials or read evaluation data',async()=>{
  assert.equal(new URL(process.env.TEST_OWNER_DATABASE_URL).pathname,'/agenttrust_test');
  const database=pool(process.env.TEST_OWNER_DATABASE_URL);
  try{
    const role=(await database.query("SELECT rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolreplication FROM pg_roles WHERE rolname='agenttrust_auth'")).rows[0];
    assert.ok(role);assert.ok(Object.values(role).every(value=>value===false));
    const rights=(await database.query(`SELECT
      has_table_privilege('agenttrust_auth','agenttrust.ci_credentials','SELECT') AS ci_read,
      has_table_privilege('agenttrust_auth','agenttrust.memberships','SELECT') AS member_read,
      has_table_privilege('agenttrust_auth','agenttrust.ci_credentials','UPDATE') AS ci_write,
      has_table_privilege('agenttrust_auth','agenttrust.runs','SELECT') AS run_read,
      has_table_privilege('agenttrust_auth','agenttrust.versions','SELECT') AS version_read,
      has_function_privilege('agenttrust_api','agenttrust.authenticate_ci(text)','EXECUTE') AS api_execute,
      pg_get_userbyid(proowner) AS owner FROM pg_proc
      WHERE oid='agenttrust.authenticate_ci(text)'::regprocedure`)).rows[0];
    assert.deepEqual(rights,{ci_read:true,member_read:true,ci_write:false,run_read:false,version_read:false,api_execute:true,owner:'agenttrust_auth'});
    const client=await database.connect();
    try{
      await client.query('BEGIN');const before=await securityFingerprint(client);
      await client.query("ALTER FUNCTION agenttrust.authenticate_ci(text) SET search_path TO public");
      assert.notEqual(await securityFingerprint(client),before);
      await client.query('ROLLBACK');
    }finally{await client.query('ROLLBACK').catch(()=>{});client.release();}
  }finally{await database.end();}
});
test('corrupt backup data is rejected before any restore database is created',async t=>{
  const name='agenttrust-'+randomUUID()+'.dump',path=backupPath(name);
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  await writeFile(path,'synthetic corrupt backup',{flag:'wx',mode:0o600});
  t.after(async()=>{await unlink(path);await unlink(path+'.manifest.json');});
  await writeFile(path+'.manifest.json',JSON.stringify({schemaVersion:1,name,sha256:'a'.repeat(64),tables:{}}),{flag:'wx',mode:0o600});
  await assert.rejects(verifyBackup(name),/checksum mismatch/);
});
