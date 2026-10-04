import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {validateLocalSetup} from '../scripts/setup-target.mjs';
const exec=promisify(execFile);
function configuration(){
 const env={PORT:'4310',DB_PORT:'55432',DB_OWNER_PASSWORD:'a'.repeat(48),DB_API_PASSWORD:'b'.repeat(48),DB_WORKER_PASSWORD:'c'.repeat(48)};
 for(const [prefix,role,key] of [['OWNER_','owner','DB_OWNER_PASSWORD'],['','api','DB_API_PASSWORD'],['WORKER_','worker','DB_WORKER_PASSWORD']]){
  for(const [test,db] of [['','agenttrust'],['TEST_','agenttrust_test']])env[test+prefix+'DATABASE_URL']=`postgres://agenttrust_${role}:${env[key]}@127.0.0.1:55432/${db}`;
 }
 return env;
}
test('setup target validation binds every role and main/test URL to the local configured port',()=>{
 const valid=configuration();assert.deepEqual(validateLocalSetup(valid),{localDatabaseConfigurationVerified:true,apiPort:4310,databasePort:55432});
 const custom={...valid,PORT:'4311',DB_PORT:'55433'};for(const key of Object.keys(custom).filter(k=>k.endsWith('DATABASE_URL')))custom[key]=custom[key].replace(':55432/',':55433/').replace('postgres:','postgresql:');assert.equal(validateLocalSetup(custom).databasePort,55433);
 for(const key of Object.keys(valid).filter(k=>k.endsWith('DATABASE_URL'))){
  for(const replacement of [undefined,valid[key].replace('127.0.0.1','example.com'),valid[key].replace('127.0.0.1','localhost'),valid[key].replace(':55432/',':55433/'),valid[key].replace('/agenttrust','/other'),valid[key]+'?sslmode=disable',valid[key]+'#fragment',valid[key].replace('agenttrust_owner','agenttrust_api').replace('agenttrust_worker','agenttrust_api').replace('a'.repeat(48),'d'.repeat(48)).replace('b'.repeat(48),'d'.repeat(48)).replace('c'.repeat(48),'d'.repeat(48))]){
   assert.throws(()=>validateLocalSetup({...valid,[key]:replacement}),/Invalid local database configuration/);
  }
 }
 for(const [key,value] of [['PORT','55432'],['DB_PORT','4310'],['PORT','04310'],['DB_PORT','65536'],['PORT','1023'],['DB_OWNER_PASSWORD','secret'],['DB_API_PASSWORD',''],['TEST_OWNER_DATABASE_URL',valid.OWNER_DATABASE_URL]])assert.throws(()=>validateLocalSetup({...valid,[key]:value}));
});
test('setup rejects inconsistent database configuration before invoking Docker',async t=>{
 const root=resolve('.local'),dir=await mkdtemp(join(root,'setup-target-test-'));assert.ok(dir.startsWith(root+(process.platform==='win32'?'\\':'/')));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const env=configuration();env.TEST_OWNER_DATABASE_URL=env.OWNER_DATABASE_URL;
 await writeFile(join(dir,'.env'),Object.entries(env).map(([k,v])=>`${k}=${v}`).join('\n')+'\n');
 const marker=join(dir,'docker-called');const hook=join(dir,'guard.cjs');
 await writeFile(hook,`const cp=require('node:child_process'),fs=require('node:fs');const previous=cp.execFileSync;cp.execFileSync=function(command,...args){if(command==='docker'){fs.writeFileSync(${JSON.stringify(marker)},'called');throw Error('Synthetic Docker boundary');}return previous.call(this,command,...args);};require('node:module').syncBuiltinESMExports();`);
 const childEnv={...process.env};for(const key of Object.keys(env))delete childEnv[key];delete childEnv.AGENTTRUST_RECEIPT_SIGNING_KEY_FILE;
 const result=await exec(process.execPath,['--require',hook,resolve('scripts/setup.mjs')],{cwd:dir,env:childEnv,timeout:30000,windowsHide:true}).catch(e=>e);
 assert.equal(result.code,1);assert.equal(existsSync(marker),false);assert.match(result.stderr,/local database configuration/i);assert.ok(!result.stderr.includes(env.DB_OWNER_PASSWORD));
 const after=await readFile(join(dir,'.env'),'utf8');assert.ok(after.includes('TEST_OWNER_DATABASE_URL='+env.TEST_OWNER_DATABASE_URL));
});
