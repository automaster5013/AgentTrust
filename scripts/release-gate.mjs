import { releaseGate } from '../packages/evaluator/comparison.js';
import { pathToFileURL } from 'node:url';

export async function checkRelease({base,accessKey,candidateRunId,baselineRunId,...expected}) {
  const url=new URL(base);
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('CI bridge requires a loopback API URL.');
  const headers={'Content-Type':'application/json','X-AgentTrust-Request':'local-ui'};
  const call=async(path,options={})=>{
    const response=await fetch(new URL(path,url),{...options,headers:{...headers,...options.headers},redirect:'error',signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new Error(`AgentTrust API rejected request (${response.status}).`);
    return response;
  };
  const login=await call('/v1/auth/login',{method:'POST',body:JSON.stringify({accessKey})});
  const cookie=login.headers.get('set-cookie')?.split(';')[0];
  if(!cookie)throw new Error('Session is missing.');
  try {
    const read=async id=>(await call(`/v1/runs/${encodeURIComponent(id)}`,{headers:{Cookie:cookie}})).json();
    const run=await read(candidateRunId),baseline=baselineRunId?await read(baselineRunId):undefined;
    return releaseGate(run,expected,baseline);
  } finally {
    await call('/v1/auth/logout',{method:'POST',headers:{Cookie:cookie},body:'{}'});
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try {
    const result=await checkRelease({base:process.env.AGENTTRUST_URL||'http://127.0.0.1:4310/',accessKey:process.env.AGENTTRUST_ACCESS_KEY,
      candidateRunId:process.env.AGENTTRUST_RUN_ID,baselineRunId:process.env.AGENTTRUST_BASELINE_RUN_ID,
      agentVersionId:process.env.AGENTTRUST_AGENT_VERSION_ID,datasetVersionId:process.env.AGENTTRUST_DATASET_VERSION_ID,
      policyVersionId:process.env.AGENTTRUST_POLICY_VERSION_ID,maxAgeSeconds:Number(process.env.AGENTTRUST_MAX_AGE_SECONDS||600)});
    console.log(JSON.stringify(result));process.exitCode=result.deploymentAllowed?0:1;
  } catch { console.error('AgentTrust release gate could not verify approval.');process.exitCode=2; }
}
