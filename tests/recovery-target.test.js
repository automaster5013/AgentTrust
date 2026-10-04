import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
test('backup and recovery smoke reject foreign configuration before creating a database pool',async t=>{
 const root=resolve('.local'),dir=await mkdtemp(join(root,'recovery-target-test-'));assert.ok(dir.startsWith(root+sep));t.after(()=>rm(dir,{recursive:true,force:true}));
 const marker=join(dir,'pool-created'),hook=join(dir,'guard.cjs');await writeFile(hook,`const pg=require('pg'),fs=require('node:fs');pg.Pool=class{constructor(){fs.writeFileSync(${JSON.stringify(marker)},'created');}on(){}async connect(){throw Error('Synthetic pool boundary');}async end(){}};`);
 const env={...process.env,PORT:'4310',DB_PORT:'55432',DB_OWNER_PASSWORD:'a'.repeat(48),DB_API_PASSWORD:'b'.repeat(48),DB_WORKER_PASSWORD:'c'.repeat(48)};
 for(const [prefix,role,key] of [['OWNER_','owner','DB_OWNER_PASSWORD'],['','api','DB_API_PASSWORD'],['WORKER_','worker','DB_WORKER_PASSWORD']])for(const [test,db] of [['','agenttrust'],['TEST_','agenttrust_test']])env[test+prefix+'DATABASE_URL']=`postgres://agenttrust_${role}:${env[key]}@127.0.0.1:55432/${db}`;
 env.OWNER_DATABASE_URL=env.OWNER_DATABASE_URL.replace('127.0.0.1','example.invalid');
 for(const script of [['scripts/recovery.mjs','backup'],['scripts/recovery-smoke.mjs']]){
  const result=await exec(process.execPath,['--require',hook,...script],{cwd:process.cwd(),env,timeout:15000,windowsHide:true}).catch(e=>e);assert.equal(result.code,1);assert.equal(existsSync(marker),false);assert.equal(result.stdout,'');assert.ok(!result.stderr.includes('example.invalid'));assert.ok(!result.stderr.includes('a'.repeat(48)));
 }
 const source=`import {verifyBackup} from './scripts/recovery.mjs';try{await verifyBackup('agenttrust-00000000-0000-0000-0000-000000000000.dump');process.exitCode=1;}catch(error){console.log(JSON.stringify({configurationRejected:error.message.startsWith('Invalid local database configuration.')}));}`;
 const result=await exec(process.execPath,['--input-type=module','-e',source],{cwd:process.cwd(),env,timeout:15000,windowsHide:true});assert.equal(JSON.parse(result.stdout).configurationRejected,true);
});
