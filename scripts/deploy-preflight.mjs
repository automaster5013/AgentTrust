import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createReadStream} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {createHash,createPrivateKey,createPublicKey} from 'node:crypto';
import {Writable} from 'node:stream';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import pg from 'pg';
import {preflightDiagnostic} from './preflight-diagnostic.mjs';
import {revisionMigrations,verifyMigrationLedger,verifyDatabaseTarget,readDeploymentDatabaseState} from './deployment-schema.mjs';
import {decryptBackup} from '../packages/backup/cipher.js';
import {readTrustedReceiptKey} from './trusted-receipt-key.mjs';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
export function verifyDeploymentConfig(config,image,expectedImage,revision){
  assert.match(expectedImage||'',/^ghcr\.io\/[a-z0-9_.-]+\/[a-z0-9_.-]+@sha256:[a-f0-9]{64}$/);
  assert.match(revision||'',/^[a-f0-9]{40}$/);
  assert.ok(image.RepoDigests.includes(expectedImage));
  assert.equal(image.Config.Labels['org.opencontainers.image.revision'],revision);
  assert.equal(image.Config.Labels['org.opencontainers.image.source']?.toLowerCase(),'https://github.com/'+expectedImage.slice(8).split('@')[0]);
  assert.match(image.Config.User,/^(node|[1-9][0-9]*(?::[1-9][0-9]*)?)$/);
  for(const name of ['api','worker']){
    const service=config.services[name];
    assert.equal(service.image,expectedImage);assert.ok(!service.build);
    assert.equal(service.read_only,true);assert.ok(service.cap_drop.includes('ALL'));
    assert.ok(service.security_opt.includes('no-new-privileges:true')||service.security_opt.includes('no-new-privileges'));
    if(service.user!==undefined)assert.match(service.user,/^(node|[1-9][0-9]*(?::[1-9][0-9]*)?)$/);
  }
  const {api,worker,db}=config.services;
  assert.equal(worker.environment.AGENTTRUST_HTTPS_TARGETS,'{}');
  assert.deepEqual(Object.keys(worker.networks),['backend']);assert.equal(config.networks.backend.internal,true);
  assert.equal(worker.ports?.length||0,0);assert.equal(worker.secrets?.length||0,0);assert.equal(worker.volumes?.length||0,0);
  for(const service of [api,db]){
    assert.equal(service.ports.length,1);
    assert.equal(service.ports[0].host_ip,'127.0.0.1');
    assert.ok(Number(service.ports[0].published)>0&&Number(service.ports[0].published)<=65535);
  }
  assert.notEqual(String(api.ports[0].published),String(db.ports[0].published));
  assert.equal(api.secrets.length,1);assert.equal(api.secrets[0].source,'receipt-signing-key');
  assert.ok(!api.secrets[0].target||['receipt-signing-key','/run/secrets/receipt-signing-key'].includes(api.secrets[0].target));
  assert.equal(api.environment.AGENTTRUST_RECEIPT_SIGNING_KEY_FILE,'/run/secrets/receipt-signing-key');
  assert.equal(api.volumes?.length||0,0);
  return {image:expectedImage,revision,configurationVerified:true,cachedImageVerified:true};
}
export async function verifyRecoveryEvidence({directory=root,report,now=Date.now(),maxAgeHours=24,expectedMigrationHash,expectedSecurityHash}){
  assert.ok(Number.isFinite(maxAgeHours)&&maxAgeHours>0&&maxAgeHours<=168);
  assert.match(report.backup||'',/^agenttrust-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.dump$/);
  assert.equal(report.schemaVersion,1);
  assert.match(report.restoredDatabase||'',/^agenttrust_restore_[a-f0-9]{32}$/);
  for(const flag of ['dataFingerprintsMatch','securityCatalogMatch','tenantPoliciesVerified','authTenantPoliciesVerified','applicationConnectionsDisabled'])assert.equal(report[flag],true);
  const path=resolve(directory,'.local/backups',report.backup);
  const manifest=JSON.parse(await readFile(path+'.manifest.json','utf8'));
  assert.equal(manifest.schemaVersion,2);assert.equal(manifest.securityVersion,2);assert.equal(manifest.name,report.backup);
  assert.match(manifest.sha256||'',/^[a-f0-9]{64}$/);assert.equal(manifest.sha256,report.sha256);
  const created=Date.parse(manifest.createdAt),verified=Date.parse(report.verifiedAt);
  for(const date of [created,verified])assert.ok(Number.isFinite(date)&&date<=now&&now-date<=maxAgeHours*3600000);
  assert.ok(verified>=created);
  const sha=createHash('sha256');for await(const chunk of createReadStream(path))sha.update(chunk);
  assert.equal(sha.digest('hex'),manifest.sha256);
  const key=await readFile(resolve(directory,'.local/backup-keys',report.backup+'.key'));
  const {sha256,encryption,...metadata}=manifest;
  // Authenticate the full ciphertext and metadata while discarding plaintext in memory.
  await decryptBackup(createReadStream(path),new Writable({write(_chunk,_encoding,done){done();}}),key,metadata,encryption);
  if(expectedMigrationHash!==undefined){
    assert.match(expectedMigrationHash,/^[a-f0-9]{64}$/);
    assert.equal(manifest.tables?.migrations?.hash,expectedMigrationHash);
  }
  if(expectedSecurityHash!==undefined){
    assert.match(expectedSecurityHash,/^[a-f0-9]{64}$/);
    assert.equal(manifest.securityHash,expectedSecurityHash);
  }
  return {backupSecurityCatalogVerified:expectedSecurityHash!==undefined,backupMigrationLedgerVerified:expectedMigrationHash!==undefined,backup:report.backup,backupAuthenticated:true,priorRestoreEvidenceVerified:true,backupCreatedAt:manifest.createdAt,restoreVerifiedAt:report.verifiedAt};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  let stage='inputs';
  try{
    const expectedImage=process.env.AGENTTRUST_IMAGE,revision=process.env.AGENTTRUST_EXPECTED_REVISION;
    assert.match(expectedImage||'',/^ghcr\.io\/[a-z0-9_.-]+\/[a-z0-9_.-]+@sha256:[a-f0-9]{64}$/);assert.match(revision||'',/^[a-f0-9]{40}$/);
    const inspect=(...args)=>JSON.parse(execFileSync('docker',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000,maxBuffer:4194304}));
    const maxAgeHours=Number(process.env.AGENTTRUST_BACKUP_MAX_AGE_HOURS??24);
    assert.ok(Number.isFinite(maxAgeHours)&&maxAgeHours>0&&maxAgeHours<=168);
    stage='compose-config';
    const config=inspect('compose','-f','compose.yaml','-f','compose.image.yaml','config','--format','json');
    stage='cached-image';
    const image=inspect('image','inspect',expectedImage)[0];
    const configuration=verifyDeploymentConfig(config,image,expectedImage,revision);
    stage='signing-key-pair';
    assert.equal(resolve(config.secrets['receipt-signing-key'].file),resolve(root,'.local/receipt-signing/private.pem'));
    const privateKey=createPrivateKey(await readFile(resolve(root,'.local/receipt-signing/private.pem')));
    const publicKey=createPublicKey(await readTrustedReceiptKey(resolve(root,'.local/receipt-signing/public.pem')));
    assert.equal(privateKey.asymmetricKeyType,'ed25519');
    assert.deepEqual(createPublicKey(privateKey).export({type:'spki',format:'der'}),publicKey.export({type:'spki',format:'der'}));
    stage='database-target';
    verifyDatabaseTarget(process.env.OWNER_DATABASE_URL,config);
    stage='database-migration-ledger';
    const client=new pg.Client({connectionString:process.env.OWNER_DATABASE_URL,connectionTimeoutMillis:5000,statement_timeout:5000,query_timeout:10000,application_name:'agenttrust-deployment-preflight'});
    let schema,state;
    try{await client.connect();state=await readDeploymentDatabaseState(client);schema=verifyMigrationLedger(state.rows,revisionMigrations(revision));}
    finally{await client.end();}
    stage='backup-and-prior-restore';
    const report=JSON.parse(await readFile(resolve(root,'.local/recovery-smoke.json'),'utf8'));
    const recovery=await verifyRecoveryEvidence({report,expectedMigrationHash:schema.migrationHash,expectedSecurityHash:state.securityHash,maxAgeHours});
    console.log(JSON.stringify({...preflightDiagnostic(),...configuration,...schema,...recovery,securityCatalogVersion:state.securityVersion,signingKeyPairVerified:true,readOnly:true,checkedAt:new Date().toISOString(),scope:'configuration, cached image, exact revision/database/backup migration ledger, database security catalog matching authenticated backup and prior local restore evidence; no deployment, port availability, security correctness independent of backup, changes after inspection, rollback compatibility or offsite recovery verification'}));
  }catch{
    const diagnostic=preflightDiagnostic(stage);console.log(JSON.stringify(diagnostic));
    console.error(`Deployment preflight blocked: ${diagnostic.code}. No deployment performed.`);process.exitCode=1;
  }
}
