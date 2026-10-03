import test from 'node:test';
import assert from 'node:assert/strict';
import { compileEvidenceSchema,evidenceSchemaCacheStats,validate } from '../packages/contracts/index.js';
import { evaluate } from '../packages/evaluator/index.js';

test('canonical schema reuse preserves validation and isolates caller mutations',()=>{
  const schema={type:'object',enum:[{ok:true}]},validator=compileEvidenceSchema(schema);
  schema.enum[0].ok=false;
  assert.equal(validator({ok:true}),true);assert.equal(validator({ok:false}),false);
  const again=compileEvidenceSchema({enum:[{ok:true}],type:'object'});assert.equal(again,validator);
  assert.equal(again({ok:true}),true);assert.equal(again.errors,null);
  assert.throws(()=>{validator.schema.enum[0].ok=false;},TypeError);
  assert.throws(()=>compileEvidenceSchema({type:'string',pattern:'.*'}));
});

test('schema cache evicts entries and remains within its count and serialized-source budgets',()=>{
  const first=compileEvidenceSchema({type:'integer',minimum:-1000});
  for(let value=0;value<140;value++)compileEvidenceSchema({type:'integer',minimum:value});
  assert.notEqual(compileEvidenceSchema({type:'integer',minimum:-1000}),first);
  for(let value=0;value<20;value++)compileEvidenceSchema({type:'string',enum:[String(value)+'x'.repeat(20000)]});
  const stats=evidenceSchemaCacheStats();assert.ok(stats.entries<=stats.maximumEntries);assert.ok(stats.sourceBytes<=stats.maximumSourceBytes);
  assert.equal(compileEvidenceSchema({type:'integer',minimum:5})(4),false);
});

function dataset(distinct=false){
  return {name:'Synthetic repeated schemas',cases:Array.from({length:65},(_,caseIndex)=>({id:'c'+caseIndex,input:'Synthetic',mock:{output:'1',toolEvents:[]},rules:Array.from({length:2},(_,ruleIndex)=>({id:'r'+ruleIndex,type:'json_schema',required:true,schema:{type:'integer',minimum:distinct?caseIndex*2+ruleIndex:0}}))}))};
}
test('datasets compile repeated schemas once and reject excessive distinct schema workloads',()=>{
  const repeated=validate('dataset',dataset());
  assert.equal(evaluate({agent:{mode:'compliant'},dataset:repeated,policy:{minimumPassRate:1}}).gate.decision,'pass');
  assert.throws(()=>validate('dataset',dataset(true)),/128 distinct/);
  const maximum=dataset(true);maximum.cases.at(-1).rules=maximum.cases.at(-1).rules.slice(0,1);maximum.cases.at(-2).rules=maximum.cases.at(-2).rules.slice(0,1);
  assert.equal(validate('dataset',maximum).cases.length,65);
});
