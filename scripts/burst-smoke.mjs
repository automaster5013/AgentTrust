import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {pool} from '../apps/api/database.js';
import {verifyReceipt} from '../packages/receipts/signature.js';
import {localSmokeBase,fetchLocalSmoke} from './local-smoke-http.mjs';
import {readReleaseResponse} from './release-gate.mjs';
import {seededDemoScope,assertDemoSessionScope} from './demo-session-scope.mjs';
import {parseBurstOptions,runBurstScenario} from './burst-smoke-scenario.mjs';
let runs,base,scope,organizationIndex=0,sessionScopeVerified=false;
try{({runs,organizationIndex}=parseBurstOptions(process.argv.slice(2)));base=localSmokeBase();}catch{console.error('Use --runs 2..20 and --organization-index 0..99 once each and a valid local smoke port.');process.exit(2);}
const reportPath='.local/burst-smoke-'+randomUUID()+'.json';let cookie,owner,report={schemaVersion:1,synthetic:true,completed:false,serverDeployed:false};
async function call(path,data,key=randomUUID()){
 const response=await fetchLocalSmoke(base,path,{method:data?'POST':'GET',headers:{'Content-Type':'application/json','X-AgentTrust-Request':'local-ui',...(scope?{'X-AgentTrust-Project':scope.projectId}:{}),'Idempotency-Key':key,...(cookie?{Cookie:cookie}:{})},...(data?{body:JSON.stringify(data)}:{})});
 if(path==='/v1/auth/login')cookie=response.headers.get('set-cookie')?.split(';')[0];
 if(!response.ok){await response.body?.cancel();throw Error('Local synthetic burst request failed.');}return readReleaseResponse(response);
}
try{
 const config=JSON.parse((await readFile('.local/credentials.json','utf8')).replace(/^\uFEFF/,'')),organization=config.organizations?.[organizationIndex];scope=seededDemoScope(organization);const key=organization.credentials.find(c=>c.role==='editor')?.token;
 assert.ok(key);const publicKey=await readFile('.local/receipt-signing/public.pem','utf8');owner=pool(process.env.OWNER_DATABASE_URL);
 const startedAt=new Date().toISOString();await call('/v1/auth/login',{accessKey:key});assert.ok(cookie);assertDemoSessionScope(await call('/v1/me'),scope,'editor');sessionScopeVerified=true;
 report=await runBurstScenario({call,runs,verify:receipt=>verifyReceipt(receipt,publicKey),wait:async id=>{
  const deadline=Date.now()+45000;
  while(Date.now()<deadline){const run=await call('/v1/runs/'+id);if(!['queued','running'].includes(run.state))return run;await sleep(100);}throw Error('Local synthetic burst deadline exceeded.');
 },verifyAccounting:async completed=>{
  const ids=completed.map(r=>r.id),params=[ids,scope.organizationId,scope.projectId],usage=await owner.query('SELECT count(*) AS count,coalesce(sum(u.evaluated_cases),0) AS cases,coalesce(sum(u.attempts),0) AS attempts FROM agenttrust.usage_events u JOIN agenttrust.runs r ON r.id=u.run_id AND r.organization_id=u.organization_id WHERE u.run_id=ANY($1::uuid[]) AND r.organization_id=$2 AND r.project_id=$3',params);
  assert.equal(Number(usage.rows[0].count),ids.length);assert.equal(Number(usage.rows[0].cases),completed.reduce((sum,r)=>sum+r.cases,0));assert.equal(Number(usage.rows[0].attempts),completed.reduce((sum,r)=>sum+r.attempts,0));
  const audits=await owner.query("SELECT a.resource_id,count(*) FILTER(WHERE a.action='run.queued') AS created,count(*) FILTER(WHERE a.action IN ('run.succeeded','run.failed','run.cancelled','run.timed_out')) AS terminal FROM agenttrust.audit_events a JOIN agenttrust.runs r ON r.id=a.resource_id AND r.organization_id=a.organization_id WHERE a.resource_id=ANY($1::uuid[]) AND r.organization_id=$2 AND r.project_id=$3 GROUP BY a.resource_id",params);
  assert.equal(audits.rows.length,ids.length);assert.ok(audits.rows.every(r=>Number(r.created)===1&&Number(r.terminal)===1));
 }});report.startedAt=startedAt;
}catch{report.failed=true;report.completed=false;}
finally{
 Object.assign(report,{organizationIndex,...(scope||{}),sessionScopeVerified});
 report.sessionLoggedOut=!cookie;
 if(cookie)try{await call('/v1/auth/logout',{});report.sessionLoggedOut=true;}catch{report.sessionLoggedOut=false;}
 await owner?.end();report.finishedAt=new Date().toISOString();
 try{await writeFile(reportPath,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});}catch{report.reportWriteFailed=true;}
 const passed=report.completed===true&&report.cleanupSucceeded===true&&report.sessionLoggedOut&&!report.reportWriteFailed;
 console.log(JSON.stringify({status:passed?'passed':'blocked',synthetic:true,organizationIndex,sessionScopeVerified,runs:report.runs?.length||0,duplicateCreationConverged:report.duplicateCreationConverged===true,peakConcurrentCreateRequests:report.peakConcurrentCreateRequests||0,exactlyOnceCreationUsageAndAudit:report.exactlyOnceCreationUsageAndAudit===true,sessionLoggedOut:report.sessionLoggedOut,cleanupSucceeded:report.cleanupSucceeded===true,creationOutcomeUnknown:report.creationOutcomeUnknown===true,reportPath,serverDeployed:false}));
 if(!passed){console.error('Local synthetic burst verification did not complete. Check private report and local records.');process.exitCode=1;}
}
