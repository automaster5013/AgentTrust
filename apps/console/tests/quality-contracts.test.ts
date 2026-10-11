import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifiedAgentVersion,verifiedDatasetVersion,agentVersion,datasetVersion} from '../src/lib/campaign-contracts.ts';
import {referenceText} from '../src/lib/quality-contracts.ts';
import type {Identity} from '../src/lib/contracts.ts';
const id='11111111-1111-4111-8111-111111111111';
const user:Identity={username:'fixture',actorId:id,organizationId:id,projectId:id,role:'admin',identityProvider:'keycloak',runtime:'java21-spring-boot'};
const meta={id,organization_id:id,project_id:id,resource_key:'reference-agent',version:1,created_at:'2026-10-11T00:00:00Z'};
function canonical(value:unknown):unknown{if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,item])=>[key,canonical(item)]));return value}
async function sha(value:unknown){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(canonical(value))))),b=>b.toString(16).padStart(2,'0')).join('')}
test('actual reference profile hash and immutable dataset bytes are checked',async()=>{
 const profile=JSON.parse(readFileSync(new URL('./fixtures/quality-execution-profiles.json',import.meta.url),'utf8')).ollama;
 const definition={contract:'reference-answer-v1',description:'fixture',provider:'ollama',executionProfile:profile.definition,executionProfileSha256:profile.contentSha256};
 const agent={...meta,definition,content_sha256:await sha(definition)};
 assert.equal((await verifiedAgentVersion(agent,user)).definition.contract,'reference-answer-v1');
 await assert.rejects(verifiedAgentVersion({...agent,definition:{...definition,executionProfile:{...profile.definition,validatorProfileSha256:'b'.repeat(64)}}},user));
 assert.throws(()=>agentVersion({...agent,definition:{...definition,provider:'synthetic'}},user));
 const data={contract:'reference-answer-v1',cases:[{id:'ready',scenario:'quality',required:true,input:'Return READY',expected:'READY'}]};
 const dataset={...meta,definition:data,content_sha256:await sha(data)};
 assert.equal((await verifiedDatasetVersion(dataset,user)).definition.cases[0].expected,'READY');
 await assert.rejects(verifiedDatasetVersion({...dataset,definition:{...data,cases:[{...data.cases[0],expected:'DENIED'}]}},user));
 for(const cases of [[{...data.cases[0],scenario:'pass'}],[{...data.cases[0],required:false}],[{...data.cases[0],url:'http://outside'}]])assert.throws(()=>datasetVersion({...dataset,definition:{...data,cases}},user));
});
test('UTF8 bounds and malformed Unicode are refused before registration',()=>{
 for(const value of ['', '\uD800','x\0y','é'.repeat(97)])assert.throws(()=>referenceText(value,192));
 assert.throws(()=>referenceText('é'.repeat(65),128));
 assert.equal(referenceText('{{env.LITERAL}}',128),'{{env.LITERAL}}');
});
