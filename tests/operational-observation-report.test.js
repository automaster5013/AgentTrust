import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile,rm,open} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {initialObservationReport} from '../scripts/operational-observation.mjs';
import {renderOperationalObservationReport} from '../packages/operations/observation-report.js';
import {observationReportOptions,writeObservationReport} from '../scripts/write-operations-observation-report.mjs';
const scope={organizationId:randomUUID(),projectId:randomUUID()},options={organizationIndex:0,samples:1,intervalSeconds:1};
const fixture=()=>{const r=initialObservationReport(options,scope);Object.assign(r,{completed:true,stage:'finished',sessionScopeVerified:true,sessionLoggedOut:true,finishedAt:'2026-10-09T14:00:01.000Z',samples:[{at:'2026-10-09T14:00:00.000Z',assessment:{schemaVersion:1,status:'warning',...scope,observedAt:'2026-10-09T14:00:00.000Z',alerts:[{code:'retained-capacity-high',severity:'warning',scope:'organization'}],readOnly:true,automatedRemediationPerformed:false,releasePermissionVerified:false,continuousMonitoringProven:false}}]});return r;};
const temporary=async fn=>{const root=resolve('.local');await mkdir(root,{recursive:true});const directory=await mkdtemp(join(root,'observation-report-test-'));try{return await fn(directory);}finally{assert.equal(dirname(resolve(directory)),root);assert.ok(directory.startsWith(join(root,'observation-report-test-')));await rm(directory,{recursive:true,force:true});}};

test('static observation report is scoped, readable and contains no scripts or external requests',()=>{
 const {html,inspection}=renderOperationalObservationReport(fixture(),scope);assert.equal(inspection.status,'warning');assert.match(html,/<html lang="ko">/);assert.match(html,/Content-Security-Policy/);assert.match(html,/default-src 'none'/);assert.doesNotMatch(html,/<script|<iframe|<img|<form|https?:|fetch\(|\.local\//i);assert.match(html,/기대 조직·프로젝트와 일치/);assert.ok(html.includes(scope.organizationId)&&html.includes(scope.projectId));assert.match(html,/현재 배포 승인을 확인하지 않았습니다/);assert.match(html,/<caption>/);assert.match(html,/scope="col"/);
});

test('empty and incomplete reports never describe the installation as healthy',()=>{
 const planned=renderOperationalObservationReport(initialObservationReport(options,scope));assert.equal(planned.inspection.status,'incomplete');assert.match(planned.html,/검증된 표본이 없습니다/);assert.match(planned.html,/정상 운영으로 판단하지 않습니다/);assert.match(planned.html,/기대 범위를 지정하지 않음/);
 const r=fixture();Object.assign(r,{completed:false,failed:true,failureStage:'sampling',failureCode:'authentication-denied',sessionLoggedOut:false,cleanupFailed:true,cleanupFailureCode:'access-denied'});const {html}=renderOperationalObservationReport(r);assert.match(html,/미완료 기록/);assert.match(html,/authentication-denied/);assert.match(html,/access-denied/);assert.match(html,/자체 세션 종료 선언: 미확인/);
});

test('critical observations and unsupported private or injectable data remain distinct',()=>{
 const r=fixture();r.samples[0].assessment.status='critical';r.samples[0].assessment.alerts=[{code:'worker-not-recent',severity:'critical',scope:'service'}];r.criticalObserved=true;assert.equal(renderOperationalObservationReport(r).inspection.status,'critical');assert.match(renderOperationalObservationReport(r).html,/심각 경고/);
 for(const mutate of [r=>r.private='<script>PRIVATE</script>',r=>r.organizationId='<img src=x>',r=>r.samples[0].assessment.alerts[0].message='PRIVATE',r=>r.failureCode='<script>PRIVATE</script>']){const r=fixture();mutate(r);assert.throws(()=>renderOperationalObservationReport(r));}assert.throws(()=>renderOperationalObservationReport(fixture(),{...scope,organizationId:randomUUID()}));
});

test('report options reject duplicate or partial scope, same input/output and unexpected destinations',()=>{
 const r=observationReportOptions(['input.json','output.html','--organization-id',scope.organizationId.toUpperCase(),'--project-id',scope.projectId]);assert.deepEqual(r.expected,scope);assert.equal(r.outputPath,'output.html');
 for(const args of [[],['input.json'],['input.json','output.txt'],['input.html','input.html'],['input','--output'],['input','output.html','--organization-id',scope.organizationId],['input','output.html','--unknown','PRIVATE'],['input','output.html','--project-id',scope.projectId,'--project-id',scope.projectId]])assert.throws(()=>observationReportOptions(args));
});

test('report writer creates a new file and never replaces an existing output',async()=>temporary(async directory=>{
 const path=join(directory,'input.json'),outputPath=join(directory,'output.html');await writeFile(path,JSON.stringify(fixture()));const result=await writeObservationReport({path,outputPath,expected:scope});assert.equal(result.outputCreated,true);assert.equal(result.observationStatus,'warning');assert.equal(result.authenticityVerified,false);assert.equal(result.currentReleasePermissionVerified,false);const before=await readFile(outputPath);await assert.rejects(writeObservationReport({path,outputPath,expected:scope}));assert.deepEqual(await readFile(outputPath),before);
}));

test('concurrent report exports preserve exactly one complete output without deleting the winner',async()=>temporary(async directory=>{
 const path=join(directory,'input.json'),outputPath=join(directory,'output.html');await writeFile(path,JSON.stringify(fixture()));const results=await Promise.allSettled([writeObservationReport({path,outputPath,expected:scope}),writeObservationReport({path,outputPath,expected:scope})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);assert.equal(await readFile(outputPath,'utf8'),renderOperationalObservationReport(fixture(),scope).html);
}));

test('malformed input and wrong expected scope fail before any output creation',async()=>temporary(async directory=>{
 const path=join(directory,'input.json'),outputPath=join(directory,'output.html');for(const data of [Buffer.from([0xff]),Buffer.alloc(1048577),JSON.stringify({...fixture(),private:'PRIVATE'})]){await writeFile(path,data);await assert.rejects(writeObservationReport({path,outputPath,expected:scope}));await assert.rejects(readFile(outputPath),{code:'ENOENT'});}await writeFile(path,JSON.stringify(fixture()));await assert.rejects(writeObservationReport({path,outputPath,expected:{...scope,projectId:randomUUID()}}));await assert.rejects(readFile(outputPath),{code:'ENOENT'});
}));

test('partial output failures remove only their newly created file',async()=>temporary(async directory=>{
 const path=join(directory,'input.json'),outputPath=join(directory,'output.html');await writeFile(path,JSON.stringify(fixture()));const create=async(...args)=>{const h=await open(...args);return {writeFile:async()=>{await h.write('partial');throw Error('PRIVATE write failure');},close:()=>h.close()};};await assert.rejects(writeObservationReport({path,outputPath,expected:scope},{create}));await assert.rejects(readFile(outputPath),{code:'ENOENT'});
 await writeFile(outputPath,'existing');let removed=false;await assert.rejects(writeObservationReport({path,outputPath,expected:scope},{create:async()=>{throw Error('PRIVATE creation failure');},remove:async()=>{removed=true;}}));assert.equal(removed,false);assert.equal(await readFile(outputPath,'utf8'),'existing');
}));

test('an output close failure never leaves a file reported as successfully exported',async()=>temporary(async directory=>{
 const path=join(directory,'input.json'),outputPath=join(directory,'output.html');await writeFile(path,JSON.stringify(fixture()));const create=async(...args)=>{const h=await open(...args);return {writeFile:(...args)=>h.writeFile(...args),close:async()=>{await h.close();throw Error('PRIVATE close failure');}};};await assert.rejects(writeObservationReport({path,outputPath,expected:scope},{create}));await assert.rejects(readFile(outputPath),{code:'ENOENT'});
}));

test('real report CLI distinguishes complete, incomplete, critical and invalid input without leaking it',async()=>temporary(async directory=>{
 const path=join(directory,'input.json'),invoke=output=>spawnSync(process.execPath,['scripts/write-operations-observation-report.mjs',path,output],{encoding:'utf8',timeout:10000});
 await writeFile(path,JSON.stringify(fixture()));const success=invoke(join(directory,'complete.html'));assert.equal(success.status,0);assert.equal(JSON.parse(success.stdout).currentReleasePermissionVerified,false);
 const incomplete=fixture();incomplete.completed=false;await writeFile(path,JSON.stringify(incomplete));const partial=invoke(join(directory,'incomplete.html'));assert.equal(partial.status,1);assert.equal(JSON.parse(partial.stdout).outputCreated,true);assert.match(await readFile(join(directory,'incomplete.html'),'utf8'),/미완료 기록/);
 const critical=fixture();critical.criticalObserved=true;critical.samples[0].assessment.status='critical';critical.samples[0].assessment.alerts=[{code:'worker-not-recent',severity:'critical',scope:'service'}];await writeFile(path,JSON.stringify(critical));assert.equal(invoke(join(directory,'critical.html')).status,2);
 await writeFile(path,JSON.stringify({...fixture(),private:'PRIVATE-SHOULD-NOT-PRINT'}));const bad=invoke(join(directory,'bad.html'));assert.equal(bad.status,2);assert.doesNotMatch(bad.stdout+bad.stderr,/PRIVATE-SHOULD-NOT-PRINT|private/);await assert.rejects(readFile(join(directory,'bad.html')),{code:'ENOENT'});
}));
