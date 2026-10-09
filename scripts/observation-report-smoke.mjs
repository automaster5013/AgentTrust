import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,readFile,writeFile,access} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {initialObservationReport} from './operational-observation.mjs';
import {renderOperationalObservationReport} from '../packages/operations/observation-report.js';
const exec=promisify(execFile),args=process.argv.slice(2);assert.ok(args.length===0||args.length===2&&args[0]==='--image'&&/^ghcr\.io\/automaster5013\/agenttrust@sha256:[a-f0-9]{64}$/.test(args[1]));
const image=args[1],revision=(await exec('git',['rev-parse','HEAD'],{windowsHide:true})).stdout.trim(),version=JSON.parse(await readFile('package.json','utf8')).version;
if(image){const cached=JSON.parse((await exec('docker',['image','inspect',image],{windowsHide:true})).stdout)[0];assert.equal(cached.Config.Labels['org.opencontainers.image.revision'],revision);}
const directory='.local/observation-report-smoke-'+randomUUID(),proof={schemaVersion:1,completed:false,revision,version,syntheticObservationReports:true,noApiSessionsCreated:true,noDatabaseConnectionsCreated:true,sourceCliVerified:false,packagedCliVerified:false,packagedNetworkDisabled:false,packagedCredentialsNotMounted:false,existingOutputPreserved:false,invalidInputRefusedBeforeOutput:false,authenticityVerified:false,runtimeVerified:false,currentReleasePermissionVerified:false,proofs:[]};
const scope={organizationId:randomUUID(),projectId:randomUUID()},at=new Date().toISOString();
const base=initialObservationReport({organizationIndex:0,samples:1,intervalSeconds:1},scope);Object.assign(base,{completed:true,stage:'finished',sessionScopeVerified:true,sessionLoggedOut:true,finishedAt:at,samples:[{at,assessment:{schemaVersion:1,status:'warning',...scope,observedAt:at,alerts:[{code:'retained-capacity-high',severity:'warning',scope:'organization'}],readOnly:true,automatedRemediationPerformed:false,releasePermissionVerified:false,continuousMonitoringProven:false}}]});
async function invoke(exe,argv,expected){let output;try{output=(await exec(exe,argv,{windowsHide:true,timeout:30000,maxBuffer:2097152})).stdout;assert.equal(expected,0);}catch(error){assert.equal(error.code,expected);assert.doesNotMatch(error.stdout+error.stderr,/PRIVATE-SHOULD-NOT-PUBLISH/);output=error.stdout;}return output;}
try{
 await mkdir(directory,{mode:0o700});const flags=['--organization-id',scope.organizationId,'--project-id',scope.projectId],user=typeof process.getuid==='function'?String(process.getuid())+':'+process.getgid():'node';assert.notEqual(user.split(':')[0],'0');
 for(const kind of ['warning','incomplete','critical']){
  const fixture=structuredClone(base),expected=kind==='incomplete'?1:kind==='critical'?2:0;
  if(kind==='incomplete')Object.assign(fixture,{completed:false,failed:true,failureStage:'sampling',failureCode:'authentication-denied',sessionLoggedOut:false,cleanupFailed:true,cleanupFailureCode:'access-denied'});
  if(kind==='critical'){fixture.criticalObserved=true;fixture.samples[0].assessment.status='critical';fixture.samples[0].assessment.alerts=[{code:'worker-not-recent',severity:'critical',scope:'service'}];}
  const input=directory+'/'+kind+'.json',sourceOutput=directory+'/'+kind+'.html';await writeFile(input,JSON.stringify(fixture),{flag:'wx',mode:0o600});const rendered=renderOperationalObservationReport(fixture,scope);
  const result=JSON.parse(await invoke(process.execPath,['scripts/write-operations-observation-report.mjs',input,sourceOutput,...flags],expected));assert.equal(result.outputCreated,true);assert.equal(result.observationStatus,kind);assert.equal(result.currentReleasePermissionVerified,false);assert.equal(await readFile(sourceOutput,'utf8'),rendered.html);
  await invoke(process.execPath,['scripts/write-operations-observation-report.mjs',input,sourceOutput,...flags],2);assert.equal(await readFile(sourceOutput,'utf8'),rendered.html);
  if(image){
   const outputDirectory=directory+'/packaged-'+kind;await mkdir(outputDirectory,{mode:0o700});const docker=['run','--rm','--user',user,'--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--memory','128m','--cpus','0.5','--pids-limit','64','--mount','type=bind,source='+resolve(input)+',target=/input/report.json,readonly','--mount','type=bind,source='+resolve(outputDirectory)+',target=/output',image,'node','scripts/write-operations-observation-report.mjs','/input/report.json','/output/report.html',...flags];
   const packaged=JSON.parse(await invoke('docker',docker,expected));assert.deepEqual(packaged,result);assert.equal(await readFile(outputDirectory+'/report.html','utf8'),rendered.html);await invoke('docker',docker,2);assert.equal(await readFile(outputDirectory+'/report.html','utf8'),rendered.html);
  }
  proof.proofs.push({kind,sourceNativeExitCode:expected,packagedNativeExitCode:image?expected:null,sourceHtmlBytesMatched:true,packagedHtmlBytesMatched:!!image,existingOutputPreserved:true});
 }
 const invalidInput=directory+'/invalid.json',invalidOutput=directory+'/invalid.html';await writeFile(invalidInput,JSON.stringify({...base,private:'PRIVATE-SHOULD-NOT-PUBLISH'}),{flag:'wx',mode:0o600});await invoke(process.execPath,['scripts/write-operations-observation-report.mjs',invalidInput,invalidOutput,...flags],2);await assert.rejects(access(invalidOutput),{code:'ENOENT'});
 if(image){const outputDirectory=directory+'/packaged-invalid';await mkdir(outputDirectory,{mode:0o700});await invoke('docker',['run','--rm','--user',user,'--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--memory','128m','--cpus','0.5','--pids-limit','64','--mount','type=bind,source='+resolve(invalidInput)+',target=/input/report.json,readonly','--mount','type=bind,source='+resolve(outputDirectory)+',target=/output',image,'node','scripts/write-operations-observation-report.mjs','/input/report.json','/output/report.html',...flags],2);await assert.rejects(access(outputDirectory+'/report.html'),{code:'ENOENT'});}
 proof.sourceCliVerified=true;proof.packagedCliVerified=!!image;proof.packagedNetworkDisabled=!!image;proof.packagedCredentialsNotMounted=!!image;proof.existingOutputPreserved=true;proof.invalidInputRefusedBeforeOutput=true;proof.completed=true;
}catch{proof.failed=true;process.exitCode=1;}
finally{proof.finishedAt=new Date().toISOString();const path=directory+'/proof.json';await writeFile(path,JSON.stringify(proof,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({...proof,reportPath:path}));}
