import assert from 'node:assert/strict';
import { readFile,writeFile } from 'node:fs/promises';
import { checkRelease } from './release-gate.mjs';

const config=JSON.parse((await readFile('.local/credentials.json','utf8')).replace(/^\uFEFF/,''));
const accessKey=config.organizations[0].credentials.find(c=>c.role==='admin').token;
const checkpoint=JSON.parse(await readFile('.local/restart-check.json','utf8'));
const base=`http://127.0.0.1:${process.env.PORT||4310}/`;
let cookie,credential;
async function call(path,{method='GET',data}={}){
  const response=await fetch(new URL(path,base),{method,headers:{'Content-Type':'application/json','X-AgentTrust-Request':'local-ui',...(cookie?{Cookie:cookie}:{})},...(data?{body:JSON.stringify(data)}:{})});
  if(path==='/v1/auth/login')cookie=response.headers.get('set-cookie')?.split(';')[0];
  if(!response.ok)throw new Error(`CI smoke request failed (${response.status}).`);return response.json();
}
await call('/v1/auth/login',{method:'POST',data:{accessKey}});
try{
  const run=await call(`/v1/runs/${checkpoint.id}`),me=await call('/v1/me');
  credential=await call('/v1/ci-credentials',{method:'POST',data:{name:'Temporary Docker CI smoke',projectId:me.projectId,ttlSeconds:60}});
  const result=await checkRelease({base,accessKey:credential.token,candidateRunId:run.id,agentVersionId:run.agentVersionId,datasetVersionId:run.datasetVersionId,policyVersionId:run.policyVersionId});
  assert.equal(result.deploymentAllowed,true);
  const receipt=await call(`/v1/release-receipts/${result.artifact.receiptId}`);assert.equal(receipt.artifactHash,result.artifactHash);
  await writeFile('.local/ci-smoke-receipt.json',JSON.stringify(receipt,null,2)+'\n',{mode:0o600});
  console.log('Docker CI smoke: project key -> release approval -> verified immutable receipt.');
}finally{
  try{if(credential)await call(`/v1/ci-credentials/${credential.id}/revoke`,{method:'POST',data:{}});}
  finally{await call('/v1/auth/logout',{method:'POST',data:{}});}
}
