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
