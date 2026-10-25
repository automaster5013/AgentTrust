import test from 'node:test';
import assert from 'node:assert/strict';
import {comparisonGroups} from '../src/lib/comparison-filter.ts';
import type {Comparison} from '../src/lib/campaign-contracts.ts';
test('regression navigation narrows verified causes without mutating original authority or evidence',()=>{
 const value:Comparison={status:'inconclusive',newlyFailedRequiredCases:['Case-A','Case-B'],unresolvedRequiredCases:['Case-C'],improvedRequiredCases:['Case-D'],deploymentAuthority:false};const before=JSON.stringify(value);
 assert.deepEqual(comparisonGroups(value,'failed',' case-b ').map(x=>x.ids),[['Case-B']]);
 assert.deepEqual(comparisonGroups(value,'unresolved','CASE-C').map(x=>x.ids),[['Case-C']]);
 assert.deepEqual(comparisonGroups(value,'all','<script>').map(x=>x.ids),[[],[],[]]);
 assert.deepEqual(comparisonGroups(value,'all','').map(x=>x.ids),[['Case-A','Case-B'],['Case-C'],['Case-D']]);
 assert.equal(JSON.stringify(value),before);assert.equal(comparisonGroups(value,'failed','missing')[0].total,2);
});
