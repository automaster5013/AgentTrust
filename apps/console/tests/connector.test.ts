import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {recordedCanonical} from '../src/lib/recorded-text-contracts.ts';
import {connectorCases,connectorProfile,verifyConnectorRules,strictConnectorJson} from '../src/lib/connector-contracts.ts';
import {connectorExample,connectorAgentInput,connectorDatasetInput,verifiedConnectorAgent,verifiedConnectorDataset} from '../src/lib/connector-draft.ts';
import {datasetCopyDraft,datasetCopyInput,datasetCopyRequest,verifiedDatasetCopy} from '../src/lib/dataset-copy.ts';
import {datasetDefinition} from '../src/lib/campaign-contracts.ts';
import type {Identity,Detail} from '../src/lib/contracts.ts';
const org='11111111-1111-4111-8111-111111111111',project='22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-333333333333',user:Identity={username:'fixture',organizationId:org,projectId:project,actorId:id,role:'editor',identityProvider:'keycloak',runtime:'java21-spring-boot'};
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(recordedCanonical(value))).digest('hex');
function row(definition:unknown,key='recorded-data'){return {id,organization_id:org,project_id:project,resource_key:key,version:1,created_at:'2026-11-12T00:00:00.123456Z',definition,content_sha256:digest(definition)}}
test('connector profile accepts the explicit local execution identity and rejects added capabilities',()=>{
 const profile=JSON.parse(readFileSync(new URL('./fixtures/connector-execution-profile.json',import.meta.url),'utf8'));
 assert.equal(digest(connectorProfile(profile.definition,'synthetic')),profile.contentSha256);
 for(const change of [{providerCallsAllowed:true},{callerSelectedUrlAllowed:true},{evaluationTimeoutSeconds:2},{token:'untrusted'},{sourceSha256:{}}])assert.throws(()=>connectorProfile({...profile.definition,...change},'synthetic'));
 assert.throws(()=>connectorProfile(profile.definition,'ollama'));
});
test('original two examples retain all five rules and distinguish duplicate JSON and absent observations',()=>{
 const a=connectorExample(),b=connectorExample();assert.equal(a.flatMap(c=>c.rules).length,5);a[0].evidence.output='changed';assert.notEqual(a[0].evidence.output,b[0].evidence.output);
 assert.throws(()=>strictConnectorJson('{"status":"ok","status":"other"}'));assert.throws(()=>strictConnectorJson('{"status":"ok","st\\u0061tus":"other"}'));assert.throws(()=>strictConnectorJson('{} true'));
 assert.equal(connectorCases([{...b[0],evidence:{output:null,toolEvents:null}}])[0].evidence.toolEvents,null);assert.deepEqual(connectorCases([{...b[0],evidence:{output:'',toolEvents:[]}}])[0].evidence.toolEvents,[]);
 assert.throws(()=>connectorCases([{...b[0],evidence:{output:'x',toolEvents:[{name:'a',args:{constructor:'x'}}]}}]));assert.throws(()=>connectorCases([{...b[0],input:'é'.repeat(257)}]));
});
test('verified results require actual argument schema status and complete rule identity',()=>{
 const c=connectorExample()[0],base={state:'succeeded',decision:'pass',executionEngine:'python-synthetic',rules:c.rules.map(r=>({id:r.id,required:r.required,status:'pass',reason:`Recorded connector ${r.type} rule evaluated.`}))} as Detail['result'];verifyConnectorRules(c,base);
 const forged=structuredClone(base);forged.rules[0].id='other';assert.throws(()=>verifyConnectorRules(c,forged));
 const missing={...c,evidence:{output:null,toolEvents:null}};assert.throws(()=>verifyConnectorRules(missing,base));
});
test('registration and copying bind complete connector definitions, scope, hashes and coordinates',async()=>{
 const input=connectorDatasetInput('recorded-data','1',JSON.stringify(connectorExample())),stored=row({contract:'recorded-connector-rules-v1',cases:input.connectorCases});
 const version=await verifiedConnectorDataset(stored,user,input);assert.equal(version.id,id);
 for(const change of [{project_id:org},{resource_key:'substituted'},{version:2},{content_sha256:'a'.repeat(64)}])await assert.rejects(verifiedConnectorDataset({...stored,...change},user,input));
 const draft=datasetCopyDraft(version);assert.equal(draft.evaluationMode,'recorded-connector-rules');const copy=datasetCopyInput(version,user,'copied-data','2',JSON.stringify(draft.cases));assert.deepEqual(datasetCopyRequest(copy),{key:'copied-data',version:2,evaluationMode:'recorded-connector-rules',connectorCases:input.connectorCases});
 assert.throws(()=>datasetDefinition({contract:'recorded-text-rules-v1',cases:input.connectorCases}));assert.throws(()=>connectorDatasetInput('recorded-data','1','[{"id":"one","id":"two"}]'));
 const profile=JSON.parse(readFileSync(new URL('./fixtures/connector-execution-profile.json',import.meta.url),'utf8')),agentInput=connectorAgentInput('connector-agent','1','fixture');const agent=row({contract:'recorded-connector-rules-v1',provider:'synthetic',description:'fixture',executionProfile:profile.definition,executionProfileSha256:profile.contentSha256},'connector-agent');await verifiedConnectorAgent(agent,user,agentInput);
});

test('argument schema failures, forbidden tools, duplicate output and null evidence cannot masquerade as passed rules',()=>{
 const verify=(c:ReturnType<typeof connectorExample>[number],statuses:string[],decision:string)=>verifyConnectorRules(c,{state:'succeeded',decision,executionEngine:'python-synthetic',rules:c.rules.map((r,i)=>({id:r.id,required:r.required,status:statuses[i],reason:`Recorded connector ${r.type} rule evaluated.`}))} as Detail['result']);
 const c=connectorExample()[0];c.evidence.toolEvents![0].args={orderId:''};verify(c,['pass','pass','fail'],'block');assert.throws(()=>verify(c,['pass','pass','pass'],'pass'));
 c.evidence.toolEvents![0].name='transfer_funds';verify(c,['pass','pass','fail'],'block');c.evidence.toolEvents=null;verify(c,['pass','pass','inconclusive'],'inconclusive');
 const json=connectorExample()[1];json.evidence.output='{"status":"review_required","status":"other"}';verify(json,['fail','pass'],'block');json.evidence.output=null;verify(json,['inconclusive','pass'],'inconclusive');
});
