import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir,writeFile,unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { backupPath,verifyBackup } from '../scripts/recovery.mjs';

test('recovery accepts only generated backup names within the private backup directory',()=>{
  for(const name of ['../agenttrust.dump','C:\\Windows\\backup.dump','agenttrust.dump','agenttrust-'+randomUUID()+'.dump/../other',''])assert.throws(()=>backupPath(name));
  assert.match(backupPath('agenttrust-'+randomUUID()+'.dump'),/\.local[\\/]backups[\\/]agenttrust-/);
});
test('corrupt backup data is rejected before any restore database is created',async t=>{
  const name='agenttrust-'+randomUUID()+'.dump',path=backupPath(name);
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  await writeFile(path,'synthetic corrupt backup',{flag:'wx',mode:0o600});
  t.after(async()=>{await unlink(path);await unlink(path+'.manifest.json');});
  await writeFile(path+'.manifest.json',JSON.stringify({schemaVersion:1,name,sha256:'a'.repeat(64),tables:{}}),{flag:'wx',mode:0o600});
  await assert.rejects(verifyBackup(name),/checksum mismatch/);
});
