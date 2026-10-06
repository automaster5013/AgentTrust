import assert from 'node:assert/strict';
import {validate,versionLimit} from '../contracts/index.js';
import {hash} from '../contracts/hash.js';
import {acceptanceModes,validateAcceptanceProfile} from './acceptance-profile.js';
import {planAcceptanceVersions,checkAcceptanceVersionCapacity} from './acceptance-version-capacity.js';
import {checkDemoRunCapacity} from '../contracts/demo-run-capacity.js';
export async function resolveAcceptanceAgents({catalog,call}){
 assert.ok(Array.isArray(catalog?.agent)&&catalog.agent.length<=versionLimit);const agents=new Map();
 for(const [mode] of acceptanceModes){const row=catalog.agent.find(a=>a?.mode===mode);assert.match(row?.id||'',/^[a-f0-9-]{36}$/);const stored=await call('/v1/versions/'+row.id);assert.equal(stored.id,row.id);assert.equal(stored.kind,'agent');assert.equal(stored.contentHash,row.contentHash);const data=validate('agent',stored.data);assert.equal(hash(data),row.contentHash);assert.equal(data.mode,mode);agents.set(mode,row.id);}return agents;
}
export async function inspectAcceptanceReadiness({profile,scope,operations,call}){
 const checked=validateAcceptanceProfile(profile);assert.match(scope?.organizationId||'',/^[a-f0-9-]{36}$/);assert.match(scope?.projectId||'',/^[a-f0-9-]{36}$/);
 const report={schemaVersion:1,purpose:'synthetic-acceptance-readiness-plan',synthetic:true,completed:false,cleanupSucceeded:true,businessDataReadOnly:true,businessDataWrites:false,runsCreated:0,releaseGateEvaluated:false,currentReleasePermissionVerified:false,serverDeployed:false};let stage='execution-capacity';
 try{
  report.capacityPreflight=checkDemoRunCapacity(operations,scope,6);assert.equal(report.capacityPreflight.status,'passed');stage='worker';assert.equal(operations.worker?.state,'recent');stage='version-capacity';
  const catalog=await call('/v1/catalog');report.versionCapacityPreflight=checkAcceptanceVersionCapacity(operations,scope,planAcceptanceVersions(catalog,checked));assert.equal(report.versionCapacityPreflight.status,'passed');stage='agent-versions';const agents=await resolveAcceptanceAgents({catalog,call});report.agentVersionsVerified=agents.size;stage='criteria-versions';report.criteria={};
  for(const kind of ['dataset','policy']){const data=checked[kind],expectedHash=hash(data),row=catalog[kind].find(v=>v?.name===data.name&&v.contentHash===expectedHash);if(!row){report.criteria[kind]={reused:false};continue;}assert.match(row.id,/^[a-f0-9-]{36}$/);const stored=await call('/v1/versions/'+row.id);assert.equal(stored.id,row.id);assert.equal(stored.kind,kind);assert.equal(stored.contentHash,expectedHash);assert.equal(hash(validate(kind,stored.data)),expectedHash);report.criteria[kind]={reused:true,id:row.id,contentHash:expectedHash};}
  report.cases=checked.dataset.cases.length;report.rules=checked.dataset.cases.reduce((n,c)=>n+c.rules.length,0);report.completed=true;
 }catch{report.failed=true;report.failedStage=stage;}return report;
}
