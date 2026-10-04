import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable,Writable} from 'node:stream';
import {createHash,randomBytes} from 'node:crypto';
import {encryptBackup} from '../packages/backup/cipher.js';
import {verifyDeploymentConfig,verifyRecoveryEvidence} from '../scripts/deploy-preflight.mjs';

const expectedImage='ghcr.io/automaster5013/agenttrust@sha256:'+'a'.repeat(64),revision='b'.repeat(40);
function fixture(){
  const service=()=>({image:expectedImage,read_only:true,cap_drop:['ALL'],security_opt:['no-new-privileges:true']});
  return {config:{services:{api:{...service(),user:'node',ports:[{host_ip:'127.0.0.1',published:'4310'}],secrets:[{source:'receipt-signing-key',target:'/run/secrets/receipt-signing-key'}],environment:{AGENTTRUST_RECEIPT_SIGNING_KEY_FILE:'/run/secrets/receipt-signing-key'}},worker:{...service(),networks:{backend:{}},environment:{AGENTTRUST_HTTPS_TARGETS:'{}'}},db:{ports:[{host_ip:'127.0.0.1',published:'55432'}]}},networks:{backend:{internal:true}}},image:{RepoDigests:[expectedImage],Config:{User:'node',Labels:{'org.opencontainers.image.revision':revision,'org.opencontainers.image.source':'https://github.com/automaster5013/AgentTrust'}}}};
}
test('preflight rejects mutable or mismatched images and unsafe deployment overrides',()=>{
  const initial=fixture();assert.equal(verifyDeploymentConfig(initial.config,initial.image,expectedImage,revision).cachedImageVerified,true);
  for(const mutate of [f=>f.image.RepoDigests=[],f=>f.image.Config.Labels['org.opencontainers.image.revision']='c'.repeat(40),f=>f.config.services.worker.image='latest',f=>f.config.services.api.build={},f=>f.config.services.api.user='root',f=>f.config.services.worker.environment.AGENTTRUST_HTTPS_TARGETS='{"external":{}}',f=>f.config.networks.backend.internal=false,f=>f.config.services.db.ports[0].host_ip='0.0.0.0',f=>f.config.services.db.ports[0].published='4310',f=>f.config.services.worker.volumes=[{}],f=>f.config.services.api.read_only=false]){
    const f=fixture();mutate(f);assert.throws(()=>verifyDeploymentConfig(f.config,f.image,expectedImage,revision));
  }
});
test('read-only preflight authenticates backup and rejects stale, unbound and tampered recovery evidence',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'agenttrust-preflight-'));
  try{
    await mkdir(join(directory,'.local/backups'),{recursive:true});await mkdir(join(directory,'.local/backup-keys'));
    const backup='agenttrust-11111111-1111-1111-1111-111111111111.dump',path=join(directory,'.local/backups',backup),now=Date.now();
    const metadata={schemaVersion:2,name:backup,createdAt:new Date(now-1000).toISOString(),securityVersion:2,securityHash:'a'.repeat(64),tables:{}};
    const key=randomBytes(32),chunks=[];
    const encryption=await encryptBackup(Readable.from(['synthetic backup']),new Writable({write(chunk,_encoding,done){chunks.push(chunk);done();}}),key,metadata);
    const ciphertext=Buffer.concat(chunks),sha256=createHash('sha256').update(ciphertext).digest('hex');
    const manifest={...metadata,sha256,encryption};
    await writeFile(path,ciphertext);await writeFile(path+'.manifest.json',JSON.stringify(manifest));await writeFile(join(directory,'.local/backup-keys',backup+'.key'),key);
    const report={schemaVersion:1,backup,sha256,restoredDatabase:'agenttrust_restore_'+'a'.repeat(32),verifiedAt:new Date(now).toISOString(),dataFingerprintsMatch:true,securityCatalogMatch:true,tenantPoliciesVerified:true,authTenantPoliciesVerified:true,applicationConnectionsDisabled:true};
    assert.equal((await verifyRecoveryEvidence({directory,report,now})).backupAuthenticated,true);
    assert.deepEqual(await readFile(path),ciphertext);
    for(const change of [{backup:'../../secret'},{sha256:'b'.repeat(64)},{authTenantPoliciesVerified:false},{verifiedAt:new Date(now+1000).toISOString()}])await assert.rejects(verifyRecoveryEvidence({directory,report:{...report,...change},now}));
    await assert.rejects(verifyRecoveryEvidence({directory,report,now:now+25*3600000}));
    await writeFile(path+'.manifest.json',JSON.stringify({...manifest,securityHash:'b'.repeat(64)}));
    await assert.rejects(verifyRecoveryEvidence({directory,report,now}));
    await writeFile(path+'.manifest.json',JSON.stringify(manifest));await writeFile(path,Buffer.from('corrupted'));
    await assert.rejects(verifyRecoveryEvidence({directory,report,now}));
  }finally{await rm(directory,{recursive:true,force:true});}
});
