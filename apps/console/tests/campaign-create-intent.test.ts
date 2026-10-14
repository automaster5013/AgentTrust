import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {campaignCreateIntent,requireCampaignIntent,verifiedCampaignRequest,verifiedCreatedCampaign,verifiedCampaignRequestRequirements} from '../src/lib/campaign-create-intent.ts';
import {proxyPath} from '../src/lib/proxy-policy.ts';import type {Identity} from '../src/lib/contracts.ts';
const id=(n:number)=>String(n).repeat(8)+'-'+String(n).repeat(4)+'-4'+String(n).repeat(3)+'-8'+String(n).repeat(3)+'-'+String(n).repeat(12);
const user={organizationId:id(1),projectId:id(2),actorId:id(3)} as Identity,scope={organization_id:user.organizationId,project_id:user.projectId};
function canonical(v:unknown):unknown{if(Array.isArray(v))return v.map(canonical);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>[k,canonical(x)]));return v}
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const agentDefinition={contract:'fixed-scenarios-v1',provider:'synthetic',description:'original'},datasetDefinition={contract:'fixed-scenarios-v1',cases:[{id:'required-pass',scenario:'pass',required:true}]};
const agent={...scope,id:id(4),resource_key:'release-agent',version:1,created_at:'2026-10-14T04:00:00Z',definition:agentDefinition,content_sha256:hash(agentDefinition)},dataset={...agent,id:id(5),resource_key:'release-data',definition:datasetDefinition,content_sha256:hash(datasetDefinition)};
function intent(baseline:string|null=null){return campaignCreateIntent(user,agent,dataset,true,baseline,baseline===null?null:3600,id(6))}
function fixture(){return {id:id(7),...scope,created_at:agent.created_at,requires_approval:true,agent_version_id:agent.id,dataset_version_id:dataset.id,agent_content_sha256:agent.content_sha256,dataset_content_sha256:dataset.content_sha256,agentVersion:agent,datasetVersion:dataset,state:'succeeded',decision:'pass',cases:[{caseId:'required-pass',required:true,runId:id(8),scenario:'pass',provider:'synthetic',state:'succeeded',decision:'pass'}],result:{state:'succeeded',decision:'pass',executionEngine:'java-campaign-aggregate',rules:[{id:'case/required-pass',required:true,status:'pass',reason:'stored'}]}}}
const pointer=()=>({requestKey:id(6),organizationId:user.organizationId,projectId:user.projectId,actorId:user.actorId,campaignId:id(7),deploymentAuthority:false});
test('campaign uncertainty freezes original versions hashes approval baseline and age within exact actor scope',()=>{
 const i=intent(id(9));assert.ok(Object.isFrozen(i)&&Object.isFrozen(i.input));assert.throws(()=>{i.input.requiresApproval=false});assert.equal(i.input.evidenceMaxAgeSeconds,3600);requireCampaignIntent(i,user);
 for(const changed of [{...user,actorId:id(9)},{...user,organizationId:id(9)},{...user,projectId:id(9)}])assert.throws(()=>requireCampaignIntent(i,changed));
 for(const [baseline,age] of [[null,3600],[id(9),null],[id(9),59],[id(9),86401],[id(9),'3600'],['invalid',3600]] as const)assert.throws(()=>campaignCreateIntent(user,agent,dataset,true,baseline,age));
 for(const key of ['short','a'.repeat(101),'aaaaaaaa/../../campaigns'])assert.throws(()=>campaignCreateIntent(user,agent,dataset,true,null,null,key));assert.throws(()=>campaignCreateIntent(user,agent,dataset,'true',null,null));
});
test('campaign lookup rejects substituted keys actor scope authority coordinates and extensions',()=>{
 assert.equal(verifiedCampaignRequest(pointer(),intent(),user),id(7));
 for(const changed of [{...pointer(),requestKey:id(9)},{...pointer(),actorId:id(9)},{...pointer(),projectId:id(9)},{...pointer(),organizationId:id(9)},{...pointer(),deploymentAuthority:true},{...pointer(),campaignId:'invalid'},{...pointer(),extra:true}])assert.throws(()=>verifiedCampaignRequest(changed,intent(),user));
});
test('recovered campaign must match actual hashed immutable contents and original approval input',async()=>{
 assert.equal((await verifiedCreatedCampaign(fixture(),intent(),user,id(7))).id,id(7));
 for(const changed of [{...fixture(),requires_approval:false},{...fixture(),id:id(9)},{...fixture(),project_id:id(9)},{...fixture(),agent_version_id:id(9)},{...fixture(),dataset_content_sha256:'b'.repeat(64)},{...fixture(),agentVersion:{...agent,definition:{...agentDefinition,description:'changed'}}}])await assert.rejects(verifiedCreatedCampaign(changed,intent(),user,id(7)));
});
test('request recovery verifies the admitted baseline and evidence age separately from current permission',async()=>{
 const record=await verifiedCreatedCampaign(fixture(),intent(),user),base={contract:'campaign-release-requirements-v1',campaignId:record.id,organizationId:user.organizationId,projectId:user.projectId,deploymentAuthority:false,enabled:false};verifiedCampaignRequestRequirements(base,intent(),user,record);assert.throws(()=>verifiedCampaignRequestRequirements(base,intent(id(9)),user,record));
 const created=Date.parse(record.created_at),bound={...base,enabled:true,datasetVersionId:record.dataset_version_id,datasetContentSha256:record.dataset_content_sha256,baselineCampaignId:id(9),baselineAgentVersionId:agent.id,baselineAgentContentSha256:agent.content_sha256,candidateCreatedAtEpochMillis:created,baselineCreatedAtEpochMillis:created-1000,evidenceExpiresAtEpochMillis:created-1000+3600000,evidenceMaxAgeSeconds:3600,comparison:{status:'no-regression',newlyFailedRequiredCases:[],unresolvedRequiredCases:[],improvedRequiredCases:[],deploymentAuthority:false}};
 verifiedCampaignRequestRequirements(bound,intent(id(9)),user,record);assert.throws(()=>verifiedCampaignRequestRequirements(bound,intent(),user,record));for(const changed of [{...bound,baselineCampaignId:id(8)},{...bound,evidenceMaxAgeSeconds:7200},{...bound,projectId:id(8)},{...bound,deploymentAuthority:true}])assert.throws(()=>verifiedCampaignRequestRequirements(changed,intent(id(9)),user,record));
});
test('campaign admission lookup adds only bounded reads without write query or tenant navigation',()=>{
 for(const key of ['a'.repeat(8),'a'.repeat(100),id(6)]){const path=['campaign-requests',key];assert.equal(proxyPath(path,'GET'),'/api/'+path.join('/'));assert.throws(()=>proxyPath(path,'POST'));assert.throws(()=>proxyPath(path,'DELETE'))}
 for(const key of ['a'.repeat(7),'a'.repeat(101),'aaaaaaaa%2fother','aaaaaaaa/other','../../campaigns'])assert.throws(()=>proxyPath(['campaign-requests',key],'GET'));
});
