import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {verifyReceipt} from '../packages/receipts/signature.js';
import {runPortfolioScenario} from './portfolio-scenario.mjs';

const reportPath='.local/portfolio-demo-'+randomUUID()+'.json';
let cookie,report={schemaVersion:1,completed:false,synthetic:true,serverDeployed:false},base;
async function call(path,data){
  const response=await fetch(base+path,{method:data?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json','X-AgentTrust-Request':'local-ui','Idempotency-Key':randomUUID(),...(cookie?{Cookie:cookie}:{})},...(data?{body:JSON.stringify(data)}:{})});
  if(path==='/v1/auth/login')cookie=response.headers.get('set-cookie')?.split(';')[0];
  if(!response.ok)throw new Error('Local demo request failed');return response.json();
}
try{
  if(process.argv.length!==2)throw new Error('No arguments accepted');
  const port=process.env.PORT||'4310';if(!/^[1-9][0-9]{0,4}$/.test(port)||Number(port)>65535)throw new Error('Invalid local port');
  base='http://127.0.0.1:'+port;
  const config=JSON.parse((await readFile('.local/credentials.json','utf8')).replace(/^\uFEFF/,''));
  const key=config.organizations[0].credentials.find(c=>c.role==='admin').token;
  const publicKey=await readFile('.local/receipt-signing/public.pem','utf8');
  await call('/v1/auth/login',{accessKey:key});
  report=await runPortfolioScenario({call,verify:receipt=>verifyReceipt(receipt,publicKey),onStep:item=>console.log(JSON.stringify(item)),wait:async id=>{
    const deadline=Date.now()+45000;
    while(Date.now()<deadline){const run=await call('/v1/runs/'+id);if(!['queued','running'].includes(run.state))return run;await sleep(100);}
    throw new Error('Local demo evaluation timed out');
  }});
}catch{report.completed=false;report.failed=true;}
finally{
  report.sessionLoggedOut=!cookie;
  if(cookie)try{await call('/v1/auth/logout',{});report.sessionLoggedOut=true;}catch{report.sessionLoggedOut=false;}
  report.finishedAt=new Date().toISOString();
  try{await writeFile(reportPath,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});}catch{report.completed=false;report.reportWriteFailed=true;}
  const passed=report.completed===true&&report.cleanupSucceeded===true&&report.sessionLoggedOut===true&&!report.reportWriteFailed;
  console.log(JSON.stringify({status:passed?'passed':'blocked',synthetic:true,steps:report.steps?.length||0,cleanupSucceeded:report.cleanupSucceeded===true,sessionLoggedOut:report.sessionLoggedOut,reportPath,serverDeployed:false}));
  if(!passed){console.error('Synthetic portfolio demo did not complete. Check local setup and private report; no release permission is granted by this report.');process.exitCode=1;}
}
