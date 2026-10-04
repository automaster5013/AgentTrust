import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { readFile,writeFile } from 'node:fs/promises';
import { checkRelease,saveReleaseReceipt } from './release-gate.mjs';
import { verifyReceipt } from '../packages/receipts/signature.js';

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
  const trustedPublicKey=await readFile('.local/receipt-signing/public.pem','utf8');
  const options={trustedPublicKey,base,accessKey:credential.token,checkKey:randomUUID(),candidateRunId:run.id,agentVersionId:run.agentVersionId,datasetVersionId:run.datasetVersionId,policyVersionId:run.policyVersionId};
  const result=await checkRelease(options);
  const replay=await checkRelease(options);assert.equal(replay.artifactHash,result.artifactHash);
  assert.equal(result.deploymentAllowed,true);
  const receipt=await call(`/v1/release-receipts/${result.artifact.receiptId}`);assert.equal(receipt.artifactHash,result.artifactHash);assert.equal(verifyReceipt(receipt,trustedPublicKey).signatureVerified,true);
  const exportPath='.local/ci-export-'+result.artifact.receiptId+'.json';
  await saveReleaseReceipt(exportPath,result);
  const exported=JSON.parse(await readFile(exportPath,'utf8'));assert.equal(exported.artifactHash,result.artifactHash);assert.equal(verifyReceipt(exported,trustedPublicKey).signatureVerified,true);
  await writeFile('.local/ci-smoke-receipt.json',JSON.stringify(receipt,null,2)+'\n',{mode:0o600});
  console.log('Docker CI smoke: project key -> idempotent release approval -> verified Ed25519 signed receipt.');
}finally{
  try{if(credential)await call(`/v1/ci-credentials/${credential.id}/revoke`,{method:'POST',data:{}});}
  finally{await call('/v1/auth/logout',{method:'POST',data:{}});}
}
