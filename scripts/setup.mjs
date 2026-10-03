import { randomBytes, randomUUID,generateKeyPairSync,createPrivateKey,createPublicKey } from 'node:crypto';
import { mkdir, readFile, writeFile, chmod, link, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pool, transaction } from '../apps/api/database.js';
import { migrate } from './migrate.mjs';
import { hash, tokenHash } from '../packages/contracts/hash.js';
import { sampleDataset, modes } from '../packages/contracts/samples.js';

export async function seedOrganization(database,name,actors=['admin','editor','viewer']) {
  return transaction(database,client=>seedOrganizationRows(client,name,actors));
}
async function seedOrganizationRows(client,name,actors=['admin','editor','viewer']) {
    const organizationId = randomUUID(), projectId = randomUUID();
    await client.query('INSERT INTO agenttrust.organizations(id,name) VALUES($1,$2)', [organizationId,name]);
    await client.query('INSERT INTO agenttrust.projects(id,organization_id,name) VALUES($1,$2,$3)', [projectId,organizationId,'Agent release checks']);
    const credentials = [];
    for (const role of actors) {
      const membershipId = randomUUID(), token = randomBytes(32).toString('hex'), id = randomUUID();
      await client.query('INSERT INTO agenttrust.memberships(id,organization_id,name,role) VALUES($1,$2,$3,$4)', [membershipId,organizationId,`${name} ${role}`,role]);
      await client.query('INSERT INTO agenttrust.credentials(id,membership_id,token_hash) VALUES($1,$2,$3)', [id,membershipId,tokenHash(token)]);
      credentials.push({ id, role, token, organizationId, membershipId });
    }
    const versions = [ ...modes.map(([mode,name]) => ['agent',{name,mode}]), ['dataset',sampleDataset], ['policy',{name:'필수 검증 전체 통과',minimumPassRate:1}] ];
    for (const [kind,data] of versions) await client.query('INSERT INTO agenttrust.versions(id,organization_id,project_id,kind,data,content_hash) VALUES($1,$2,$3,$4,$5,$6)', [randomUUID(),organizationId,projectId,kind,data,hash(data)]);
    return { organizationId, projectId, name, credentials };
}
// A private journal bridges the database commit and the exclusive credential-file promotion.
function validSeedJournal(value){
  const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
  if(!value||Object.keys(value).join(',')!=='organizations'||!Array.isArray(value.organizations)||value.organizations.length!==2)return false;
  const ids=new Set();
  for(const org of value.organizations){
    if(!uuid(org.organizationId)||!uuid(org.projectId)||typeof org.name!=='string'||!Array.isArray(org.credentials)||org.credentials.length!==3)return false;
    for(const id of [org.organizationId,org.projectId]){if(ids.has(id))return false;ids.add(id);}
    const roles=new Set();
    for(const key of org.credentials){
      if(!uuid(key.id)||!uuid(key.membershipId)||key.organizationId!==org.organizationId||typeof key.token!=='string'||!/^[a-f0-9]{64}$/.test(key.token)||!['admin','editor','viewer'].includes(key.role)||roles.has(key.role))return false;
      roles.add(key.role);
      for(const id of [key.id,key.membershipId]){if(ids.has(id))return false;ids.add(id);}
    }
  }
  return true;
}
async function recoverSeedJournal(client,credentialsFile,pendingFile){
  if(!existsSync(pendingFile))return false;
  let journal;try{journal=JSON.parse(await readFile(pendingFile,'utf8'));}catch{throw new Error('Seed credential journal requires private recovery review.');}
  if(!validSeedJournal(journal))throw new Error('Seed credential journal requires private recovery review.');
  const orgIds=journal.organizations.map(o=>o.organizationId);
  const present=(await client.query('SELECT id FROM agenttrust.organizations WHERE id=ANY($1::uuid[])',[orgIds])).rows;
  if(!present.length){
    const credentialIds=journal.organizations.flatMap(o=>o.credentials.map(k=>k.id));
    if((await client.query('SELECT id FROM agenttrust.credentials WHERE id=ANY($1::uuid[])',[credentialIds])).rows.length)throw new Error('Seed credential journal does not match database state.');
    await unlink(pendingFile);return false;
  }
  if(present.length!==orgIds.length)throw new Error('Seed credential journal does not match database state.');
  for(const org of journal.organizations){
    if(!(await client.query('SELECT id FROM agenttrust.projects WHERE id=$1 AND organization_id=$2',[org.projectId,org.organizationId])).rowCount)throw new Error('Seed credential journal does not match database state.');
    for(const key of org.credentials){
      const match=await client.query(`SELECT c.id FROM agenttrust.credentials c JOIN agenttrust.memberships m ON m.id=c.membership_id
        WHERE c.id=$1 AND c.membership_id=$2 AND c.token_hash=$3 AND m.organization_id=$4 AND m.role=$5 AND m.active=true AND c.revoked_at IS NULL`,[key.id,key.membershipId,tokenHash(key.token),org.organizationId,key.role]);
      if(!match.rowCount)throw new Error('Seed credential journal does not match database state.');
    }
  }
  await link(pendingFile,credentialsFile);await unlink(pendingFile);return true;
}
// Existing project content, including intentionally empty workspaces, is never reseeded.
export async function initializeSeedData(database,{credentialsFile='.local/credentials.json'}={}) {
  const pendingFile=credentialsFile+'.pending';let serialized;
  const result=await transaction(database,async client=>{
    await client.query('SELECT pg_advisory_xact_lock(4310002)');
    if(!existsSync(credentialsFile)&&await recoverSeedJournal(client,credentialsFile,pendingFile))return {seeded:false,recovered:true};
    const count=await client.query('SELECT count(*) FROM agenttrust.organizations');
    if(Number(count.rows[0].count)!==0){
      if(!existsSync(credentialsFile))console.log('Existing data retained. Local access keys are not regenerated; restore the existing credentials file.');
      return {seeded:false};
    }
    if(existsSync(credentialsFile))throw new Error('Existing credentials must be preserved; restore their database before initializing new seed data.');
    const organizations=[await seedOrganizationRows(client,'AgentTrust Development'),await seedOrganizationRows(client,'Isolation Demo')];
    serialized=JSON.stringify({organizations},null,2)+'\n';
    await writeFile(pendingFile,serialized,{flag:'wx',mode:0o600});
    return {seeded:true};
  });
  if(result.seeded){
    try{await link(pendingFile,credentialsFile);}catch(error){
      if(!['EEXIST','ENOENT'].includes(error.code)||await readFile(credentialsFile,'utf8')!==serialized)throw error;
    }
    try{await unlink(pendingFile);}catch(error){if(error.code!=='ENOENT')throw error;}
  }
  return result;
}
async function main() {
  await mkdir('.local', { recursive: true,mode:0o700 });
  await mkdir('.local/receipt-signing',{recursive:true,mode:0o700});
  if(process.platform==='win32')execFileSync('icacls',['.local','/inheritance:r','/grant:r',`${process.env.USERNAME}:(OI)(CI)F`,'*S-1-5-18:(OI)(CI)F'],{stdio:'ignore'});
  else{await chmod('.local',0o700);await chmod('.local/receipt-signing',0o700);}
  if(!existsSync('.local/receipt-signing/private.pem')){
    const pair=generateKeyPairSync('ed25519');
    await writeFile('.local/receipt-signing/private.pem',pair.privateKey.export({type:'pkcs8',format:'pem'}),{flag:'wx',mode:0o600});
  }
  const signingPublic=createPublicKey(createPrivateKey(await readFile('.local/receipt-signing/private.pem','utf8'))).export({type:'spki',format:'pem'});
  if(!existsSync('.local/receipt-signing/public.pem'))await writeFile('.local/receipt-signing/public.pem',signingPublic,{flag:'wx',mode:0o600});
  else if(await readFile('.local/receipt-signing/public.pem','utf8')!==signingPublic)throw new Error('Receipt signing key pair mismatch. Preserve the private files and review their origin.');
  if (!existsSync('.env')) {
    const owner = randomBytes(24).toString('hex'), api = randomBytes(24).toString('hex'), worker = randomBytes(24).toString('hex');
    const env = [ 'PORT=4310', 'DB_PORT=55432', `DB_OWNER_PASSWORD=${owner}`, `DB_API_PASSWORD=${api}`, `DB_WORKER_PASSWORD=${worker}`,
      `OWNER_DATABASE_URL=postgres://agenttrust_owner:${owner}@127.0.0.1:55432/agenttrust`,
      `DATABASE_URL=postgres://agenttrust_api:${api}@127.0.0.1:55432/agenttrust`,
      `WORKER_DATABASE_URL=postgres://agenttrust_worker:${worker}@127.0.0.1:55432/agenttrust`,
      `TEST_OWNER_DATABASE_URL=postgres://agenttrust_owner:${owner}@127.0.0.1:55432/agenttrust_test`,
      `TEST_DATABASE_URL=postgres://agenttrust_api:${api}@127.0.0.1:55432/agenttrust_test`,
      `TEST_WORKER_DATABASE_URL=postgres://agenttrust_worker:${worker}@127.0.0.1:55432/agenttrust_test`
    ].join('\n')+'\n';
    await writeFile('.env',env, { mode: 0o600 });
  }
  if(process.platform==='win32')execFileSync('icacls',['.env','/inheritance:r','/grant:r',`${process.env.USERNAME}:(F)`,'*S-1-5-18:(F)'],{stdio:'ignore'});
  else await chmod('.env',0o600);
  process.loadEnvFile('.env');
  if(!process.env.AGENTTRUST_RECEIPT_SIGNING_KEY_FILE){
    const configuration=await readFile('.env','utf8');
    const signingPath=resolve('.local/receipt-signing/private.pem').replaceAll('\\','/');
    await writeFile('.env',configuration.trimEnd()+'\nAGENTTRUST_RECEIPT_SIGNING_KEY_FILE='+JSON.stringify(signingPath)+'\n',{mode:0o600});
    process.env.AGENTTRUST_RECEIPT_SIGNING_KEY_FILE=signingPath;
  }
  for (const key of ['DB_OWNER_PASSWORD','DB_API_PASSWORD','DB_WORKER_PASSWORD']) if (!/^[a-f0-9]{48}$/.test(process.env[key] || '')) throw new Error(`Expected generated configuration for ${key}. Preserve existing configuration and review .env.example.`);
  execFileSync('docker', ['compose','up','-d','--wait','db'], { stdio: 'inherit' });
  const owner = pool(process.env.OWNER_DATABASE_URL);
  try {
    for (const [role,password,bypass] of [['agenttrust_api',process.env.DB_API_PASSWORD,false],['agenttrust_worker',process.env.DB_WORKER_PASSWORD,true]]) {
      const exists = await owner.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[role]);
      // Generated role names and hex-only passwords are validated above; identifiers are fixed.
      if (!exists.rowCount) await owner.query(`CREATE ROLE ${role} LOGIN ${bypass ? 'BYPASSRLS' : 'NOBYPASSRLS'} PASSWORD '${password}'`);
    }
    await migrate(owner);
    await initializeSeedData(owner);
    if (!(await owner.query("SELECT 1 FROM pg_database WHERE datname='agenttrust_test'")).rowCount) await owner.query('CREATE DATABASE agenttrust_test OWNER agenttrust_owner');
  } finally { await owner.end(); }
  const testDb = pool(process.env.TEST_OWNER_DATABASE_URL);
  try { await migrate(testDb); } finally { await testDb.end(); }
  if (process.platform==='win32') {
    execFileSync('icacls',['.env','/inheritance:r','/grant:r',`${process.env.USERNAME}:(F)`,'*S-1-5-18:(F)'],{stdio:'ignore'});
    execFileSync('icacls',['.local','/inheritance:r','/grant:r',`${process.env.USERNAME}:(OI)(CI)F`,'*S-1-5-18:(OI)(CI)F'],{stdio:'ignore'});
    for(const file of ['.local/credentials.json','.local/logitrack-preservation.json','.local/restart-check.json']) {
      if(existsSync(file))execFileSync('icacls',[file,'/inheritance:r','/grant:r',`${process.env.USERNAME}:(F)`,'*S-1-5-18:(F)'],{stdio:'ignore'});
    }
  } else {
    await chmod('.env',0o600);await chmod('.local',0o700);
    if(existsSync('.local/credentials.json'))await chmod('.local/credentials.json',0o600);
  }
  console.log(`Database migrations complete. Access keys: ${resolve('.local/credentials.json')} (not printed or committed).`);
}
if (process.argv[1]?.endsWith('setup.mjs')) main().catch(error => { console.error(`Setup failed (${error.code || 'configuration'}): ${error.code ? 'Check database or Docker availability.' : error.message}`); process.exitCode=1; });
