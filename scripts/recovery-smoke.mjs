import assert from 'node:assert/strict';
import {constants} from 'node:fs';
import {copyFile,readFile,readdir,writeFile,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {pool} from '../apps/api/database.js';
import {createBackup,verifyBackup,backupPath} from './recovery.mjs';

const root=resolve(fileURLToPath(new URL('..',import.meta.url))),backups=resolve(root,'.local/backups'),keys=resolve(root,'.local/backup-keys');
const recoveryDatabases=async database=>(await database.query("SELECT datname FROM pg_database WHERE datname LIKE 'agenttrust_restore_%' ORDER BY datname")).rows.map(row=>row.datname);
const plaintextFiles=async()=> (await readdir(backups)).filter(name=>name.startsWith('authenticated-')&&name.endsWith('.partial')).sort();
export async function recoverySmoke(){
  const database=pool(process.env.OWNER_DATABASE_URL),createdFiles=[];
  try{
    const backup=await createBackup(),source=backupPath(backup.name),manifest=JSON.parse(await readFile(source+'.manifest.json','utf8'));
    assert.equal(manifest.schemaVersion,2);const copyName='agenttrust-'+randomUUID()+'.dump',copy=backupPath(copyName);assert.notEqual(copyName,backup.name);
    const beforeDatabases=await recoveryDatabases(database),beforePlaintext=await plaintextFiles();
    try{
      await copyFile(source,copy,constants.COPYFILE_EXCL);createdFiles.push(copy);
      const keyCopy=resolve(keys,copyName+'.key');await copyFile(resolve(keys,backup.name+'.key'),keyCopy,constants.COPYFILE_EXCL);createdFiles.push(keyCopy);
      // Ciphertext checksum and key remain unchanged; changing authenticated metadata must invalidate the GCM tag.
      await writeFile(copy+'.manifest.json',JSON.stringify({...manifest,name:copyName})+'\n',{flag:'wx',mode:0o600});createdFiles.push(copy+'.manifest.json');
      await assert.rejects(verifyBackup(copyName));
      assert.deepEqual(await recoveryDatabases(database),beforeDatabases,'Unauthenticated backup must not create a recovery database.');
      assert.deepEqual(await plaintextFiles(),beforePlaintext,'Failed authentication must remove its private plaintext temporary file.');
    }finally{
      let cleanupFailed=false;for(const path of createdFiles.reverse())try{await unlink(path);}catch{cleanupFailed=true;}
      if(cleanupFailed)throw new Error('Synthetic recovery copy cleanup failed.');
    }
    const restored=await verifyBackup(backup.name),report={...restored,metadataTamperingRejectedBeforeDatabaseCreation:true,failedAuthenticationPlaintextRemoved:true,syntheticCopiesRemoved:true};
    await writeFile(resolve(root,'.local/recovery-smoke.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
    return report;
  }finally{await database.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{const report=await recoverySmoke();console.log(JSON.stringify(report));}
  catch{console.error('AgentTrust recovery smoke failed. Inspect private recovery artifacts and database state.');process.exitCode=1;}
}
