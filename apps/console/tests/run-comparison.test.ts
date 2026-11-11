import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runComparison,runComparisonPath} from '../src/lib/run-comparison.ts';
import {proxyPath} from '../src/lib/proxy-policy.ts';
import type {Identity} from '../src/lib/contracts.ts';
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
const user={organizationId:a,projectId:b} as Identity;
const frame={organizationId:a,projectId:b,baselineRunId:a,candidateRunId:b,comparisonKind:'observed-rule-results-v1',baselineDecision:'pass',candidateDecision:'block',deploymentAuthority:false,regressionAuthority:false,changedRules:1,rules:[{ruleId:'answer',before:'pass',after:'fail',baselineRequired:true,candidateRequired:true,changed:true}]};
test('comparison uses an exact read-only application route',()=>{
 assert.equal(runComparisonPath(b,a),`runs/${b}/comparison/${a}`);
 assert.equal(proxyPath(['runs',b,'comparison',a],'GET'),`/api/runs/${b}/comparison/${a}`);
 for(const method of ['POST','PUT','DELETE'])assert.throws(()=>proxyPath(['runs',b,'comparison',a],method));
 for(const id of ['../other','AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA','other',''])assert.throws(()=>runComparisonPath(b,id));
 assert.throws(()=>runComparisonPath(a,a));
});
test('comparison binds both evaluations to the authenticated project',()=>{
 assert.equal(runComparison(frame,user,b,a).changedRules,1);
 for(const invalid of [{...frame,organizationId:b},{...frame,projectId:a},{...frame,baselineRunId:b},{...frame,candidateRunId:a},{...frame,deploymentAuthority:true},{...frame,regressionAuthority:true}])assert.throws(()=>runComparison(invalid,user,b,a));
});
test('missing and changed rules are never silently turned into passes',()=>{
 const row={...frame.rules[0],after:'missing',candidateRequired:null};assert.equal(runComparison({...frame,rules:[row]},user,b,a).rules[0].after,'missing');
 for(const rules of [[{...row,changed:false}],[{...row,candidateRequired:true}],[...frame.rules,...frame.rules],[{...row,before:'missing',baselineRequired:null}],[],Array(201).fill(row)])assert.throws(()=>runComparison({...frame,rules},user,b,a));
 assert.throws(()=>runComparison({...frame,changedRules:0},user,b,a));
});
