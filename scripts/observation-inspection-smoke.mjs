import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolve} from 'node:path';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {operationalObservation} from './operations-observe.mjs';
import {inspectObservationFile} from './inspect-operations-observation.mjs';
const exec=promisify(execFile);
const args=process.argv.slice(2);assert.ok(args.length===0||args.length===2&&args[0]==='--image'&&/^ghcr\.io\/automaster5013\/agenttrust@sha256:[a-f0-9]{64}$/.test(args[1]));
const image=args[1],revision=(await exec('git',['rev-parse','HEAD'],{windowsHide:true})).stdout.trim();const version=JSON.parse(await readFile('package.json','utf8')).version;
if(image){const metadata=JSON.parse((await exec('docker',['image','inspect',image],{windowsHide:true})).stdout)[0];assert.equal(metadata.Config.Labels['org.opencontainers.image.revision'],revision);assert.equal(metadata.Config.Labels['org.opencontainers.image.version'],version);}
const report={schemaVersion:1,completed:false,revision,version,syntheticLocalObservations:true,sourceCliVerified:false,packagedCliVerified:false,packagedNetworkDisabled:false,packagedCredentialsNotMounted:false,wrongScopeRefused:false,authenticityVerified:false,runtimeVerified:false,currentReleasePermissionVerified:false,proofs:[]};
try{
 for(const organizationIndex of [0,1]){
  const observation=await operationalObservation({organizationIndex,samples:2,intervalSeconds:1});assert.ok(observation.completed&&observation.sessionLoggedOut&&!observation.criticalObserved);
  const expected={organizationId:observation.organizationId,projectId:observation.projectId};const expectedSummary=await inspectObservationFile({path:observation.reportPath,expected});
  const flags=['--organization-id',expected.organizationId,'--project-id',expected.projectId];
  const source=JSON.parse((await exec(process.execPath,['scripts/inspect-operations-observation.mjs',observation.reportPath,...flags],{windowsHide:true,timeout:10000})).stdout);assert.deepEqual(source,expectedSummary);
  const wrong=['--organization-id',randomUUID(),'--project-id',expected.projectId];
  async function refuse(exe,argv){let exitCode;try{await exec(exe,argv,{windowsHide:true,timeout:30000});}catch(error){exitCode=error.code;}assert.equal(exitCode,2);}
  await refuse(process.execPath,['scripts/inspect-operations-observation.mjs',observation.reportPath,...wrong]);
  if(image){
   const user=typeof process.getuid==='function'?String(process.getuid())+':'+process.getgid():'node';assert.notEqual(user.split(':')[0],'0');
   const docker=['run','--rm','--user',user,'--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--memory','128m','--cpus','0.5','--pids-limit','64','--mount','type=bind,source='+resolve(observation.reportPath)+',target=/input/report.json,readonly',image,'node','scripts/inspect-operations-observation.mjs','/input/report.json'];
   const packaged=JSON.parse((await exec('docker',[...docker,...flags],{windowsHide:true,timeout:30000})).stdout);assert.deepEqual(packaged,expectedSummary);await refuse('docker',[...docker,...wrong]);
  }
  report.proofs.push({organizationIndex,samples:2,ownSessionScopeVerified:true,ownSessionLoggedOut:true,sourceCliVerified:true,packagedCliVerified:!!image,wrongScopeNativeExitCode:2,structureVerified:true,authenticityVerified:false,runtimeVerified:false,currentReleasePermissionVerified:false});
 }
 report.sourceCliVerified=true;report.packagedCliVerified=!!image;report.packagedNetworkDisabled=!!image;report.packagedCredentialsNotMounted=!!image;report.wrongScopeRefused=true;report.completed=true;
}catch{report.failed=true;process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();const path='.local/observation-inspection-smoke-'+randomUUID()+'.json';await writeFile(path,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({...report,reportPath:path}));}
