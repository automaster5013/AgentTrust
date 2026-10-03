import test from 'node:test';
import assert from 'node:assert/strict';
import { trustworthyOutcome } from '../apps/worker/outcome.js';
import { evaluate } from '../packages/evaluator/index.js';
import { incomplete } from '../apps/api/pg-store.js';
import { hash } from '../packages/contracts/hash.js';
import { validate } from '../packages/contracts/index.js';
import { boundedOutcome } from '../packages/evaluator/outcome.js';
import { assertJsonValue } from '../packages/contracts/json.js';
import { sampleDataset } from '../packages/contracts/samples.js';
const version=(id,data)=>({...data,id,contentHash:hash(data)});
function fixture(mode='compliant',dataset=sampleDataset){const snapshot={agent:version('a',{name:'Synthetic',mode}),dataset:version('d',dataset),policy:version('p',{name:'Synthetic',minimumPassRate:1})};return {snapshot,row:{snapshot,snapshot_hash:hash(snapshot),agent_version_id:'a',dataset_version_id:'d',policy_version_id:'p',case_budget:100}};}
test('honest worker outcomes and bounded incomplete failures preserve their decisions',()=>{
 for(const mode of ['compliant','regression','forbidden_tool','error','missing_evidence','unsafe_output']){const f=fixture(mode);assert.equal(trustworthyOutcome(f.row,evaluate(f.snapshot)),true);}
 assert.equal(trustworthyOutcome(fixture().row,incomplete('failed','Synthetic worker failure')),true);
});
test('worker outcome boundary rejects malformed, unsafe, inconsistent and over-budget completions',()=>{
 const f=fixture();
 const mutations=[o=>{o.results[0].evidence.output='Incorrect';},o=>{o.summary.pass--;},o=>{o.extra=true;},o=>{o.results=null;},o=>{o.gate.deploymentAllowed=false;},o=>{o.results[0].evidence.loop=o;},o=>{o.results[0].evidence.output='\u0000';},o=>{o.results[0].evidence.toolEvents=[{name:'lookup',args:{value:Infinity}}];}];
 for(const mutate of mutations){const outcome=evaluate(f.snapshot);mutate(outcome);assert.equal(trustworthyOutcome(f.row,outcome),false);}
 assert.equal(trustworthyOutcome({...f.row,case_budget:2},evaluate(f.snapshot)),false);assert.equal(trustworthyOutcome(f.row,incomplete('succeeded','Synthetic false pass')),false);
 const invalid=incomplete('failed','Synthetic failure');invalid.summary.rules=1;assert.equal(trustworthyOutcome(f.row,invalid),false);
});
test('valid near-budget input remains supported when result metadata exceeds the request node budget',()=>{
 const dataset={name:'Synthetic bounded workload',cases:Array.from({length:100},(_,i)=>({id:'c'+i,input:'x',mock:{output:'x',toolEvents:[{name:'lookup',args:{values:Array(200).fill(0)}}]},rules:Array.from({length:20},(_,j)=>({id:'r'+j,type:'contains',value:'x'}))}))};
 validate('dataset',dataset);const f=fixture('compliant',dataset),outcome=evaluate(f.snapshot);assert.throws(()=>assertJsonValue(outcome),/budget/);assert.equal(trustworthyOutcome(f.row,outcome),true);
});

test('oversized aggregate evidence is replaced before transferring it out of the evaluation thread',()=>{
 const value={results:Array(61000).fill(0)},bounded=boundedOutcome(value);assert.equal(bounded.state,'failed');assert.equal(bounded.gate.deploymentAllowed,false);assert.equal(bounded.results.length,0);
 const honest=evaluate(fixture().snapshot);assert.equal(boundedOutcome(honest),honest);
});


test('schema diagnostic amplification is bounded without losing failure truth or source evidence',()=>{
 const properties=Object.fromEntries(Array.from({length:30},(_,i)=>['property'+i,{type:'string'}])),schema={type:'array',items:{type:'object',required:Object.keys(properties),additionalProperties:false,properties}},output=JSON.stringify(Array.from({length:100},()=>({})));
 const dataset={name:'Synthetic schema errors',cases:[{id:'errors',input:'Synthetic',mock:{output,toolEvents:[]},rules:Array.from({length:20},(_,i)=>({id:'schema'+i,type:'json_schema',schema}))}]};validate('dataset',dataset);const f=fixture('compliant',dataset),outcome=evaluate(f.snapshot);
 assert.equal(outcome.gate.decision,'block');assert.equal(outcome.summary.fail,20);assert.equal(outcome.results[0].evidence.output,output);
 assert.ok(outcome.results[0].rules.every(r=>r.reason.length<=2000));assert.match(outcome.results[0].rules[0].reason,/3000 validation errors/);assert.equal(trustworthyOutcome(f.row,outcome),true);
});
test('outcome byte budget rejects huge strings even when the JSON node count is small',()=>{
 const dataset={name:'Synthetic byte bound',cases:[{id:'bytes',input:'Synthetic',mock:{output:'x',toolEvents:[]},rules:[{id:'required',type:'contains',value:'x'}]}]},f=fixture('compliant',dataset),outcome=evaluate(f.snapshot);outcome.results[0].evidence.output='x'+'가'.repeat(3000000);
 assertJsonValue(outcome,{maximumNodes:60000});assert.equal(trustworthyOutcome(f.row,outcome),false);const bounded=boundedOutcome(outcome);assert.equal(bounded.state,'failed');assert.equal(bounded.gate.deploymentAllowed,false);assert.equal(bounded.results.length,0);
});


test('truncated schema diagnostics remain valid Unicode and JSONB-storeable',()=>{
 const name='😀'.repeat(1400),dataset={name:'Synthetic Unicode diagnostics',cases:[{id:'unicode',input:'Synthetic',mock:{output:'{}',toolEvents:[]},rules:[{id:'schema',type:'json_schema',schema:{type:'object',properties:{[name]:{type:'string'}},required:[name],additionalProperties:false}}]}]};validate('dataset',dataset);const f=fixture('compliant',dataset),outcome=evaluate(f.snapshot),reason=outcome.results[0].rules[0].reason;
 assert.ok(reason.length<=2000);assert.equal(reason.isWellFormed(),true);assertJsonValue(outcome);assert.equal(outcome.gate.decision,'block');assert.equal(trustworthyOutcome(f.row,outcome),true);
});
