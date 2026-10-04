import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {verifyReceipt} from '../packages/receipts/signature.js';
import {runRoleScenario} from './portfolio-roles-scenario.mjs';
import {localSmokeBase,fetchLocalSmoke} from './local-smoke-http.mjs';
import {readReleaseResponse} from './release-gate.mjs';
import {readTrustedReceiptKey} from './trusted-receipt-key.mjs';

const reportPath='.local/portfolio-roles-'+randomUUID()+'.json',sessions=new Map();
let base,report={schemaVersion:1,synthetic:true,completed:false,serverDeployed:false};
async function call(role,path,data,expected){
  const session=sessions.get(role);if(!session)throw Error('Missing local session');
  const response=await fetchLocalSmoke(base,path,{method:data?'POST':'GET',headers:{'Content-Type':'application/json','X-AgentTrust-Request':'local-ui','X-AgentTrust-Project':session.projectId,'Idempotency-Key':randomUUID(),...(session.cookie?{Cookie:session.cookie}:{})},...(data?{body:JSON.stringify(data)}:{})});
  if(path==='/v1/auth/login')session.cookie=response.headers.get('set-cookie')?.split(';')[0];
  if(expected){if(response.status!==expected)throw Error('Unexpected authorization status');await response.body?.cancel();return;}
  if(!response.ok){await response.body?.cancel();throw Error('Local role demonstration request failed');}return readReleaseResponse(response);
}
try{
  if(process.argv.length!==2)throw Error('No arguments accepted');
  base=localSmokeBase();
  const config=JSON.parse((await readFile('.local/credentials.json','utf8')).replace(/^\uFEFF/,''));
  const publicKey=await readTrustedReceiptKey('.local/receipt-signing/public.pem');
  for(const role of ['admin','editor','viewer','outsider']){
    const organization=config.organizations[role==='outsider'?1:0],actualRole=role==='outsider'?'viewer':role;
    sessions.set(role,{projectId:organization.projectId});
    await call(role,'/v1/auth/login',{accessKey:organization.credentials.find(c=>c.role===actualRole).token});
    const me=await call(role,'/v1/me');if(me.role!==actualRole)throw Error('Local role mismatch');
  }
  report=await runRoleScenario({call,verify:r=>verifyReceipt(r,publicKey),onStep:s=>console.log(JSON.stringify(s)),wait:async id=>{
    const deadline=Date.now()+45000;while(Date.now()<deadline){const r=await call('editor','/v1/runs/'+id);if(!['queued','running'].includes(r.state))return r;await sleep(100);}throw Error('Local role evaluation timeout');
  }});
}catch{report.completed=false;report.failed=true;}
finally{
  report.sessionsLoggedOut=true;
  for(const [role,session] of sessions)if(session.cookie)try{await call(role,'/v1/auth/logout',{});}catch{report.sessionsLoggedOut=false;}
  report.finishedAt=new Date().toISOString();
  try{await writeFile(reportPath,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});}catch{report.reportWriteFailed=true;}
  const passed=report.completed===true&&report.cleanupSucceeded===true&&report.sessionsLoggedOut&&!report.reportWriteFailed;
  console.log(JSON.stringify({status:passed?'passed':'blocked',synthetic:true,steps:report.steps?.length||0,cleanupSucceeded:report.cleanupSucceeded===true,sessionsLoggedOut:report.sessionsLoggedOut,reportPath,serverDeployed:false}));
  if(!passed){console.error('Synthetic role demonstration did not complete. Check local setup and private report.');process.exitCode=1;}
}
