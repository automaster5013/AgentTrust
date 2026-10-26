import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluationLookupId} from '../src/lib/evaluation-lookup.ts';
test('pasted exact evaluation IDs normalize whitespace and case',()=>{
 assert.equal(evaluationLookupId('  A1234567-1234-1234-1234-123456789ABC  '),'a1234567-1234-1234-1234-123456789abc');
});
test('partial IDs, URLs and route or query injection never become evaluation lookup paths',()=>{
 for(const id of ['', 'a1234567','../runs','https://example.com/runs/123','a1234567-1234-1234-1234-123456789abc/gate','a1234567-1234-1234-1234-123456789abc?project=other','a1234567-1234-1234-1234-123456789abz'])assert.throws(()=>evaluationLookupId(id));
});
