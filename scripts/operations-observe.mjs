import assert from 'node:assert/strict';
import {mkdir,writeFile,rename,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {localSmokeBase,fetchLocalSmoke} from './local-smoke-http.mjs';
import {readReleaseResponse} from './release-gate.mjs';
import {seededDemoScope} from './demo-session-scope.mjs';
import {readBoundedFile} from './verify-delivery.mjs';
import {observationOptions,validatedObservationOptions,observeAlertSession} from './operational-observation.mjs';

export async function operationalObservation(options,{signal,env=process.env}={}){
 options=validatedObservationOptions(options);
 const base=localSmokeBase(env.PORT??'4310'),config=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readBoundedFile('.local/credentials.json'))),org=config.organizations?.[options.organizationIndex],scope=seededDemoScope(org),key=org.credentials.find(c=>c.role==='admin')?.token;assert.match(key||'',/^[a-f0-9]{64}$/);
 const directory='.local/operations-observation-'+randomUUID();await mkdir(directory,{mode:0o700});const path=directory+'/report.json';await writeFile(path,JSON.stringify({schemaVersion:1,completed:false,stage:'planned',...scope,...options})+'\n',{flag:'wx',mode:0o600});
 let cookie,loginStarted=false;const controller=new AbortController(),interrupt=()=>controller.abort();if(signal?.aborted)interrupt();else signal?.addEventListener('abort',interrupt,{once:true});process.on('SIGINT',interrupt);process.on('SIGTERM',interrupt);
 async function call(route,data){const response=await fetchLocalSmoke(base,route,{method:data?'POST':'GET',headers:{'Content-Type':'application/json','X-AgentTrust-Request':'local-ui','X-AgentTrust-Project':scope.projectId,...(cookie?{Cookie:cookie}:{})},...(route==='/v1/auth/logout'?{}:{signal:controller.signal}),...(data?{body:JSON.stringify(data)}:{})});if(route==='/v1/auth/login')cookie=response.headers.get('set-cookie')?.split(';')[0];if(!response.ok){await response.body?.cancel();throw Error('Scoped operational observation request failed.');}return readReleaseResponse(response);}
 async function checkpoint(report){const temp=directory+'/checkpoint-'+randomUUID()+'.json';try{await writeFile(temp,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});await rename(temp,path);}catch{await unlink(temp).catch(()=>{});throw Error('Operational observation checkpoint failed.');}}
 try{
  const report=await observeAlertSession(options,scope,{signal:controller.signal,login:async()=>{loginStarted=true;await call('/v1/auth/login',{accessKey:key});assert.ok(cookie);},me:()=>call('/v1/me'),call:()=>call('/v1/operations-alerts'),logout:async()=>{if(!cookie)return !loginStarted;await call('/v1/auth/logout',{});cookie=undefined;return true;},checkpoint});return {...report,reportPath:path};
 }finally{signal?.removeEventListener('abort',interrupt);process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',interrupt);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const report=await operationalObservation(observationOptions(process.argv.slice(2)));console.log(JSON.stringify({status:report.completed?'passed':'blocked',completed:report.completed,organizationIndex:report.organizationIndex,requestedSamples:report.requestedSamples,samples:report.samples.length,criticalObserved:report.criticalObserved,sessionScopeVerified:report.sessionScopeVerified,sessionLoggedOut:report.sessionLoggedOut,interrupted:report.interrupted===true,businessDataWrites:false,continuousMonitoringProven:false,releasePermissionVerified:false,serverDeployed:false,reportPath:report.reportPath}));process.exitCode=report.completed?(report.criticalObserved?2:0):1;}
 catch{console.error('Bounded operational observation could not be verified.');process.exitCode=1;}
}
