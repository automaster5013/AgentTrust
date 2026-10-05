import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {selectedDemoReadiness} from '../scripts/selected-demo-readiness.mjs';
const organization={organizationId:'00000000-0000-4000-8000-000000000001',projectId:'10000000-0000-4000-8000-000000000001',credentials:[{role:'admin',token:'synthetic-selected-readiness-canary'}]};
const me={organizationId:organization.organizationId,projectId:organization.projectId,role:'admin'};
const capacity={scope:'organization',organizationId:organization.organizationId,retained:{used:9994,limit:10000,remaining:6},active:{used:0,limit:10,remaining:10}};
const operations={observedAt:'2026-10-06T00:00:00Z',worker:{state:'recent'},executionCapacity:capacity};
async function probe({identity=me,state=operations,loginFails=false,logoutFails=false}={}){
 const paths=[];
 const report=await selectedDemoReadiness(organization,async(path,data)=>{
  paths.push(path);
  if(path==='/v1/auth/login'){assert.equal(data.accessKey,organization.credentials[0].token);if(loginFails)throw Error('private-login-canary');return {};}
  if(path==='/v1/me')return identity;
  if(path==='/v1/operations')return state;
  if(path==='/v1/auth/logout'){if(logoutFails)throw Error('private-logout-canary');return {};}
  assert.fail('Unexpected business mutation');
 });
 assert.ok(!JSON.stringify(report).includes('canary'));return {report,paths};
}
test('selected readiness rejects wrong organization, project or role before operations and always closes its session',async()=>{
 for(const changes of [{organizationId:'00000000-0000-4000-8000-000000000000'},{projectId:'10000000-0000-4000-8000-000000000000'},{role:'viewer'}]){
  const {report,paths}=await probe({identity:{...me,...changes}});assert.equal(report.status,'blocked');assert.equal(report.sessionScopeVerified,false);assert.equal(report.sessionLoggedOut,true);assert.deepEqual(paths,['/v1/auth/login','/v1/me','/v1/auth/logout']);
 }
});
test('selected readiness requires six retained runs, a free active slot and scoped consistent capacity',async()=>{
 const invalid=[{...capacity,retained:{used:9995,limit:10000,remaining:5}},{...capacity,active:{used:10,limit:10,remaining:0}},{...capacity,organizationId:'00000000-0000-4000-8000-000000000000'},{...capacity,retained:{used:9994,limit:10000,remaining:7}}];
 for(const executionCapacity of invalid){const {report}=await probe({state:{...operations,executionCapacity}});assert.equal(report.status,'blocked');assert.equal(report.sessionLoggedOut,true);}
 const {report,paths}=await probe();assert.equal(report.status,'passed');assert.equal(report.capacity.retainedRemaining,6);assert.equal(report.capacity.requestedRuns,6);assert.equal(report.sessionScopeVerified,true);assert.equal(report.sessionLoggedOut,true);assert.deepEqual(paths,['/v1/auth/login','/v1/me','/v1/operations','/v1/auth/logout']);
});
test('stale or missing worker signal and logout failure cannot produce successful readiness',async()=>{
 for(const worker of [undefined,{state:'stale'},{state:'unknown'}]){const {report}=await probe({state:{...operations,worker}});assert.equal(report.status,'blocked');assert.equal(report.workerRecent,false);assert.equal(report.sessionLoggedOut,true);}
 const {report}=await probe({logoutFails:true});assert.equal(report.status,'blocked');assert.equal(report.sessionLoggedOut,false);
});
test('failed login response still attempts own-session cleanup and excludes raw errors',async()=>{
 const {report,paths}=await probe({loginFails:true});assert.equal(report.status,'blocked');assert.equal(report.sessionScopeVerified,false);assert.equal(report.sessionLoggedOut,true);assert.deepEqual(paths,['/v1/auth/login','/v1/auth/logout']);
});
test('actual readiness CLI rejects malformed, duplicate or absent organization selection before local readiness stages',()=>{
 for(const args of [['--organization-index','01'],['--organization-index'],['--organization-index','1','--organization-index','0'],['--compare'],['--organization-index','private-canary']]){
  const result=spawnSync(process.execPath,['scripts/demo-preflight.mjs',...args],{encoding:'utf8',windowsHide:true,timeout:10000});assert.equal(result.status,1);const report=JSON.parse(result.stdout);assert.equal(report.failedCheck,'inputs');assert.ok(report.checks.slice(1).every(x=>x.status==='not_run'));assert.ok(!result.stdout.includes('private-canary'));assert.equal(result.stderr,'');
 }
});
