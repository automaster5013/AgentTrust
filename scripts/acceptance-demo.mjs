import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {readConnectorJson} from './check-connector-contract.mjs';
import {validateAcceptanceProfile} from './acceptance-profile.mjs';
import {runAcceptanceScenario} from './acceptance-scenario.mjs';
import {localSmokeBase,fetchLocalSmoke} from './local-smoke-http.mjs';
import {readReleaseResponse} from './release-gate.mjs';
import {readTrustedReceiptKey} from './trusted-receipt-key.mjs';
import {verifyReceipt} from '../packages/receipts/signature.js';
import {seededDemoScope,assertDemoSessionScope} from './demo-session-scope.mjs';
import {checkDemoRunCapacity} from './demo-run-capacity.mjs';
export function parseAcceptanceOptions(args){
 const result={organizationIndex:0,profile:fileURLToPath(new URL('../examples/connector-contract/acceptance-profile.json',import.meta.url))},seen=new Set();
 for(let i=0;i<args.length;i+=2){const flag=args[i],value=args[i+1];assert.ok(['--organization-index','--profile'].includes(flag)&&!seen.has(flag)&&typeof value==='string'&&value&&!value.startsWith('--'));seen.add(flag);if(flag==='--organization-index'){assert.match(value,/^(0|[1-9][0-9]?)$/);result.organizationIndex=Number(value);}else result.profile=value;}
 return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const reportPath='.local/acceptance-demo-'+randomUUID()+'.json';let cookie,base,scope,organizationIndex=0,sessionScopeVerified=false,report={schemaVersion:1,purpose:'synthetic-acceptance-demonstration',synthetic:true,completed:false,serverDeployed:false},capacity={status:'not_reached'};
 async function call(path,data){const response=await fetchLocalSmoke(base,path,{method:data?'POST':'GET',headers:{'Content-Type':'application/json','X-AgentTrust-Request':'local-ui','X-AgentTrust-Project':scope.projectId,'Idempotency-Key':randomUUID(),...(cookie?{Cookie:cookie}:{})},...(data?{body:JSON.stringify(data)}:{})});if(path==='/v1/auth/login')cookie=response.headers.get('set-cookie')?.split(';')[0];if(!response.ok){await response.body?.cancel();throw Error('Acceptance demonstration request failed');}return readReleaseResponse(response);}
 try{
  const options=parseAcceptanceOptions(process.argv.slice(2));organizationIndex=options.organizationIndex;const profile=validateAcceptanceProfile((await readConnectorJson(options.profile)).value);
  base=localSmokeBase();const config=JSON.parse((await readFile('.local/credentials.json','utf8')).replace(/^\uFEFF/,'')),organization=config.organizations?.[organizationIndex];scope=seededDemoScope(organization);const key=organization.credentials.find(c=>c.role==='admin').token,publicKey=await readTrustedReceiptKey('.local/receipt-signing/public.pem');
  await call('/v1/auth/login',{accessKey:key});assertDemoSessionScope(await call('/v1/me'),scope,'admin');sessionScopeVerified=true;
  const operations=await call('/v1/operations');capacity=checkDemoRunCapacity(operations,scope,6);assert.equal(capacity.status,'passed');assert.equal(operations.worker?.state,'recent');
  report=await runAcceptanceScenario({profile,scope,call,verify:receipt=>verifyReceipt(receipt,publicKey),wait:async id=>{const deadline=Date.now()+45000;while(Date.now()<deadline){const run=await call('/v1/runs/'+id);if(!['queued','running'].includes(run.state))return run;await sleep(100);}throw Error('Acceptance evaluation timed out');}});
 }catch{report.completed=false;report.failed=true;}
 finally{
  Object.assign(report,{organizationIndex,...(scope||{}),sessionScopeVerified,capacityPreflight:capacity,sessionLoggedOut:!cookie});if(cookie)try{await call('/v1/auth/logout',{});report.sessionLoggedOut=true;}catch{report.sessionLoggedOut=false;}
  report.finishedAt=new Date().toISOString();try{await writeFile(reportPath,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});}catch{report.completed=false;report.reportWriteFailed=true;}
  const passed=report.completed&&report.cleanupSucceeded&&report.sessionLoggedOut&&!report.reportWriteFailed;console.log(JSON.stringify({schemaVersion:1,purpose:'synthetic-acceptance-demonstration',status:passed?'passed':'blocked',synthetic:true,organizationIndex,sessionScopeVerified,capacityPreflightStatus:capacity.status,requestedRuns:6,criteriaReused:passed&&report.criteria.dataset.reused&&report.criteria.policy.reused,steps:report.steps?.length||0,signaturesVerified:report.steps?.filter(step=>step.signatureVerified).length||0,cleanupSucceeded:report.cleanupSucceeded===true,sessionLoggedOut:report.sessionLoggedOut,reportPath,serverDeployed:false}));if(!passed)process.exitCode=1;
 }
}
