import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import pg from 'pg';
import {verifyDeploymentConfig,verifyRecoveryEvidence} from './deploy-preflight.mjs';
import {revisionMigrations,readDeploymentDatabaseState,verifyDatabaseTarget} from './deployment-schema.mjs';
import {verifySameSchemaRollback} from './rollback-schema.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));

export function rollbackInputs(env){
 const currentImage=env.AGENTTRUST_IMAGE,currentRevision=env.AGENTTRUST_EXPECTED_REVISION,previousImage=env.AGENTTRUST_ROLLBACK_IMAGE,previousRevision=env.AGENTTRUST_ROLLBACK_REVISION;
 for(const image of [currentImage,previousImage])assert.match(image||'',/^ghcr\.io\/automaster5013\/agenttrust@sha256:[a-f0-9]{64}$/);
 for(const revision of [currentRevision,previousRevision])assert.match(revision||'',/^[a-f0-9]{40}$/);
 assert.notEqual(currentImage,previousImage);assert.notEqual(currentRevision,previousRevision);
 const maxAgeHours=Number(env.AGENTTRUST_BACKUP_MAX_AGE_HOURS??24);assert.ok(Number.isFinite(maxAgeHours)&&maxAgeHours>0&&maxAgeHours<=168);
 return {currentImage,currentRevision,previousImage,previousRevision,maxAgeHours};
}

export async function rollbackPreflight(env=process.env){
 const inputs=rollbackInputs(env);
 const inspect=(args,selectedEnv)=>JSON.parse(execFileSync('docker',args,{cwd:root,env:selectedEnv,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000,maxBuffer:4194304}));
 const currentEnv={...env,AGENTTRUST_IMAGE:inputs.currentImage},previousEnv={...env,AGENTTRUST_IMAGE:inputs.previousImage};
 const args=['compose','-f','compose.yaml','-f','compose.image.yaml','config','--format','json'];
 const currentConfig=inspect(args,currentEnv),previousConfig=inspect(args,previousEnv);
 verifyDeploymentConfig(currentConfig,inspect(['image','inspect',inputs.currentImage],currentEnv)[0],inputs.currentImage,inputs.currentRevision);
 verifyDeploymentConfig(previousConfig,inspect(['image','inspect',inputs.previousImage],previousEnv)[0],inputs.previousImage,inputs.previousRevision);
 verifyDatabaseTarget(env.OWNER_DATABASE_URL,currentConfig);verifyDatabaseTarget(env.OWNER_DATABASE_URL,previousConfig);
 const client=new pg.Client({connectionString:env.OWNER_DATABASE_URL,connectionTimeoutMillis:5000,statement_timeout:5000,query_timeout:10000,application_name:'agenttrust-rollback-preflight'});let state;
 try{await client.connect();state=await readDeploymentDatabaseState(client);}finally{await client.end();}
 const schema=verifySameSchemaRollback(state.rows,revisionMigrations(inputs.currentRevision),revisionMigrations(inputs.previousRevision));
 const recovery=await verifyRecoveryEvidence({report:JSON.parse(await readFile(resolve(root,'.local/recovery-smoke.json'),'utf8')),expectedMigrationHash:schema.migrationHash,expectedSecurityHash:state.securityHash,maxAgeHours:inputs.maxAgeHours});
 return {schemaVersion:1,status:'passed',readOnly:true,...inputs,...schema,...recovery,cachedImageIdentitiesVerified:true,loopbackDatabaseTargetVerified:true,priorRestoreRequired:true,ciSuccessChecked:false,previousRuntimeConfigVerified:false,rollbackCompatibilityVerified:false,serverDeployed:false,scope:'same migration sources and current ledger, two cached image identities, current host configuration and authenticated prior restore; previous runtime configuration, CI, data semantics and actual rollback must be verified separately'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{assert.equal(process.argv.length,2);console.log(JSON.stringify(await rollbackPreflight()));}
 catch{console.log(JSON.stringify({schemaVersion:1,status:'blocked',readOnly:true,code:'ROLLBACK_PREFLIGHT_UNVERIFIED',serverDeployed:false,guidance:'Choose two distinct verified image digests and source revisions, cache them, confirm identical migration sources and the current ledger, and authenticate a recent restored backup. No downgrade or rollback was performed.'}));process.exitCode=1;}
}
