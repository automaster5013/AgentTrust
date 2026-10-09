import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {localSmokeBase,fetchLocalSmoke} from './local-smoke-http.mjs';
import {readReleaseResponse} from './release-gate.mjs';
import {seededDemoScope,assertDemoSessionScope} from './demo-session-scope.mjs';
import {readBoundedFile} from './verify-delivery.mjs';

import {verifiedOperationalAlertReport} from '../packages/operations/alert-evidence.js';
export {verifiedOperationalAlertReport};
export function alertProbeOptions(args){if(!args.length)return {organizationIndex:0};assert.ok(args.length===2&&args[0]==='--organization-index'&&/^(0|[1-9][0-9]?)$/.test(args[1]));return {organizationIndex:Number(args[1])};}
export async function operationalAlertProbe(options){
 assert.ok(Number.isInteger(options.organizationIndex)&&options.organizationIndex>=0&&options.organizationIndex<=99);const base=localSmokeBase();
 const config=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readBoundedFile('.local/credentials.json'))),org=config.organizations?.[options.organizationIndex],scope=seededDemoScope(org),key=org.credentials.find(k=>k.role==='admin')?.token;assert.match(key||'',/^[a-f0-9]{64}$/);
 let cookie;const report={completed:false,noEvaluationsCreated:true,businessDataWrites:false,automatedRemediationPerformed:false,serverDeployed:false,organizationIndex:options.organizationIndex,...scope};
 async function call(path,data){const response=await fetchLocalSmoke(base,path,{method:data?'POST':'GET',headers:{'Content-Type':'application/json','X-AgentTrust-Request':'local-ui','X-AgentTrust-Project':scope.projectId,...(cookie?{Cookie:cookie}:{})},...(data?{body:JSON.stringify(data)}:{})});if(path==='/v1/auth/login')cookie=response.headers.get('set-cookie')?.split(';')[0];if(!response.ok){await response.body?.cancel();throw Error('Scoped alert request failed.');}return readReleaseResponse(response);}
 try{await call('/v1/auth/login',{accessKey:key});assert.ok(cookie);assertDemoSessionScope(await call('/v1/me'),scope,'admin');report.sessionScopeVerified=true;report.assessment=verifiedOperationalAlertReport(await call('/v1/operations-alerts'),scope);report.completed=true;}
 finally{report.sessionLoggedOut=!cookie;if(cookie){try{await call('/v1/auth/logout',{});report.sessionLoggedOut=true;}catch{report.completed=false;report.cleanupFailed=true;}}report.finishedAt=new Date().toISOString();const path='.local/operational-alert-probe-'+randomUUID()+'.json';await writeFile(path,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});report.reportPath=path;}
 assert.equal(report.sessionLoggedOut,true);
 return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const report=await operationalAlertProbe(alertProbeOptions(process.argv.slice(2)));console.log(JSON.stringify({status:'passed',completed:report.completed,operationalStatus:report.assessment.status,alerts:report.assessment.alerts,organizationIndex:report.organizationIndex,sessionScopeVerified:report.sessionScopeVerified,sessionLoggedOut:report.sessionLoggedOut,businessDataWrites:false,serverDeployed:false,reportPath:report.reportPath}));if(report.assessment.status==='critical')process.exitCode=2;}
 catch{console.error('Operational alert observation failed; no healthy assessment is available.');process.exitCode=1;}
}
