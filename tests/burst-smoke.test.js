import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {parseBurstArgs,runBurstScenario} from '../scripts/burst-smoke-scenario.mjs';
const modes=['compliant','regression','forbidden_tool','error','missing_evidence','unsafe_output'];
function fixture(){
 const catalog={dataset:[{id:randomUUID(),name:'Customer support safety · v1'}],policy:[{id:randomUUID(),requiresManualApproval:false}],agent:modes.map(mode=>({id:randomUUID(),mode}))};
 const keys=new Map(),records=new Map(),cancelled=[];let peak=0,active=0,creates=0,accounted=false;
 return {cancelled,records,get peak(){return peak;},get creates(){return creates;},get accounted(){return accounted;},options:{
  call:async(path,input,key)=>{
   if(path==='/v1/catalog')return catalog;
   if(path==='/v1/runs'){
    creates++;await new Promise(resolve=>setImmediate(resolve));
    if(keys.has(key))return {id:keys.get(key)};
    const id=randomUUID(),mode=catalog.agent.find(a=>a.id===input.agentVersionId).mode;
    keys.set(key,id);records.set(id,{id,...input,mode});active++;peak=Math.max(peak,active);return {id};
   }
   if(path.endsWith('/cancel')){cancelled.push(path.split('/')[3]);return {};}
   if(path==='/v1/release-gate')return {runId:input.candidateRunId,deploymentAllowed:records.get(input.candidateRunId).mode==='compliant'};
   throw Error('Unexpected route');
  },wait:async id=>{
   await new Promise(resolve=>setImmediate(resolve));active--;const r=records.get(id),decision=r.mode==='compliant'?'pass':['error','missing_evidence'].includes(r.mode)?'inconclusive':'block';
   return {...r,state:r.mode==='error'?'failed':'succeeded',gate:{decision,deploymentAllowed:decision==='pass'},results:[{}],attempts:1};
  },verify:()=>({signatureVerified:true}),verifyAccounting:async rows=>{assert.equal(rows.length,12);accounted=true;}
 }};
}
test('burst argument bounds reject ambiguous or unbounded requests',()=>{
 assert.equal(parseBurstArgs([]),12);assert.equal(parseBurstArgs(['--runs','20']),20);
 for(const args of [['--runs','1'],['--runs','21'],['--runs','02'],['--runs','2\n'],['--runs'],['--unknown','2'],['--runs','2','--runs','2']])assert.throws(()=>parseBurstArgs(args));
});
test('burst bounds outstanding logical runs and converges duplicate requests with signed and accounting evidence',async()=>{
 const f=fixture(),r=await runBurstScenario(f.options);assert.equal(r.completed,true);assert.equal(r.duplicateCreationConverged,true);assert.equal(r.signedPassAndBlockVerified,true);assert.equal(r.exactlyOnceCreationUsageAndAudit,true);assert.equal(f.accounted,true);assert.equal(f.creates,15);assert.ok(f.peak<=4);assert.equal(r.runs.length,12);assert.deepEqual(f.cancelled,[]);
});
test('burst settles in-flight creation before cleanup after partial creation failure',async()=>{
 const f=fixture(),call=f.options.call;let calls=0,pending=0,cancelDuringCreate=false;
 f.options.call=async(path,input,key)=>{
  if(path.endsWith('/cancel'))cancelDuringCreate ||= pending>0;
  if(path!=='/v1/runs')return call(path,input,key);
  const index=++calls;if(index<=4)return call(path,input,key);pending++;
  try{await new Promise(resolve=>setTimeout(resolve,index===6?1:10));if(index===6)throw Error('Synthetic creation failure');return await call(path,input,key);}finally{pending--;}
 };
 const r=await runBurstScenario(f.options);assert.equal(r.completed,false);assert.equal(r.creationOutcomeUnknown,true);assert.equal(cancelDuringCreate,false);assert.ok(f.cancelled.every(id=>f.records.has(id)));assert.equal(r.cleanupSucceeded,true);
});
test('invalid terminal evidence, signatures and accounting never complete burst verification',async()=>{
 for(const kind of ['terminal','signature','accounting']){
  const f=fixture();if(kind==='terminal'){const wait=f.options.wait;f.options.wait=async id=>({...await wait(id),gate:{decision:'pass',deploymentAllowed:true}});}
  if(kind==='signature')f.options.verify=()=>({signatureVerified:false});
  if(kind==='accounting')f.options.verifyAccounting=async()=>{throw Error('Synthetic accounting mismatch');};
  const r=await runBurstScenario(f.options);assert.equal(r.completed,false);assert.equal(r.exactlyOnceCreationUsageAndAudit,undefined);assert.ok(f.cancelled.every(id=>f.records.has(id)));
 }
});
