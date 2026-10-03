import { spawn } from 'node:child_process';
import { createReadStream,createWriteStream } from 'node:fs';
import { mkdir,readFile,writeFile,rename,chmod } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { createHash,randomUUID } from 'node:crypto';
import { resolve,basename } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { pool } from '../apps/api/database.js';
import { hash } from '../packages/contracts/hash.js';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const backups=resolve(root,'.local','backups');
export function backupPath(name){
  if(typeof name!=='string'||!/^agenttrust-[a-f0-9-]{36}\.dump$/.test(name)||basename(name)!==name)throw new Error('Use a generated AgentTrust backup filename.');
  return resolve(backups,name);
}
async function fileHash(path){const sha=createHash('sha256');for await(const chunk of createReadStream(path))sha.update(chunk);return sha.digest('hex');}
async function dockerStream(args,{input,output}={}){
  const child=spawn('docker',['compose','exec','-T','db',...args],{cwd:root,stdio:[input?'pipe':'ignore',output?'pipe':'ignore','pipe'],windowsHide:true});
  let stderrSize=0;child.stderr.on('data',chunk=>{stderrSize+=chunk.length;});
  const completed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(`PostgreSQL recovery command failed (${code}; ${stderrSize} diagnostic bytes).`)));});
  try{await Promise.all([completed,...(input?[pipeline(createReadStream(input),child.stdin)]:[]),...(output?[pipeline(child.stdout,createWriteStream(output,{flags:'wx',mode:0o600}))]:[])]);}
  catch(error){child.kill();throw error;}
}
async function fingerprints(client){
  const tables=(await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='agenttrust' AND table_type='BASE TABLE' ORDER BY table_name")).rows.map(r=>r.table_name);
  const result={};
  for(const table of tables){
    if(!/^[a-z_]+$/.test(table))throw new Error('Unexpected recovery table.');
    const rows=(await client.query(`SELECT to_jsonb(t) AS row FROM agenttrust.${table} t ORDER BY to_jsonb(t)::text`)).rows.map(r=>r.row);
    result[table]={count:rows.length,hash:hash(rows)};
  }
  result.migrations={hash:hash((await client.query('SELECT name,checksum FROM public.agenttrust_migrations ORDER BY name')).rows)};
  return result;
}
export async function createBackup(){
  await mkdir(backups,{recursive:true,mode:0o700});
  const database=pool(process.env.OWNER_DATABASE_URL),client=await database.connect();
  const name=`agenttrust-${randomUUID()}.dump`,path=backupPath(name),partial=path+'.partial';
  try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await client.query("SET LOCAL TIME ZONE 'UTC'");
    const snapshot=(await client.query('SELECT pg_export_snapshot() AS id')).rows[0].id;
    const tables=await fingerprints(client);
    await dockerStream(['pg_dump','--username=agenttrust_owner','--dbname=agenttrust','--format=custom',`--snapshot=${snapshot}`],{output:partial});
    await client.query('COMMIT');await rename(partial,path);await chmod(path,0o600);
    const manifest={schemaVersion:1,name,createdAt:new Date().toISOString(),sha256:await fileHash(path),tables};
    await writeFile(path+'.manifest.json',JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
    return {name,sha256:manifest.sha256};
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
  finally{client.release();await database.end();}
}
export async function verifyBackup(name){
  const path=backupPath(name),manifest=JSON.parse(await readFile(path+'.manifest.json','utf8'));
  if(manifest.schemaVersion!==1||manifest.name!==name||manifest.sha256!==await fileHash(path))throw new Error('Backup manifest or checksum mismatch.');
  const source=pool(process.env.OWNER_DATABASE_URL),targetName='agenttrust_restore_'+randomUUID().replaceAll('-','');
  if(!/^agenttrust_restore_[a-f0-9]{32}$/.test(targetName))throw new Error('Invalid isolated recovery database.');
  let target,created=false;
  try{
    await source.query(`CREATE DATABASE "${targetName}"`);created=true;
    await dockerStream(['pg_restore','--username=agenttrust_owner',`--dbname=${targetName}`,'--no-owner','--exit-on-error','--single-transaction'],{input:path});
    const url=new URL(process.env.OWNER_DATABASE_URL);url.pathname='/'+targetName;target=pool(url.toString());
    const client=await target.connect();
    try{
      await client.query("SET TIME ZONE 'UTC'");
      if(hash(await fingerprints(client))!==hash(manifest.tables))throw new Error('Restored data fingerprints differ from the exported snapshot.');
      const tenant=(await client.query('SELECT id FROM agenttrust.organizations ORDER BY id LIMIT 1')).rows[0]?.id;
      await client.query('BEGIN');await client.query('SET LOCAL ROLE agenttrust_api');
      const empty=(await client.query('SELECT count(*) FROM agenttrust.runs')).rows[0].count;
      if(Number(empty)!==0)throw new Error('Restored tenant policies did not fail closed.');
      if(tenant){await client.query("SELECT set_config('app.organization_id',$1,true)",[tenant]);const foreign=await client.query('SELECT id FROM agenttrust.runs WHERE organization_id<>$1',[tenant]);if(foreign.rowCount)throw new Error('Restored tenant isolation failed.');}
      await client.query('ROLLBACK');
    }finally{client.release();}
    const report={schemaVersion:1,backup:name,sha256:manifest.sha256,restoredDatabase:targetName,verifiedAt:new Date().toISOString(),dataFingerprintsMatch:true,tenantPoliciesVerified:true,applicationConnectionsDisabled:true};
    await source.query(`REVOKE CONNECT ON DATABASE "${targetName}" FROM PUBLIC,agenttrust_api,agenttrust_worker`);
    await writeFile(resolve(backups,name+'.'+targetName+'.restore-report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
    return report;
  }finally{
    if(target)await target.end();
    // Retain the isolated database for diagnosis; it cannot become an application queue.
    if(created)await source.query(`REVOKE CONNECT ON DATABASE "${targetName}" FROM PUBLIC,agenttrust_api,agenttrust_worker`).catch(()=>{});
    await source.end();
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    if(process.argv[2]==='backup')console.log(JSON.stringify(await createBackup()));
    else if(process.argv[2]==='verify')console.log(JSON.stringify(await verifyBackup(process.argv[3])));
    else if(process.argv[2]==='roundtrip'){const backup=await createBackup();console.log(JSON.stringify(await verifyBackup(backup.name)));}
    else throw new Error('Use backup, verify <filename>, or roundtrip.');
  }catch{console.error('AgentTrust recovery operation failed. Inspect private backup artifacts and database state.');process.exitCode=1;}
}
