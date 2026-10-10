import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const scenarios=new Set(['pass','block','missing_evidence','error']);

export async function callWorker(scenario,scope,token,request=fetch){
 try{
  if(!scenarios.has(scenario)||!uuid.test(scope.organizationId)||!uuid.test(scope.projectId)||!/^[a-f0-9]{64}$/.test(token))throw Error('INVALID_CONFIGURATION');
  const runId=randomUUID(),body={scenario,provider:'synthetic',runId,organizationId:scope.organizationId,projectId:scope.projectId};
  const response=await request('http://stack-ai-worker:8000/evaluate',{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),headers:{'Content-Type':'application/json','X-AgentTrust-Worker-Token':token},body:JSON.stringify(body)});
  if(!response.ok||!response.body)throw Error('WORKER_UNAVAILABLE');const reader=response.body.getReader(),chunks=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>8192)throw Error('WORKER_RESPONSE_LIMIT');chunks.push(value)}}finally{await reader.cancel()}
  const raw=Buffer.concat(chunks.map(value=>Buffer.from(value))),value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  if(Object.keys(value).sort().join(',')!=='organizationId,projectId,provider,result,runId,scenario'||value.provider!=='synthetic'||value.runId!==runId||value.organizationId!==scope.organizationId||value.projectId!==scope.projectId||value.scenario!==scenario)throw Error('WORKER_SCOPE_REFUSED');
  return {output:JSON.stringify(value.result),cached:false,metadata:{source:'python-fastapi',synthetic:true,scopeVerified:true}};
 }catch{return {error:'BOUNDED_SCOPED_WORKER_RESPONSE_UNAVAILABLE'}}
}

export default class WorkerProvider {
 id(){return 'agenttrust-python-evaluator'}
 async callApi(scenario){
  try{const rows=JSON.parse(readFileSync('/run/secrets/stack-demo-credentials','utf-8')),row=rows.find(row=>row.username==='demo-admin');return await callWorker(scenario,{organizationId:row.organizationId,projectId:row.projectId},readFileSync('/run/secrets/stack-worker-token','utf-8'));}
  catch{return {error:'PRIVATE_EVALUATOR_CONFIGURATION_UNAVAILABLE'}}
 }
}
