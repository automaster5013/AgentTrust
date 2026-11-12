import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {recordedCases,recordedCanonical,recordedProfile,verifyRecordedRules} from '../src/lib/recorded-text-contracts.ts';
import {recordedExample,recordedAgentInput,recordedDatasetInput,verifiedRecordedAgent,verifiedRecordedDataset} from '../src/lib/recorded-text-draft.ts';
import {datasetCopyDraft,datasetCopyInput,datasetCopyRequest,verifiedDatasetCopy} from '../src/lib/dataset-copy.ts';
import {datasetDefinition} from '../src/lib/campaign-contracts.ts';
import type {Identity,Detail} from '../src/lib/contracts.ts';
const org='11111111-1111-4111-8111-111111111111',project='22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-333333333333',user:Identity={username:'fixture',organizationId:org,projectId:project,actorId:id,role:'editor',identityProvider:'keycloak',runtime:'java21-spring-boot'};
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(recordedCanonical(value))).digest('hex');
function row(definition:unknown,key='recorded-data'){return {id,organization_id:org,project_id:project,resource_key:key,version:1,created_at:'2026-11-12T00:00:00.123456Z',definition,content_sha256:digest(definition)}}
test('recorded literal cases have independent editable output and strict bounded rules',()=>{
 const a=recordedExample(),b=recordedExample();a[0].output='changed';assert.notEqual(a[0].output,b[0].output);assert.equal(recordedCases(b).length,2);
 const empty=structuredClone(b);empty[0].output='';assert.equal(recordedCases(empty)[0].output,'');
 const bad:Array<(v:ReturnType<typeof recordedExample>)=>void>=[v=>{v[0].output='é'.repeat(257)},v=>{v[0].output='\ud800'},v=>{v[0].rules[0].value=''},v=>{v[0].rules[1].id=v[0].rules[0].id},v=>{v[0].rules.forEach(r=>r.required=false)},v=>{v[0].rules[0].type='regex' as never},v=>{v.push(v[0])}];
 for(const change of bad){const value=recordedExample();change(value);assert.throws(()=>recordedCases(value))}
 assert.throws(()=>recordedCases([{...b[0],toolEvents:[]}]));assert.throws(()=>recordedCases([{...b[0],output:'\x01'.repeat(512)}]));
 assert.throws(()=>datasetDefinition({contract:'fixed-scenarios-v1',cases:b}));
});
test('recorded profile accepts the explicit local execution identity and rejects added capabilities',()=>{
 const profile=JSON.parse(readFileSync(new URL('./fixtures/recorded-text-execution-profile.json',import.meta.url),'utf8'));
 assert.equal(digest(recordedProfile(profile.definition,'synthetic')),profile.contentSha256);
 for(const change of [{providerCallsAllowed:true},{callerSelectedUrlAllowed:true},{evaluationTimeoutSeconds:2},{token:'untrusted'},{sourceSha256:{}}])assert.throws(()=>recordedProfile({...profile.definition,...change},'synthetic'));
 assert.throws(()=>recordedProfile(profile.definition,'ollama'));
});
test('registration binds coordinates scope complete definitions and hashes',async()=>{
 const input=recordedDatasetInput('recorded-data','1',JSON.stringify(recordedExample())),stored=row({contract:'recorded-text-rules-v1',cases:input.recordedCases});
 assert.equal((await verifiedRecordedDataset(stored,user,input)).id,id);
 for(const change of [{project_id:org},{resource_key:'substituted'},{version:2},{content_sha256:'a'.repeat(64)}])await assert.rejects(verifiedRecordedDataset({...stored,...change},user,input));
 const changed=structuredClone(input);changed.recordedCases[0].output='other';await assert.rejects(verifiedRecordedDataset(row({contract:'recorded-text-rules-v1',cases:changed.recordedCases}),user,input));
 const profile=JSON.parse(readFileSync(new URL('./fixtures/recorded-text-execution-profile.json',import.meta.url),'utf8')),agentInput=recordedAgentInput('recorded-agent','1','fixture');
 const agent=row({contract:'recorded-text-rules-v1',provider:'synthetic',description:'fixture',executionProfile:profile.definition,executionProfileSha256:profile.contentSha256},'recorded-agent');
 assert.equal((await verifiedRecordedAgent(agent,user,agentInput)).id,id);await assert.rejects(verifiedRecordedAgent({...agent,project_id:org},user,agentInput));
 assert.throws(()=>recordedAgentInput('../bad','1','fixture'));assert.throws(()=>recordedAgentInput('recorded-agent','1','한'.repeat(101)));
});
test('recorded rule evidence is derived from exact literal output and cannot be substituted',()=>{
 const c=recordedExample()[0],rules=c.rules.map(r=>({id:r.id,required:r.required,status:'pass' as const,reason:`Recorded text ${r.type} rule passed.`}));
 const result:Detail['result']={state:'succeeded',decision:'pass',executionEngine:'python-synthetic',rules};verifyRecordedRules(c,result);
 assert.throws(()=>verifyRecordedRules({...c,output:''},result));assert.throws(()=>verifyRecordedRules(c,{...result,rules:[...rules].reverse()}));
 assert.throws(()=>verifyRecordedRules(c,{...result,rules:[{...rules[0],id:'foreign'},rules[1]]}));
 const optional=structuredClone(c);optional.rules[1].required=false;optional.output+=' transfer_funds';
 verifyRecordedRules(optional,{...result,rules:[rules[0],{id:optional.rules[1].id,required:false,status:'fail',reason:'Recorded text not_contains rule failed.'}]});
 const literal=structuredClone(c);literal.rules=[{id:'literal',type:'contains',required:true,value:'é'}];literal.output='e\u0301';
 verifyRecordedRules(literal,{state:'succeeded',decision:'block',executionEngine:'python-synthetic',rules:[{id:'literal',required:true,status:'fail',reason:'Recorded text contains rule failed.'}]});
});
test('recorded dataset copies preserve the new contract with an explicit typed request',async()=>{
 const input=recordedDatasetInput('recorded-data','1',JSON.stringify(recordedExample())),source=await verifiedRecordedDataset(row({contract:'recorded-text-rules-v1',cases:input.recordedCases}),user,input),draft=datasetCopyDraft(source);
 assert.equal(draft.evaluationMode,'recorded-text-rules');const copy=datasetCopyInput(source,user,'recorded-copy','2',JSON.stringify(draft.cases)),request=datasetCopyRequest(copy);
 assert.ok('recordedCases' in request);assert.ok(!('cases' in request));const stored={...row({contract:'recorded-text-rules-v1',cases:copy.cases},'recorded-copy'),id:org,version:2};assert.equal((await verifiedDatasetCopy(stored,user,copy,source)).id,org);
});
