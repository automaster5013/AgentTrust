import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {verifyReceipt} from '../packages/receipts/signature.js';
import {runPortfolioScenario} from './portfolio-scenario.mjs';
import {localSmokeBase,fetchLocalSmoke} from './local-smoke-http.mjs';
import {readReleaseResponse} from './release-gate.mjs';
import {readTrustedReceiptKey} from './trusted-receipt-key.mjs';
import {writePortfolioEvidence} from './portfolio-evidence.mjs';
import {seededDemoScope,assertDemoSessionScope} from './demo-session-scope.mjs';
import {parseDemoOptions} from './demo-options.mjs';
import {checkDemoRunCapacity} from './demo-run-capacity.mjs';
import assert from 'node:assert/strict';

const reportPath='.local/portfolio-demo-'+randomUUID()+'.json';
let cookie,report={schemaVersion:1,completed:false,synthetic:true,serverDeployed:false},base,publicKey,scope,exportReceipts=false,organizationIndex=0,sessionScopeVerified=false;
let capacityPreflight={status:'not_reached'};
const receipts=[];
async function call(path,data){
  const response=await fetchLocalSmoke(base,path,{method:data?'POST':'GET',headers:{'Content-Type':'application/json','X-AgentTrust-Request':'local-ui','X-AgentTrust-Project':scope.projectId,'Idempotency-Key':randomUUID(),...(cookie?{Cookie:cookie}:{})},...(data?{body:JSON.stringify(data)}:{})});
  if(path==='/v1/auth/login')cookie=response.headers.get('set-cookie')?.split(';')[0];
  if(!response.ok){await response.body?.cancel();throw new Error('Local demo request failed');}return readReleaseResponse(response);
}
try{
  const options=parseDemoOptions(process.argv.slice(2),['--compare','--export-receipts']);
  organizationIndex=options.organizationIndex;
  const compare=options['--compare']===true;exportReceipts=options['--export-receipts']===true;
  base=localSmokeBase();
  const config=JSON.parse((await readFile('.local/credentials.json','utf8')).replace(/^\uFEFF/,''));
  const organization=config.organizations?.[options.organizationIndex];scope=seededDemoScope(organization);
  Object.assign(report,{organizationIndex:options.organizationIndex,...scope});
  const key=organization.credentials.find(c=>c.role==='admin').token;
  publicKey=await readTrustedReceiptKey('.local/receipt-signing/public.pem');
  await call('/v1/auth/login',{accessKey:key});
  assertDemoSessionScope(await call('/v1/me'),scope,'admin');
  sessionScopeVerified=true;
  capacityPreflight={status:'invalid_capacity',requestedRuns:compare?6:4};
  capacityPreflight=checkDemoRunCapacity(await call('/v1/operations'),scope,capacityPreflight.requestedRuns);assert.equal(capacityPreflight.status,'passed');
  report=await runPortfolioScenario({call,compare,verify:receipt=>{const verified=verifyReceipt(receipt,publicKey);if(exportReceipts)receipts.push(receipt);return verified;},onStep:item=>console.log(JSON.stringify(item)),wait:async id=>{
    const deadline=Date.now()+45000;
    while(Date.now()<deadline){const run=await call('/v1/runs/'+id);if(!['queued','running'].includes(run.state))return run;await sleep(100);}
    throw new Error('Local demo evaluation timed out');
  }});
}catch{report.completed=false;report.failed=true;}
finally{
  report.capacityPreflight=capacityPreflight;
  if(scope)Object.assign(report,{organizationIndex,...scope,sessionScopeVerified});
  report.sessionLoggedOut=!cookie;
  if(cookie)try{await call('/v1/auth/logout',{});report.sessionLoggedOut=true;}catch{report.sessionLoggedOut=false;}
  if(exportReceipts&&report.completed===true&&report.cleanupSucceeded===true&&report.sessionLoggedOut===true){
    try{report.evidenceBundle=await writePortfolioEvidence({receipts,report,trustedPem:publicKey});}
    catch{report.completed=false;report.evidenceWriteFailed=true;}
  }
  report.finishedAt=new Date().toISOString();
  try{await writeFile(reportPath,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});}catch{report.completed=false;report.reportWriteFailed=true;}
  const passed=report.completed===true&&report.cleanupSucceeded===true&&report.sessionLoggedOut===true&&!report.reportWriteFailed;
  console.log(JSON.stringify({status:passed?'passed':'blocked',synthetic:true,organizationIndex,capacityPreflightStatus:capacityPreflight.status,withBaselineComparison:report.withBaselineComparison===true,steps:report.steps?.length||0,cleanupSucceeded:report.cleanupSucceeded===true,sessionLoggedOut:report.sessionLoggedOut,reportPath,...(report.evidenceBundle?{evidenceBundle:report.evidenceBundle}:{}),serverDeployed:false}));
  if(!passed){console.error('Synthetic portfolio demo did not complete. Check local setup and private report; no release permission is granted by this report.');process.exitCode=1;}
}
