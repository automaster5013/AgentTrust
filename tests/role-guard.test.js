import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDatabaseRole } from '../apps/api/role-guard.js';
import { pool } from '../apps/api/database.js';

test('role guard rejects owner access and every escalation capability',async()=>{
  const safe={rolname:'agenttrust_api',rolcanlogin:true,rolbypassrls:false,rolsuper:false,rolcreaterole:false,rolcreatedb:false,rolreplication:false,memberships:false,schema_create:false,database_create:false,owns_tables:false,owns_functions:false};
  const database=row=>({query:async()=>({rows:row?[row]:[]})});
  await validateDatabaseRole(database(safe),'api');
  await validateDatabaseRole(database({...safe,rolname:'agenttrust_worker',rolbypassrls:true}),'worker');
  await assert.rejects(validateDatabaseRole(database({...safe,rolname:'agenttrust_worker'}),'worker'),/Unsafe/);
  for(const flag of ['rolsuper','rolcreaterole','rolcreatedb','rolreplication','memberships','schema_create','database_create','owns_tables','owns_functions','rolbypassrls'])await assert.rejects(validateDatabaseRole(database({...safe,[flag]:true}),'api'),/Unsafe/);
  for(const row of [null,{...safe,rolname:'agenttrust_owner'},{...safe,rolcanlogin:false},{...safe,memberships:undefined}])await assert.rejects(validateDatabaseRole(database(row),'api'),/Unsafe/);
  await assert.rejects(validateDatabaseRole(database(safe),'owner'),/Unknown/);
});

test('actual API and worker principals pass while the migration owner is refused',async()=>{
  const api=pool(process.env.TEST_DATABASE_URL),worker=pool(process.env.TEST_WORKER_DATABASE_URL),owner=pool(process.env.TEST_OWNER_DATABASE_URL);
  try{await validateDatabaseRole(api,'api');await validateDatabaseRole(worker,'worker');await assert.rejects(validateDatabaseRole(owner,'api'),/Unsafe/);}
  finally{await Promise.all([api.end(),worker.end(),owner.end()]);}
});
