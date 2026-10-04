import {localSmokeBase,fetchLocalSmoke} from './local-smoke-http.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile,writeFile } from 'node:fs/promises';
import { verifyReceipt } from '../packages/receipts/signature.js';
const base=localSmokeBase();

const config=JSON.parse((await readFile('.local/credentials.json','utf8')).replace(/^\uFEFF/,''));
const accessKey=config.organizations[0].credentials.find(c=>c.role==='admin').token;
let cookie,run,approved=false,rejected=false;
async function call(path,{method='GET',data,key=randomUUID()}={}){
  const response=await fetchLocalSmoke(base,path,{method,headers:{'Content-Type':'application/json','X-AgentTrust-Request':'local-ui','Idempotency-Key':key,...(cookie?{Cookie:cookie}:{})},...(data?{body:JSON.stringify(data)}:{})});
  if(path==='/v1/auth/login')cookie=response.headers.get('set-cookie')?.split(';')[0];
  if(!response.ok)throw new Error(`Synthetic manual review request failed (${response.status}).`);return response.json();
}
await call('/v1/auth/login',{method:'POST',data:{accessKey}});
try{
  const catalog=await call('/v1/catalog');
  const policy=await call('/v1/policy-versions',{method:'POST',data:{name:'Synthetic administrator review smoke',minimumPassRate:1,requiresManualApproval:true,manualApprovalTtlSeconds:60}});
  const expected={agentVersionId:catalog.agent.find(v=>v.mode==='compliant').id,datasetVersionId:catalog.dataset[0].id,policyVersionId:policy.id};
  run=await call('/v1/runs',{method:'POST',data:expected});
  for(let i=0;i<50&&!['succeeded','failed','timed_out','cancelled'].includes(run.state);i++){await new Promise(resolve=>setTimeout(resolve,100));run=await call('/v1/runs/'+run.id);}
  assert.equal(run.gate.evaluationPassed,true);assert.equal(run.gate.deploymentAllowed,false);
  const check={candidateRunId:run.id,...expected};
  const missing=await call('/v1/release-gate',{method:'POST',data:check});assert.equal(missing.deploymentAllowed,false);assert.equal(missing.manualApproval.status,'missing');
  await call('/v1/runs/'+run.id+'/reviews',{method:'POST',data:{decision:'approved',comment:'Synthetic local smoke: mock evaluation evidence reviewed.'}});approved=true;
  const allowed=await call('/v1/release-gate',{method:'POST',data:check});assert.equal(allowed.deploymentAllowed,true);assert.equal(verifyReceipt(allowed,await readFile('.local/receipt-signing/public.pem','utf8')).signatureVerified,true);
  await call('/v1/runs/'+run.id+'/reviews',{method:'POST',data:{decision:'rejected',comment:'Synthetic local smoke completed. This example remains blocked.'}});rejected=true;
  const blocked=await call('/v1/release-gate',{method:'POST',data:check});assert.equal(blocked.deploymentAllowed,false);assert.equal(blocked.manualApproval.status,'rejected');
  await writeFile('.local/manual-review-smoke.json',JSON.stringify({runId:run.id,expected,missing,allowed,blocked},null,2)+'\n',{mode:0o600});
  console.log('Docker manual review smoke: evaluation PASS -> approval required -> signed release PASS -> rejection BLOCK.');
}finally{
  try{if(approved&&!rejected&&run)await call('/v1/runs/'+run.id+'/reviews',{method:'POST',data:{decision:'rejected',comment:'Synthetic smoke cleanup: keep this example blocked.'}});}
  finally{await call('/v1/auth/logout',{method:'POST',data:{}});}
}
