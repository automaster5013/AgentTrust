import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {hash} from '../packages/contracts/hash.js';

const root=fileURLToPath(new URL('..',import.meta.url));
export function revisionMigrations(revision){
  assert.match(revision||'',/^[a-f0-9]{40}$/);
  const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:15000,maxBuffer:4194304});
  const paths=git('ls-tree','-r','--name-only',revision,'--','infra/migrations').trim().split('\n').filter(Boolean);
  assert.ok(paths.length>0&&paths.length<=1000);
  return paths.map(path=>{
    assert.match(path,/^infra\/migrations\/[0-9]{3}_[a-z0-9_]+\.sql$/);
    return {name:path.slice('infra/migrations/'.length),sql:git('show',revision+':'+path)};
  });
}
export function verifyMigrationLedger(rows,sources){
  assert.ok(Array.isArray(rows)&&Array.isArray(sources)&&sources.length>0);
  assert.equal(rows.length,sources.length);
  assert.equal(new Set(sources.map(source=>source.name)).size,sources.length);
  assert.equal(new Set(rows.map(row=>row.name)).size,rows.length);
  const applied=new Map(rows.map(row=>[row.name,row.checksum]));
  for(const source of sources){
    assert.match(source.name,/^[0-9]{3}_[a-z0-9_]+\.sql$/);
    assert.equal(typeof source.sql,'string');
    const sql=source.sql.replace(/^\uFEFF/,'').replace(/\r\n/g,'\n').trimEnd();
    assert.ok([hash(sql),hash(sql+'\n'),hash(sql+'\n\n')].includes(applied.get(source.name)));
  }
  const ordered=rows.map(({name,checksum})=>({name,checksum})).sort((a,b)=>a.name.localeCompare(b.name,'en'));
  return {migrationLedgerVerified:true,migrationCount:sources.length,migrationHash:hash(ordered)};
}
export function verifyDatabaseTarget(connectionString,config){
  const url=new URL(connectionString);
  assert.ok(['postgres:','postgresql:'].includes(url.protocol));
  assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,String(config.services.db.ports[0].published));
  assert.equal(decodeURIComponent(url.pathname),'/'+config.services.db.environment.POSTGRES_DB);
  assert.equal(decodeURIComponent(url.username),config.services.db.environment.POSTGRES_USER);
  assert.equal(decodeURIComponent(url.password),config.services.db.environment.POSTGRES_PASSWORD);
  assert.equal(url.search,'');
}
export async function readAppliedMigrations(client){
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try{
    assert.equal((await client.query('SHOW transaction_read_only')).rows[0].transaction_read_only,'on');
    const rows=(await client.query('SELECT name,checksum FROM public.agenttrust_migrations ORDER BY name')).rows;
    await client.query('ROLLBACK');return rows;
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
}
