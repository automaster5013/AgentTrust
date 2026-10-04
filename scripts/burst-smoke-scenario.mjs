import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const outcomes=[['compliant','succeeded','pass'],['regression','succeeded','block'],['forbidden_tool','succeeded','block'],['error','failed','inconclusive'],['missing_evidence','succeeded','inconclusive'],['unsafe_output','succeeded','block']];
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
export function parseBurstArgs(args){
 if(!args.length)return 12;
 if(args.length!==2||args[0]!=='--runs'||!/^[1-9][0-9]?$/.test(args[1])||String(Number(args[1]))!==args[1]||Number(args[1])<2||Number(args[1])>20)throw Error('Use --runs 2..20 once.');
 return Number(args[1]);
}
async function boundedMap(items,limit,work){
 const results=new Array(items.length);let cursor=0,failure;
 await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{
  while(!failure&&cursor<items.length){const index=cursor++;try{results[index]=await work(items[index],index);}catch(error){failure??=error;}}
 }));
 if(failure)throw failure;return results;
}
export async function runBurstScenario({call,wait,verify,verifyAccounting,runs=12}){
 const report={schemaVersion:1,synthetic:true,serverDeployed:false,completed:false,requestedRuns:runs,duplicateCopies:4,createConcurrencyLimit:4,peakConcurrentCreateRequests:0,runs:[]};
 const active=new Set();let concurrent=0;
 try{
  assert.ok(Number.isInteger(runs)&&runs>=2&&runs<=20,'Invalid burst size.');
  const catalog=await call('/v1/catalog');const dataset=catalog.dataset.find(d=>d.name==='Customer support safety · v1'),policy=catalog.policy.find(p=>!p.requiresManualApproval);
  assert.ok(dataset&&policy,'Expected seeded synthetic versions.');
  const jobs=Array.from({length:runs},(_,i)=>{const [mode,state,decision]=outcomes[i%outcomes.length],agent=catalog.agent.find(a=>a.mode===mode);assert.ok(agent,'Expected seeded mock mode.');return {mode,state,decision,input:{agentVersionId:agent.id,datasetVersionId:dataset.id,policyVersionId:policy.id,timeoutMs:30000,caseBudget:100}};});
  const create=async(job,key)=>{
   concurrent++;report.peakConcurrentCreateRequests=Math.max(report.peakConcurrentCreateRequests,concurrent);
   try{const run=await call('/v1/runs',job.input,key);if(!uuid(run?.id)){report.creationOutcomeUnknown=true;throw Error('Invalid synthetic run identity.');}active.add(run.id);return run.id;}
   catch(error){report.creationOutcomeUnknown=true;throw error;}finally{concurrent--;}
  };
  const duplicateKey=randomUUID(),copies=await boundedMap(Array.from({length:4},()=>jobs[0]),4,job=>create(job,duplicateKey));
  assert.equal(new Set(copies).size,1,'Duplicate creation did not converge.');jobs[0].id=copies[0];report.duplicateCreationConverged=true;
  await boundedMap(jobs,4,async job=>{
   if(!job.id)job.id=await create(job,randomUUID());
   const run=await wait(job.id);assert.equal(run.id,job.id);assert.equal(run.state,job.state);assert.equal(run.gate.decision,job.decision);assert.equal(run.gate.deploymentAllowed,job.decision==='pass');
   for(const field of ['agentVersionId','datasetVersionId','policyVersionId'])assert.equal(run[field],job.input[field]);
   assert.ok(Array.isArray(run.results)&&Number.isInteger(run.attempts)&&run.attempts>=1);active.delete(job.id);
   report.runs.push({id:job.id,mode:job.mode,state:run.state,decision:run.gate.decision,cases:run.results.length,attempts:run.attempts});
  });
  assert.equal(new Set(jobs.map(job=>job.id)).size,runs,'Distinct requests did not produce distinct runs.');
  for(const job of jobs.slice(0,2)){
   const {timeoutMs,caseBudget,...versions}=job.input;const receipt=await call('/v1/release-gate',{candidateRunId:job.id,...versions},randomUUID());
   assert.equal(receipt.runId,job.id);assert.equal(receipt.deploymentAllowed,job.decision==='pass');assert.equal(verify(receipt).signatureVerified,true);
  }
  report.signedPassAndBlockVerified=true;await verifyAccounting(report.runs);report.exactlyOnceCreationUsageAndAudit=true;report.completed=true;
 }catch{report.failed=true;report.completed=false;}
 finally{
  report.cleanupSucceeded=true;
  for(const id of active)try{await call('/v1/runs/'+id+'/cancel',{});}catch{report.cleanupSucceeded=false;}
 }
 return report;
}
