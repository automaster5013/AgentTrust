import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {connectorGrader,digest,CONTRACT,strictJson,flatSchema,validateSample} from './connector-policy.mjs';
const require=createRequire(process.env.AGENTTRUST_EXISTING_PROMPTFOO_PACKAGE??new URL('./package.json',import.meta.url));
const Ajv=require('ajv');assert.equal(require('ajv/package.json').version,'8.20.0');
const cases=()=>JSON.parse(readFileSync(new URL('./connector-cases.json',import.meta.url),'utf8')).cases;
const sample=c=>({contract:CONTRACT,case:c,contentSha256:digest({contract:CONTRACT,case:c})});
const grade=connectorGrader(Ajv);
test('five original recorded sample rules pass actual Ajv and literal checks',()=>{
 const results=cases().map(c=>grade(sample(c)));assert.equal(results.flatMap(r=>r.statuses).length,5);assert.ok(results.every(r=>r.statuses.every(s=>s==='pass')));
});
test('tool allowlist applies supplied argument schemas and keeps missing distinct from empty',()=>{
 for(const [events,status] of [[null,'inconclusive'],[[{name:null,args:{}}],'inconclusive'],[[{name:'lookup_order',args:null}],'inconclusive'],[[],'pass'],[[{name:'transfer_funds',args:{}}],'fail'],[[{name:'lookup_order',args:{}}],'fail'],[[{name:'lookup_order',args:{orderId:'x',extra:'x'}}],'fail']]){const c=cases()[0];c.evidence.toolEvents=events;assert.equal(grade(sample(c)).statuses[2],status)}
});
test('JSON shape, duplicate escaped keys and unsupported schema capabilities fail closed',()=>{
 for(const output of ['not json','[]','null','{"status":1}','{}','{"status":"wrong"}','{"status":"review_required","extra":"x"}','{"status":"wrong","status":"review_required"}','{"status":"wrong","st\\u0061tus":"review_required"}']){const c=cases()[1];c.evidence.output=output;assert.equal(grade(sample(c)).statuses[0],'fail')}
 const c=cases()[1];for(const change of [{$ref:'https://untrusted'},{additionalProperties:true},{required:['other']},{properties:{status:{type:'number'}}},{properties:{status:{type:'string',pattern:'.*'}}}])assert.throws(()=>flatSchema({...c.rules[0].schema,...change}));
});
test('strict JSON rejects deep data, non-finite values and duplicated protocol fields',()=>{
 for(const value of ['{"x":1,"x":2}','{"x":1,"\\u0078":2}','{"x":NaN}','{"x":Infinity}','{"x":1e999}','['.repeat(14)+'0'+']'.repeat(14)])assert.throws(()=>strictJson(value));
 assert.deepEqual(strictJson('{"x":[true,false,null,"\\uD83D\\uDE00"]}'),{x:[true,false,null,'😀']});
});
test('Unicode string length uses code points without normalizing decomposed text',()=>{
 const c=cases()[1];c.rules[0].schema.properties.status={type:'string',minLength:1,maxLength:1};c.evidence.output=JSON.stringify({status:'😀'});assert.equal(grade(sample(c)).statuses[0],'pass');c.evidence.output=JSON.stringify({status:'e\u0301'});assert.equal(grade(sample(c)).statuses[0],'fail');
});
test('sample content hash binds arguments and all declarations',()=>{
 const s=sample(cases()[0]);s.case.evidence.toolEvents[0].args.orderId='changed';assert.throws(()=>validateSample(s));
});

test('Ajv initialization is outside request processing and per-observation schemas are released',()=>{
 let instances=0,released=0;
 class TrackedAjv extends Ajv{constructor(options){super(options);instances++}removeSchema(schema){released++;return super.removeSchema(schema)}}
 const prepared=connectorGrader(TrackedAjv);assert.equal(instances,1);const initializedReleases=released;
 for(const c of cases()){const result=prepared(sample(c));assert.ok(result.statuses.every(s=>s==='pass'))}
 assert.equal(instances,1);assert.ok(released>=initializedReleases+2);
});
