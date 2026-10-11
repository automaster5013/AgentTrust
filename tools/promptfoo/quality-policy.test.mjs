import test from 'node:test';
import assert from 'node:assert/strict';
import {gradeRaw,profileHash} from './quality-policy.mjs';

test('actual Promptfoo grades exact JSON answers and refuses disagreement',async()=>{
 const pass=await gradeRaw('{"answer":"  READY  "}','READY');assert.equal(pass.pass,true);assert.equal(pass.assertions,2);
 const fail=await gradeRaw('{"answer":"DENIED"}','READY');assert.equal(fail.pass,false);assert.equal(fail.graded,true);
 assert.match(profileHash(),/^[a-f0-9]{64}$/);
});
test('malformed, duplicate, missing and additional answer fields cannot pass',async()=>{
 for(const sample of ['not JSON','{}','{"answer":null}','{"answer":"READY","other":1}','{"answer":"DENIED","answer":"READY"}','["READY"]'])assert.equal((await gradeRaw(sample,'READY')).pass,false);
});
test('Unicode normalization is explicit and caller template syntax stays literal',async()=>{
 assert.equal((await gradeRaw(JSON.stringify({answer:'e\u0301'}),'é')).pass,true);
 const literal='{{env.DO_NOT_EXPAND}}';assert.equal((await gradeRaw(JSON.stringify({answer:literal}),literal)).pass,true);
 assert.equal((await gradeRaw(JSON.stringify({answer:'\ufeffREADY\u00a0'}),'READY')).pass,true);
 assert.equal((await gradeRaw(JSON.stringify({answer:'\u0085'}),'\u0085')).pass,true);
 assert.equal((await gradeRaw(JSON.stringify({answer:'\u0085READY'}),'READY')).pass,false);
 await assert.rejects(gradeRaw('{}','\ufeff\u00a0'));
});
test('sample bounds are checked before invoking the SDK',async()=>{
 for(const [actual,expected] of [[null,'READY'],['x'.repeat(2049),'READY'],['{}',''],['{}','x'.repeat(129)]])await assert.rejects(gradeRaw(actual,expected));
});
