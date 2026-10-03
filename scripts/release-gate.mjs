import { readFile } from 'node:fs/promises';
import { verifyReceipt } from '../packages/receipts/signature.js';
import { randomUUID } from 'node:crypto';
import { hash } from '../packages/contracts/hash.js';
import { pathToFileURL } from 'node:url';

export async function checkRelease({base,accessKey,candidateRunId,baselineRunId,checkKey=randomUUID(),projectId,trustedPublicKey,...expected}) {
  const url=new URL(base);
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('CI bridge requires a loopback API URL.');
  if(expected.maxAgeSeconds!==undefined&&(!Number.isInteger(expected.maxAgeSeconds)||expected.maxAgeSeconds<1||expected.maxAgeSeconds>86400))throw new Error('Invalid result validity window.');
  const request={candidateRunId,...(baselineRunId?{baselineRunId}:{}),...expected};
  const headers={'Content-Type':'application/json','X-AgentTrust-Request':'local-ui',...(projectId?{'X-AgentTrust-Project':projectId}:{})};
  const call=async(path,options={})=>{
    const response=await fetch(new URL(path,url),{...options,headers:{...headers,...options.headers},redirect:'error',signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new Error(`AgentTrust API rejected request (${response.status}).`);
    return response;
  };
  const check=async authorization=>{
    const response=await call('/v1/release-gate',{method:'POST',headers:{...authorization,'Idempotency-Key':checkKey},body:JSON.stringify(request)});
    const result=await response.json();
    if(typeof result.deploymentAllowed!=='boolean'||!['pass','block'].includes(result.decision)||result.runId!==candidateRunId||!result.artifact||hash(result.artifact.request)!==hash(request)||result.artifactHash!==hash(result.artifact)||hash(result.artifact.result)!==hash(Object.fromEntries(Object.entries(result).filter(([k])=>!['artifact','artifactHash','signature'].includes(k)))))throw new Error('Release receipt integrity verification failed.');
    if(trustedPublicKey)verifyReceipt(result,trustedPublicKey);
    return result;
  };
  if(typeof accessKey==='string'&&accessKey.startsWith('atci_'))return check({Authorization:`Bearer ${accessKey}`});
  const login=await call('/v1/auth/login',{method:'POST',body:JSON.stringify({accessKey})});
  const cookie=login.headers.get('set-cookie')?.split(';')[0];
  if(!cookie)throw new Error('Session is missing.');
  try {
    return await check({Cookie:cookie});
  } finally {
    await call('/v1/auth/logout',{method:'POST',headers:{Cookie:cookie},body:'{}'});
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try {
    const result=await checkRelease({base:process.env.AGENTTRUST_URL||'http://127.0.0.1:4310/',accessKey:process.env.AGENTTRUST_ACCESS_KEY,
      trustedPublicKey:process.env.AGENTTRUST_RECEIPT_PUBLIC_KEY_FILE?await readFile(process.env.AGENTTRUST_RECEIPT_PUBLIC_KEY_FILE,'utf8'):undefined,projectId:process.env.AGENTTRUST_PROJECT_ID,checkKey:process.env.AGENTTRUST_CHECK_KEY,candidateRunId:process.env.AGENTTRUST_RUN_ID,baselineRunId:process.env.AGENTTRUST_BASELINE_RUN_ID,
      agentVersionId:process.env.AGENTTRUST_AGENT_VERSION_ID,datasetVersionId:process.env.AGENTTRUST_DATASET_VERSION_ID,
      policyVersionId:process.env.AGENTTRUST_POLICY_VERSION_ID,maxAgeSeconds:Number(process.env.AGENTTRUST_MAX_AGE_SECONDS||600)});
    console.log(JSON.stringify(result));process.exitCode=result.deploymentAllowed?0:1;
  } catch { console.error('AgentTrust release gate could not verify approval.');process.exitCode=2; }
}
