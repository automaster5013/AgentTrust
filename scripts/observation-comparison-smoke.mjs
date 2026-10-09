import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,readFile,writeFile,access} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {initialObservationReport} from './operational-observation.mjs';
import {compareOperationalObservations} from '../packages/operations/observation-comparison.js';
import {renderOperationalObservationComparison} from '../packages/operations/observation-comparison-report.js';
const exec=promisify(execFile),args=process.argv.slice(2);assert.ok(args.length===0||args.length===2&&args[0]==='--image'&&/^ghcr\.io\/automaster5013\/agenttrust@sha256:[a-f0-9]{64}$/.test(args[1]));
const image=args[1],revision=(await exec('git',['rev-parse','HEAD'],{windowsHide:true})).stdout.trim(),version=JSON.parse(await readFile('package.json','utf8')).version;
if(image){const cached=JSON.parse((await exec('docker',['image','inspect',image],{windowsHide:true})).stdout)[0];assert.equal(cached.Config.Labels['org.opencontainers.image.revision'],revision);}
const directory='.local/observation-comparison-smoke-'+randomUUID(),proof={schemaVersion:1,completed:false,revision,version,syntheticObservationComparisons:true,noApiSessionsCreated:true,noDatabaseConnectionsCreated:true,sourceCliVerified:false,packagedCliVerified:false,packagedNetworkDisabled:false,packagedCredentialsNotMounted:false,existingOutputPreserved:false,invalidInputRefusedBeforeOutput:false,wrongScopeRefusedBeforeOutput:false,authenticityVerified:false,runtimeVerified:false,currentReleasePermissionVerified:false,proofs:[]};
const scope={organizationId:randomUUID(),projectId:randomUUID()},at=new Date().toISOString(),base=initialObservationReport({organizationIndex:0,samples:1,intervalSeconds:1},scope);
Object.assign(base,{completed:true,stage:'finished',sessionScopeVerified:true,sessionLoggedOut:true,finishedAt:at,samples:[{at,assessment:{schemaVersion:1,status:'warning',...scope,observedAt:at,alerts:[{code:'retained-capacity-high',severity:'warning',scope:'organization'}],readOnly:true,automatedRemediationPerformed:false,releasePermissionVerified:false,continuousMonitoringProven:false}}]});
async function invoke(exe,argv,expected){let stdout;try{stdout=(await exec(exe,argv,{windowsHide:true,timeout:30000,maxBuffer:2097152})).stdout;assert.equal(expected,0);}catch(error){assert.equal(error.code,expected);assert.doesNotMatch((error.stdout??'')+(error.stderr??''),/PRIVATE-SHOULD-NOT-PUBLISH/);stdout=error.stdout;}return stdout;}
try{
 await mkdir(directory,{mode:0o700});const baseline=directory+'/baseline.json';await writeFile(baseline,JSON.stringify(base),{flag:'wx',mode:0o600});const flags=['--organization-id',scope.organizationId,'--project-id',scope.projectId],user=typeof process.getuid==='function'?String(process.getuid())+':'+process.getgid():'node';assert.notEqual(user.split(':')[0],'0');
 for(const kind of ['compared','incomplete','critical','invalid','wrong-scope']){
  const candidate=structuredClone(base),expected=kind==='incomplete'?1:['critical','invalid','wrong-scope'].includes(kind)?2:0,valid=!['invalid','wrong-scope'].includes(kind);
  if(kind==='incomplete')Object.assign(candidate,{completed:false,failed:true,failureStage:'sampling',failureCode:'authentication-denied'});
  if(kind==='critical'){candidate.criticalObserved=true;candidate.samples[0].assessment.status='critical';candidate.samples[0].assessment.alerts=[{code:'worker-not-recent',severity:'critical',scope:'service'}];}
  if(kind==='invalid')candidate.private='PRIVATE-SHOULD-NOT-PUBLISH';
  if(kind==='wrong-scope'){candidate.projectId=randomUUID();candidate.samples[0].assessment.projectId=candidate.projectId;}
  const input=directory+'/'+kind+'.json',sourceOutput=directory+'/'+kind+'.html';await writeFile(input,JSON.stringify(candidate),{flag:'wx',mode:0o600});
  const sourceJson=await invoke(process.execPath,['scripts/compare-operations-observations.mjs',baseline,input,...flags],expected),sourceHtmlMeta=await invoke(process.execPath,['scripts/write-operations-comparison-report.mjs',baseline,input,sourceOutput,...flags],expected);
  let comparison,rendered;
  if(valid){comparison=compareOperationalObservations(base,candidate,scope);rendered=renderOperationalObservationComparison(base,candidate,scope);assert.deepEqual(JSON.parse(sourceJson),comparison);assert.equal(JSON.parse(sourceHtmlMeta).comparisonStatus,kind);assert.equal(await readFile(sourceOutput,'utf8'),rendered.html);await invoke(process.execPath,['scripts/write-operations-comparison-report.mjs',baseline,input,sourceOutput,...flags],2);assert.equal(await readFile(sourceOutput,'utf8'),rendered.html);}
  else{assert.equal(sourceJson,'');assert.equal(sourceHtmlMeta,'');await assert.rejects(access(sourceOutput),{code:'ENOENT'});}
  if(image){
   const outputDirectory=directory+'/packaged-'+kind;await mkdir(outputDirectory,{mode:0o700});const docker=['run','--rm','--user',user,'--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--memory','128m','--cpus','0.5','--pids-limit','64','--mount','type=bind,source='+resolve(baseline)+',target=/input/baseline.json,readonly','--mount','type=bind,source='+resolve(input)+',target=/input/candidate.json,readonly'];
   const packagedJson=await invoke('docker',[...docker,image,'node','scripts/compare-operations-observations.mjs','/input/baseline.json','/input/candidate.json',...flags],expected);
   const htmlArgs=[...docker,'--mount','type=bind,source='+resolve(outputDirectory)+',target=/output',image,'node','scripts/write-operations-comparison-report.mjs','/input/baseline.json','/input/candidate.json','/output/comparison.html',...flags],packagedMeta=await invoke('docker',htmlArgs,expected);
   if(valid){assert.deepEqual(JSON.parse(packagedJson),comparison);assert.deepEqual(JSON.parse(packagedMeta),JSON.parse(sourceHtmlMeta));assert.equal(await readFile(outputDirectory+'/comparison.html','utf8'),rendered.html);await invoke('docker',htmlArgs,2);assert.equal(await readFile(outputDirectory+'/comparison.html','utf8'),rendered.html);}
   else{assert.equal(packagedJson,'');assert.equal(packagedMeta,'');await assert.rejects(access(outputDirectory+'/comparison.html'),{code:'ENOENT'});}
  }
  proof.proofs.push({kind,sourceJsonNativeExitCode:expected,sourceHtmlNativeExitCode:expected,packagedJsonNativeExitCode:image?expected:null,packagedHtmlNativeExitCode:image?expected:null,sourceAndPureComparisonMatched:valid,sourceHtmlBytesMatched:valid,packagedJsonAndHtmlMatched:!!image&&valid,existingOutputPreserved:valid,outputRefusedBeforeCreation:!valid});
 }
 Object.assign(proof,{sourceCliVerified:true,packagedCliVerified:!!image,packagedNetworkDisabled:!!image,packagedCredentialsNotMounted:!!image,existingOutputPreserved:true,invalidInputRefusedBeforeOutput:true,wrongScopeRefusedBeforeOutput:true,completed:true});
}catch{proof.failed=true;process.exitCode=1;}
finally{proof.finishedAt=new Date().toISOString();const path=directory+'/proof.json';await writeFile(path,JSON.stringify(proof,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({...proof,reportPath:path}));}
