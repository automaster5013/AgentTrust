import { spawn } from 'node:child_process';
import { createReadStream,createWriteStream } from 'node:fs';
import { mkdir,readFile,writeFile,rename,chmod,unlink } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { createHash,randomUUID,randomBytes } from 'node:crypto';
import { resolve,basename } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { pool } from '../apps/api/database.js';
import { hash } from '../packages/contracts/hash.js';
import { encryptBackup,decryptBackup } from '../packages/backup/cipher.js';
import { fingerprintRows } from '../packages/backup/fingerprint.js';
import {validateLocalSetup} from './setup-target.mjs';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const backups=resolve(root,'.local','backups');
const keys=resolve(root,'.local','backup-keys');
export function backupPath(name){
  if(typeof name!=='string'||!/^agenttrust-[a-f0-9-]{36}\.dump$/.test(name)||basename(name)!==name)throw new Error('Use a generated AgentTrust backup filename.');
  return resolve(backups,name);
}
async function fileHash(path){const sha=createHash('sha256');for await(const chunk of createReadStream(path))sha.update(chunk);return sha.digest('hex');}
async function dockerStream(args,{input,output,key,metadata}={}){
  const child=spawn('docker',['compose','exec','-T','db',...args],{cwd:root,stdio:[input?'pipe':'ignore',output?'pipe':'ignore','pipe'],windowsHide:true});
  let stderrSize=0;child.stderr.on('data',chunk=>{stderrSize+=chunk.length;});
  const completed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(`PostgreSQL recovery command failed (${code}; ${stderrSize} diagnostic bytes).`)));});
  let encryption;
  const destination=output?createWriteStream(output,{flags:'wx',mode:0o600}):null;
  try{await Promise.all([completed,...(input?[pipeline(createReadStream(input),child.stdin)]:[]),...(output?[key?encryptBackup(child.stdout,destination,key,metadata).then(value=>{encryption=value;}):pipeline(child.stdout,destination)]:[])]);return encryption;}
  catch(error){child.kill();throw error;}
}
async function queryFingerprint(client,query,parameters=[]){
  await client.query(`DECLARE agenttrust_fingerprint NO SCROLL CURSOR FOR ${query}`,parameters);
  async function* rows(){for(;;){const batch=await client.query('FETCH 25 FROM agenttrust_fingerprint');if(!batch.rowCount)return;for(const entry of batch.rows)yield entry.row;}}
  try{return await fingerprintRows(rows());}finally{await client.query('CLOSE agenttrust_fingerprint');}
}
async function fingerprints(client){
  const tables=(await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='agenttrust' AND table_type='BASE TABLE' ORDER BY table_name")).rows.map(r=>r.table_name);
  const result={};
  for(const table of tables){
    if(!/^[a-z_]+$/.test(table))throw new Error('Unexpected recovery table.');
    result[table]=await queryFingerprint(client,`SELECT to_jsonb(t) AS row FROM agenttrust.${table} t ORDER BY to_jsonb(t)::text`);
  }
  result.migrations={hash:hash((await client.query('SELECT name,checksum FROM public.agenttrust_migrations ORDER BY name')).rows)};
  return result;
}
export async function securityFingerprint(client,version=2){
  if(![1,2].includes(version))throw new Error("Unsupported security fingerprint version.");
  const tables=(await client.query(`SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,
    pg_get_userbyid(c.relowner) AS owner,c.relacl::text AS privileges
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='agenttrust' AND c.relkind IN ('r','S') ORDER BY c.relname`)).rows;
  const policies=(await client.query(`SELECT tablename,policyname,permissive,roles,cmd,qual,with_check
    FROM pg_policies WHERE schemaname='agenttrust' ORDER BY tablename,policyname`)).rows;
  const functions=(await client.query(`SELECT p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,
    pg_get_userbyid(p.proowner) AS owner,p.prosecdef,p.proconfig,p.proacl::text AS privileges,
    pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='agenttrust' ORDER BY p.proname,arguments`)).rows;
  const roles=(await client.query(`SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,
    rolcanlogin,rolreplication,rolbypassrls FROM pg_roles
    WHERE rolname IN ('agenttrust_api','agenttrust_worker','agenttrust_auth') ORDER BY rolname`)).rows;
  if(version===1)return hash({tables,policies,functions,roles});
  const triggers=(await client.query(`SELECT c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) AS definition
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='agenttrust' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`)).rows;
  const constraints=(await client.query(`SELECT c.relname,k.conname,k.contype,k.convalidated,k.condeferrable,k.condeferred,
    pg_get_constraintdef(k.oid) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='agenttrust' ORDER BY c.relname,k.conname`)).rows;
  const columns=(await client.query(`SELECT c.relname,a.attname,a.attnum,format_type(a.atttypid,a.atttypmod) AS type,
    a.attnotnull,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid) AS default_expression
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE n.nspname='agenttrust' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum`)).rows;
  const schemas=(await client.query(`SELECT nspname,pg_get_userbyid(nspowner) AS owner,nspacl::text AS privileges
    FROM pg_namespace WHERE nspname='agenttrust'`)).rows;
  const memberships=(await client.query(`SELECT parent.rolname AS role,member.rolname AS member,
    grantor.rolname AS grantor,m.admin_option,m.inherit_option,m.set_option
    FROM pg_auth_members m JOIN pg_roles parent ON parent.oid=m.roleid JOIN pg_roles member ON member.oid=m.member
    JOIN pg_roles grantor ON grantor.oid=m.grantor
    WHERE parent.rolname IN ('agenttrust_api','agenttrust_worker','agenttrust_auth')
      OR member.rolname IN ('agenttrust_api','agenttrust_worker','agenttrust_auth')
    ORDER BY parent.rolname,member.rolname,grantor.rolname`)).rows;
  return hash({tables,policies,functions,roles,triggers,constraints,columns,schemas,memberships});
}
export async function verifyAuthTenantPolicies(client,organizationIds=null){
  const supported=(await client.query("SELECT to_regprocedure('agenttrust.lookup_credential(text)') IS NOT NULL AS supported")).rows[0].supported;
  if(!supported)return null;
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try{
    await client.query("SET LOCAL statement_timeout='300s'");
    const organizations=(await client.query('SELECT id FROM agenttrust.organizations WHERE ($1::uuid[] IS NULL OR id=ANY($1)) ORDER BY id',[organizationIds])).rows;
    const tables=(await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='agenttrust' AND table_type='BASE TABLE' AND table_name<>'service_health' ORDER BY table_name")).rows.map(row=>row.table_name);
    for(const table of tables)if(!/^[a-z_]+$/.test(table))throw new Error('Unexpected recovery table.');
    const credential=(await client.query(`SELECT c.token_hash,m.organization_id FROM agenttrust.credentials c
      JOIN agenttrust.memberships m ON m.id=c.membership_id WHERE c.revoked_at IS NULL AND m.active ORDER BY c.id LIMIT 1`)).rows[0];
    await client.query('SET LOCAL ROLE agenttrust_api');
    for(const table of tables){if(Number((await client.query(`SELECT count(*) FROM agenttrust.${table}`)).rows[0].count)!==0)throw new Error('Restored authentication tenant policy did not fail closed.');}
    if(credential){const lookedUp=await client.query('SELECT organization_id FROM agenttrust.lookup_credential($1)',[credential.token_hash]);if(lookedUp.rowCount!==1||lookedUp.rows[0].organization_id!==credential.organization_id)throw new Error('Restored bounded credential lookup failed.');}
    await client.query('RESET ROLE');
    for(const organization of organizations){
      for(const table of tables){
        let predicate='t.organization_id=$1';
        if(table==='organizations')predicate='t.id=$1';
        if(table==='credentials')predicate='EXISTS(SELECT 1 FROM agenttrust.memberships m WHERE m.id=t.membership_id AND m.organization_id=$1)';
        if(table==='sessions')predicate='EXISTS(SELECT 1 FROM agenttrust.credentials c JOIN agenttrust.memberships m ON m.id=c.membership_id WHERE c.id=t.credential_id AND m.organization_id=$1)';
        const expected=await queryFingerprint(client,`SELECT to_jsonb(t) AS row FROM agenttrust.${table} t WHERE ${predicate} ORDER BY to_jsonb(t)::text`,[organization.id]);
        await client.query('SET LOCAL ROLE agenttrust_api');await client.query("SELECT set_config('app.organization_id',$1,true)",[organization.id]);
        const visible=await queryFingerprint(client,`SELECT to_jsonb(t) AS row FROM agenttrust.${table} t ORDER BY to_jsonb(t)::text`);
        if(hash(visible)!==hash(expected))throw new Error('Restored authentication tenant isolation failed.');
        await client.query('RESET ROLE');
      }
    }
    await client.query('ROLLBACK');return true;
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
}
export async function createBackup(){
  validateLocalSetup(process.env);
  await mkdir(backups,{recursive:true,mode:0o700});
  await mkdir(keys,{recursive:true,mode:0o700});
  const database=pool(process.env.OWNER_DATABASE_URL),client=await database.connect();
  const name=`agenttrust-${randomUUID()}.dump`,path=backupPath(name),partial=path+'.partial';
  try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await client.query("SET LOCAL TIME ZONE 'UTC'");
    await client.query("SET LOCAL statement_timeout='300s'");
    const snapshot=(await client.query('SELECT pg_export_snapshot() AS id')).rows[0].id;
    const tables=await fingerprints(client);
    const securityHash=await securityFingerprint(client);
    const metadata={schemaVersion:2,name,createdAt:new Date().toISOString(),tables,securityHash,securityVersion:2};
    const key=randomBytes(32);await writeFile(resolve(keys,name+'.key'),key,{flag:'wx',mode:0o600});
    const encryption=await dockerStream(['pg_dump','--username=agenttrust_owner','--dbname=agenttrust','--format=custom',`--snapshot=${snapshot}`],{output:partial,key,metadata});
    await client.query('COMMIT');await rename(partial,path);await chmod(path,0o600);
    const manifest={...metadata,sha256:await fileHash(path),encryption};
    await writeFile(path+'.manifest.json',JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
    return {name,sha256:manifest.sha256};
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
  finally{client.release();await database.end();}
}
export async function verifyBackup(name){
  validateLocalSetup(process.env);
  const path=backupPath(name),manifest=JSON.parse(await readFile(path+'.manifest.json','utf8'));
  if(![1,2].includes(manifest.schemaVersion)||manifest.name!==name||manifest.sha256!==await fileHash(path))throw new Error('Backup manifest or checksum mismatch.');
  let restorePath=path,temporary;
  if(manifest.schemaVersion===2){
    const {sha256,encryption,...metadata}=manifest,key=await readFile(resolve(keys,name+'.key'));
    temporary=resolve(backups,'authenticated-'+randomUUID()+'.partial');
    try{await decryptBackup(createReadStream(path),createWriteStream(temporary,{flags:'wx',mode:0o600}),key,metadata,encryption);restorePath=temporary;}
    catch(error){await unlink(temporary).catch(()=>{});throw error;}
  }
  const source=pool(process.env.OWNER_DATABASE_URL),targetName='agenttrust_restore_'+randomUUID().replaceAll('-','');
  if(!/^agenttrust_restore_[a-f0-9]{32}$/.test(targetName))throw new Error('Invalid isolated recovery database.');
  let target,created=false;
  try{
    await source.query(`CREATE DATABASE "${targetName}"`);created=true;
    await source.query(`REVOKE CONNECT ON DATABASE "${targetName}" FROM PUBLIC,agenttrust_api,agenttrust_worker`);
    // Preserve function owners and grants; all required roles exist in this local cluster.
    await dockerStream(['pg_restore','--username=agenttrust_owner',`--dbname=${targetName}`,'--exit-on-error','--single-transaction'],{input:restorePath});
    const url=new URL(process.env.OWNER_DATABASE_URL);url.pathname='/'+targetName;target=pool(url.toString());
    const client=await target.connect();let authTenantPoliciesVerified;
    try{
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await client.query("SET LOCAL TIME ZONE 'UTC'");await client.query("SET LOCAL statement_timeout='300s'");
      if(hash(await fingerprints(client))!==hash(manifest.tables))throw new Error('Restored data fingerprints differ from the exported snapshot.');
      if(manifest.securityHash && await securityFingerprint(client,manifest.securityVersion??1)!==manifest.securityHash)throw new Error('Restored security catalog differs from the exported snapshot.');
      await client.query('COMMIT');
      const tenant=(await client.query('SELECT id FROM agenttrust.organizations ORDER BY id LIMIT 1')).rows[0]?.id;
      await client.query('BEGIN');await client.query('SET LOCAL ROLE agenttrust_api');
      const empty=(await client.query('SELECT count(*) FROM agenttrust.runs')).rows[0].count;
      if(Number(empty)!==0)throw new Error('Restored tenant policies did not fail closed.');
      if(tenant){await client.query("SELECT set_config('app.organization_id',$1,true)",[tenant]);const foreign=await client.query('SELECT id FROM agenttrust.runs WHERE organization_id<>$1',[tenant]);if(foreign.rowCount)throw new Error('Restored tenant isolation failed.');}
      await client.query('ROLLBACK');
      authTenantPoliciesVerified=await verifyAuthTenantPolicies(client);
    }finally{await client.query('ROLLBACK').catch(()=>{});client.release();}
    const report={schemaVersion:1,backup:name,sha256:manifest.sha256,restoredDatabase:targetName,verifiedAt:new Date().toISOString(),dataFingerprintsMatch:true,securityCatalogMatch:manifest.securityHash?true:null,tenantPoliciesVerified:true,authTenantPoliciesVerified,applicationConnectionsDisabled:true};
    await source.query(`REVOKE CONNECT ON DATABASE "${targetName}" FROM PUBLIC,agenttrust_api,agenttrust_worker`);
    await writeFile(resolve(backups,name+'.'+targetName+'.restore-report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
    return report;
  }finally{
    if(target)await target.end();
    // Retain the isolated database for diagnosis; it cannot become an application queue.
    if(created)await source.query(`REVOKE CONNECT ON DATABASE "${targetName}" FROM PUBLIC,agenttrust_api,agenttrust_worker`).catch(()=>{});
    await source.end();
    if(temporary)await unlink(temporary);
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
