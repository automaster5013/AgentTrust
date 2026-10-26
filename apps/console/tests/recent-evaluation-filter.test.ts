import test from 'node:test';
import assert from 'node:assert/strict';
import {filterRecentEvaluations} from '../src/lib/recent-evaluation-filter.ts';
import {evaluationNextAction} from '../src/lib/release-presentation.ts';
import type {Run} from '../src/lib/contracts.ts';
const records=[{id:'abc-001',provider:'synthetic',scenario:'pass',decision:'pass',state:'succeeded',requires_approval:true,created_at:'2026-10-26T00:00:00Z'},{id:'def-002',provider:'synthetic',scenario:'error',decision:'inconclusive',state:'failed',requires_approval:true,created_at:'2026-10-26T00:00:01Z'},{id:'ghi-003',provider:'synthetic',scenario:'pass',decision:'inconclusive',state:'queued',requires_approval:true,created_at:'2026-10-26T00:00:02Z'}] as Run[];
test('search combines with state and decision without changing original evidence or order',()=>{
 const original=JSON.stringify(records);const result=filterRecentEvaluations(records,{query:' SYNTHETIC ',decision:'inconclusive',state:'queued'});assert.deepEqual(result.map(x=>x.id),['ghi-003']);assert.equal(result[0],records[2]);assert.equal(JSON.stringify(records),original);
 assert.deepEqual(filterRecentEvaluations(records,{query:'ABC',decision:'all',state:'all'}).map(x=>x.id),['abc-001']);
 assert.deepEqual(filterRecentEvaluations(records,{query:'error',decision:'pass',state:'all'}),[]);
 assert.deepEqual(filterRecentEvaluations(records,{query:'',decision:'all',state:'all'}),records);
});
test('search does not inspect evidence bodies and treats markup as literal text',()=>{
 assert.deepEqual(filterRecentEvaluations(records,{query:'<script>',decision:'all',state:'all'}),[]);
 assert.deepEqual(filterRecentEvaluations(records,{query:' ',decision:'all',state:'failed'}).map(x=>x.id),['def-002']);
});
test('failed evaluation cannot obtain positive next action from an inconsistent allowed gate',()=>{
 const gate={decision:'pass',deploymentAllowed:true,policyStatus:'evaluated'} as const;
 assert.match(evaluationNextAction('block',gate),/실패한 필수 규칙/);assert.match(evaluationNextAction('inconclusive',gate),/누락된 근거/);
 assert.match(evaluationNextAction('pass',null),/다시 조회/);
 assert.match(evaluationNextAction('pass',{...gate,deploymentAllowed:false}),/차단 사유/);
 assert.match(evaluationNextAction('pass',gate),/실제 배포를 실행하지 않습니다/);
});
