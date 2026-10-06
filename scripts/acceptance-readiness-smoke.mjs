import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {hash} from '../packages/contracts/hash.js';
import {localSmokeBase,fetchLocalSmoke} from './local-smoke-http.mjs';
import {readReleaseResponse} from './release-gate.mjs';
import {seededDemoScope,assertDemoSessionScope} from './demo-session-scope.mjs';
const reportPath='.local/acceptance-api-readiness-'+randomUUID()+'.json';
const report={schemaVersion:1,purpose:'synthetic-acceptance-api-readiness-smoke',synthetic:true,completed:false,businessDataWrites:false,runsCreated:0,releaseGateEvaluated:false,currentReleasePermissionVerified:false,serverDeployed:false,sessionsStarted:0,sessionsLoggedOut:0};
let base,scope,cookie;
async function request(path,{method='GET',body,projectId=scope.projectId}={}){
 const response=await fetchLocalSmoke(base,path,{method,headers:{'Content-Type':'application/json','X-AgentTrust-Request':'local-ui','X-AgentTrust-Project':projectId,...(cookie?{Cookie:cookie}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 if(path==='/v1/auth/login'){cookie=response.headers.get('set-cookie')?.split(';')[0];if(cookie)report.sessionsStarted++;}
 return {status:response.status,data:await readReleaseResponse(response)};
}
async function logout(){if(!cookie)return;assert.equal((await request('/v1/auth/logout',{method:'POST',body:{}})).status,200);cookie=null;report.sessionsLoggedOut++;}
function verifyPlan(r,profile){
 assert.equal(r.purpose,'synthetic-acceptance-readiness-plan');assert.equal(r.completed,true);assert.equal(r.organizationId,scope.organizationId);assert.equal(r.projectId,scope.projectId);assert.ok(Number.isFinite(Date.parse(r.observedAt)));
 assert.equal(r.capacityPreflight.status,'passed');assert.equal(r.capacityPreflight.requestedRuns,6);assert.equal(r.versionCapacityPreflight.status,'passed');assert.equal(r.agentVersionsVerified,5);assert.equal(r.cases,2);assert.equal(r.rules,5);
 assert.equal(r.businessDataReadOnly,true);assert.equal(r.businessDataWrites,false);assert.equal(r.runsCreated,0);assert.equal(r.releaseGateEvaluated,false);assert.equal(r.currentReleasePermissionVerified,false);
 let missing=0;for(const kind of ['dataset','policy']){assert.equal(typeof r.criteria[kind].reused,'boolean');if(r.criteria[kind].reused)assert.equal(r.criteria[kind].contentHash,hash(profile[kind]));else missing++;}assert.equal(r.versionCapacityPreflight.requestedVersions,missing);
}
try{
 const args=process.argv.slice(2);assert.ok(args.length===0||args.length===2&&args[0]==='--organization-index'&&/^(0|[1-9][0-9]?)$/.test(args[1]));const organizationIndex=args.length?Number(args[1]):0;
 const config=JSON.parse((await readFile('.local/credentials.json','utf8')).replace(/^\uFEFF/,'')),organization=config.organizations?.[organizationIndex];scope=seededDemoScope(organization);base=localSmokeBase();
 const profile=JSON.parse(await readFile(new URL('../examples/connector-contract/acceptance-profile.json',import.meta.url),'utf8'));
 Object.assign(report,{organizationIndex,...scope});
 for(const role of ['admin','editor','viewer']){
  const credential=organization.credentials.find(c=>c.role===role);assert.ok(credential?.token);assert.equal((await request('/v1/auth/login',{method:'POST',body:{accessKey:credential.token}})).status,200);assert.ok(cookie);
  try{
   const me=await request('/v1/me');assert.equal(me.status,200);assertDemoSessionScope(me.data,scope,role);
   if(role==='admin'){
    report.adminScopeVerified=true;const before=await request('/v1/operations');assert.equal(before.status,200);
    const baseline=await request('/v1/acceptance-readiness');assert.equal(baseline.status,200);verifyPlan(baseline.data,profile);report.defaultPlanVerified=true;
    const same=await request('/v1/acceptance-readiness',{method:'POST',body:profile});assert.equal(same.status,200);verifyPlan(same.data,profile);assert.deepEqual(same.data.criteria,baseline.data.criteria);report.postedPlanVerified=true;
    const draft=structuredClone(profile);draft.policy.name='Synthetic readiness draft '+randomUUID();const edited=await request('/v1/acceptance-readiness',{method:'POST',body:draft});assert.equal(edited.status,200);verifyPlan(edited.data,draft);assert.equal(edited.data.criteria.policy.reused,false);assert.ok(!JSON.stringify(edited.data).includes(draft.policy.name));report.editedDraftNoWriteVerified=true;
    assert.equal((await request('/v1/acceptance-readiness?unexpected=1')).status,400);assert.equal((await request('/v1/acceptance-readiness',{method:'POST',body:{...profile,synthetic:false}})).status,400);
    const foreign=config.organizations.find(o=>o.organizationId!==scope.organizationId);assert.ok(foreign&&foreign.projectId!==scope.projectId);assert.equal((await request('/v1/acceptance-readiness',{projectId:foreign.projectId})).status,404);report.queryAndScopeBoundariesVerified=true;
    const after=await request('/v1/operations');assert.equal(after.status,200);assert.equal(after.data.versionCapacity.used,before.data.versionCapacity.used);assert.equal(after.data.executionCapacity.retained.used,before.data.executionCapacity.retained.used);report.businessCountsUnchanged=true;
   }else for(const method of ['GET','POST'])assert.equal((await request('/v1/acceptance-readiness',{method,...(method==='POST'?{body:profile}:{})})).status,403);
  }finally{await logout();}
 }
 report.roleBoundariesVerified=true;report.completed=true;
}catch{report.failed=true;process.exitCode=1;}
finally{
 try{await logout();}catch{report.cleanupFailed=true;process.exitCode=1;}
 report.sessionLoggedOut=!cookie&&report.sessionsStarted===report.sessionsLoggedOut;report.finishedAt=new Date().toISOString();
 await writeFile(reportPath,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});const passed=report.completed&&report.sessionLoggedOut&&!report.cleanupFailed;
 console.log(JSON.stringify({purpose:report.purpose,status:passed?'passed':'blocked',synthetic:true,organizationIndex:report.organizationIndex,defaultPlanVerified:report.defaultPlanVerified===true,postedPlanVerified:report.postedPlanVerified===true,editedDraftNoWriteVerified:report.editedDraftNoWriteVerified===true,roleBoundariesVerified:report.roleBoundariesVerified===true,queryAndScopeBoundariesVerified:report.queryAndScopeBoundariesVerified===true,businessCountsUnchanged:report.businessCountsUnchanged===true,businessDataWrites:false,runsCreated:0,releaseGateEvaluated:false,sessionsStarted:report.sessionsStarted,sessionsLoggedOut:report.sessionsLoggedOut,sessionLoggedOut:report.sessionLoggedOut,reportPath,serverDeployed:false}));if(!passed)process.exitCode=1;
}
