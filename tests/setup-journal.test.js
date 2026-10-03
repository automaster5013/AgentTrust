import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir,readFile,writeFile,unlink,rmdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { initializeSeedData } from '../scripts/setup.mjs';
import { tokenHash } from '../packages/contracts/hash.js';
async function fixture(t,options={}){
 const dir='.local/bootstrap-test-'+randomUUID(),file=dir+'/credentials.json';await mkdir(dir,{mode:0o700});
 t.after(async()=>{for(const path of [file,file+'.pending'])if(existsSync(path))await unlink(path);await rmdir(dir);});
 let saved={orgs:new Map(),projects:new Map(),members:new Map(),keys:new Map()},staged,commitFailed=false,inserts=0;
 const query=async(sql,values=[])=>{
  if(sql==='BEGIN'){staged=structuredClone(saved);return {rows:[]};}
  if(sql==='ROLLBACK'){staged=null;return {rows:[]};}
  if(sql==='COMMIT'){saved=staged;staged=null;if(options.ambiguousCommit&&!commitFailed){commitFailed=true;throw new Error('Commit acknowledgement lost');}return {rows:[]};}
  const state=staged||saved;
  if(sql.includes('count(*) FROM agenttrust.organizations'))return {rows:[{count:String(state.orgs.size)}]};
  if(sql.startsWith('INSERT INTO agenttrust.organizations')){if(++inserts===2&&options.failSecondOrganization)throw new Error('Second organization failed');state.orgs.set(values[0],values[1]);}
  if(sql.startsWith('INSERT INTO agenttrust.projects'))state.projects.set(values[0],values[1]);
  if(sql.startsWith('INSERT INTO agenttrust.memberships'))state.members.set(values[0],{org:values[1],role:values[3]});
  if(sql.startsWith('INSERT INTO agenttrust.credentials'))state.keys.set(values[0],{member:values[1],hash:values[2]});
  if(sql.startsWith('SELECT id FROM agenttrust.organizations'))return {rows:values[0].filter(id=>state.orgs.has(id)).map(id=>({id}))};
  if(sql.startsWith('SELECT id FROM agenttrust.credentials'))return {rows:values[0].filter(id=>state.keys.has(id)).map(id=>({id}))};
  if(sql.startsWith('SELECT id FROM agenttrust.projects'))return {rowCount:state.projects.get(values[0])===values[1]?1:0,rows:[]};
  if(sql.includes('JOIN agenttrust.memberships')){const key=state.keys.get(values[0]),member=key&&state.members.get(key.member);return {rowCount:key?.member===values[1]&&key?.hash===values[2]&&member?.org===values[3]&&member?.role===values[4]?1:0,rows:[]};}
  return {rows:[],rowCount:1};
 };
 return {file,database:{connect:async()=>({query,release:()=>{}})},count:()=>saved.orgs.size,reset:()=>{saved={orgs:new Map(),projects:new Map(),members:new Map(),keys:new Map()};}};
}
test('initial organizations commit atomically and credentials are promoted without a journal leftover',async t=>{
 const f=await fixture(t);assert.deepEqual(await initializeSeedData(f.database,{credentialsFile:f.file}),{seeded:true});assert.equal(f.count(),2);assert.ok(existsSync(f.file));assert.ok(!existsSync(f.file+'.pending'));
 const value=JSON.parse(await readFile(f.file,'utf8'));assert.equal(value.organizations.length,2);assert.ok(value.organizations.every(o=>o.credentials.length===3));
 assert.deepEqual(await initializeSeedData(f.database,{credentialsFile:f.file}),{seeded:false});
});
test('failure creating the second organization rolls back the first and emits no credentials',async t=>{
 const f=await fixture(t,{failSecondOrganization:true});await assert.rejects(initializeSeedData(f.database,{credentialsFile:f.file}),/Second organization/);assert.equal(f.count(),0);assert.ok(!existsSync(f.file));assert.ok(!existsSync(f.file+'.pending'));
});
test('a lost commit acknowledgement preserves keys and the next setup verifies and recovers them',async t=>{
 const f=await fixture(t,{ambiguousCommit:true});await assert.rejects(initializeSeedData(f.database,{credentialsFile:f.file}),/acknowledgement/);assert.equal(f.count(),2);assert.ok(!existsSync(f.file));const pending=await readFile(f.file+'.pending','utf8');
 assert.deepEqual(await initializeSeedData(f.database,{credentialsFile:f.file}),{seeded:false,recovered:true});assert.equal(tokenHash(await readFile(f.file,'utf8')),tokenHash(pending));assert.ok(!existsSync(f.file+'.pending'));
});
test('a journal with a different credential hash is preserved and never promoted',async t=>{
 const f=await fixture(t,{ambiguousCommit:true});await assert.rejects(initializeSeedData(f.database,{credentialsFile:f.file}));
 const pending=JSON.parse(await readFile(f.file+'.pending','utf8'));pending.organizations[0].credentials[0].token='b'.repeat(64);await writeFile(f.file+'.pending',JSON.stringify(pending));
 await assert.rejects(initializeSeedData(f.database,{credentialsFile:f.file}),/does not match/);assert.ok(!existsSync(f.file));assert.ok(existsSync(f.file+'.pending'));assert.equal(f.count(),2);
});
test('a valid journal whose transaction rolled back can be replaced by a fresh atomic bootstrap',async t=>{
 const f=await fixture(t,{ambiguousCommit:true});await assert.rejects(initializeSeedData(f.database,{credentialsFile:f.file}));f.reset();
 assert.deepEqual(await initializeSeedData(f.database,{credentialsFile:f.file}),{seeded:true});assert.equal(f.count(),2);assert.ok(existsSync(f.file));assert.ok(!existsSync(f.file+'.pending'));
});
