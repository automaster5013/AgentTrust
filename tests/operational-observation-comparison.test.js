import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile,rm,access} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {initialObservationReport} from '../scripts/operational-observation.mjs';
import {compareOperationalObservations} from '../packages/operations/observation-comparison.js';
import {renderOperationalObservationComparison} from '../packages/operations/observation-comparison-report.js';
import {observationComparisonOptions,compareObservationFiles} from '../scripts/compare-operations-observations.mjs';
import {observationComparisonReportOptions,writeObservationComparisonReport} from '../scripts/write-operations-comparison-report.mjs';
const scope={organizationId:randomUUID(),projectId:randomUUID()};
function fixture(count=3,kind='warning',offset=0){
 const report=initialObservationReport({organizationIndex:0,samples:Math.max(count,1),intervalSeconds:1},scope),at=i=>new Date(Date.UTC(2026,9,10,0,0,offset+i)).toISOString();
 Object.assign(report,{completed:count>0,stage:'finished',sessionScopeVerified:count>0,sessionLoggedOut:true,criticalObserved:count>0&&kind==='critical',finishedAt:at(count),samples:Array.from({length:count},(_,i)=>({at:at(i),assessment:{schemaVersion:1,status:kind,...scope,observedAt:at(i),alerts:kind==='ok'?[]:[kind==='critical'?{code:'worker-not-recent',severity:'critical',scope:'service'}:{code:'retained-capacity-high',severity:'warning',scope:'organization'}],readOnly:true,automatedRemediationPerformed:false,releasePermissionVerified:false,continuousMonitoringProven:false}}))});return report;
}
async function temporary(fn){const root=resolve('.local');await mkdir(root,{recursive:true});const dir=await mkdtemp(join(root,'observation-comparison-test-'));try{return await fn(dir);}finally{assert.equal(dirname(resolve(dir)),root);assert.ok(dir.startsWith(join(root,'observation-comparison-test-')));await rm(dir,{recursive:true,force:true});}}
async function inputs(dir,a=fixture(),b=fixture(2,'ok',10)){const baselinePath=join(dir,'baseline.json'),candidatePath=join(dir,'candidate.json');await writeFile(baselinePath,JSON.stringify(a));await writeFile(candidatePath,JSON.stringify(b));return {baselinePath,candidatePath,expected:scope};}
const cli=(script,args)=>spawnSync(process.execPath,[script,...args],{encoding:'utf8'});

test('comparison counts recorded alert samples and preserves differing observation windows',()=>{
 const r=compareOperationalObservations(fixture(),fixture(2,'ok',10),scope);assert.equal(r.status,'compared');assert.equal(r.sampleCountChange,-1);assert.equal(r.baseline.recordedSampleSpanSeconds,2);assert.equal(r.candidate.recordedSampleSpanSeconds,1);assert.deepEqual(r.alertChanges,[{code:'retained-capacity-high',baselineSamples:3,candidateSamples:0,sampleCountChange:-3,occurrence:'baseline-only'}]);assert.equal(r.expectedScopeVerified,true);assert.equal(r.equalObservationDurationVerified,false);assert.equal(r.alertResolutionVerified,false);
});
test('candidate-only and shared alerts are described without improvement or resolution claims',()=>{
 const introduced=compareOperationalObservations(fixture(2,'ok'),fixture(3));assert.equal(introduced.alertChanges[0].occurrence,'candidate-only');assert.equal(introduced.alertChanges[0].candidateSamples,3);const shared=compareOperationalObservations(fixture(),fixture(2));assert.equal(shared.alertChanges[0].occurrence,'both');assert.equal(shared.alertChanges[0].sampleCountChange,-1);assert.equal(shared.expectedScopeVerified,false);
});
test('empty and partial observations remain incomplete even when a critical record is present',()=>{
 const r=compareOperationalObservations(fixture(0),fixture(2,'critical'));assert.equal(r.status,'incomplete');assert.equal(r.criticalObserved,true);assert.equal(r.baseline.recordedSampleSpanSeconds,null);assert.equal(r.currentHealthVerified,false);assert.equal(r.currentReleasePermissionVerified,false);
});
test('a recorded critical baseline cannot be erased by an apparently normal candidate',()=>{
 const r=compareOperationalObservations(fixture(2,'critical'),fixture(2,'ok'));assert.equal(r.status,'critical');assert.equal(r.criticalObserved,true);assert.equal(r.alertChanges[0].occurrence,'baseline-only');assert.equal(r.runtimeVerified,false);
});
test('different organization or project scopes and incorrect expected scope are refused',()=>{
 for(const key of ['organizationId','projectId']){const other=fixture();other[key]=randomUUID();for(const s of other.samples)s.assessment[key]=other[key];assert.throws(()=>compareOperationalObservations(fixture(),other));assert.throws(()=>compareOperationalObservations(fixture(),fixture(),{...scope,[key]:randomUUID()}));}assert.throws(()=>compareOperationalObservations(fixture(),fixture(),{organizationId:scope.organizationId}));
});
test('private fields, malformed samples and unsupported diagnostics cannot enter comparisons',()=>{
 for(const mutate of [r=>r.private='PRIVATE',r=>r.samples[0].assessment.alerts[0].message='PRIVATE',r=>r.samples[0].at='invalid',r=>r.failureCode='PRIVATE',r=>r.samples[0].assessment.projectId=randomUUID()]){const r=fixture();mutate(r);assert.throws(()=>compareOperationalObservations(r,fixture()));assert.throws(()=>compareOperationalObservations(fixture(),r));}
});
test('safe recorded request and cleanup diagnoses are copied without authority or causality',()=>{
 const a=fixture();Object.assign(a,{completed:false,failed:true,failureStage:'sampling',failureCode:'authentication-denied',sessionLoggedOut:false,cleanupFailed:true,cleanupFailureCode:'access-denied'});const r=compareOperationalObservations(a,fixture());assert.equal(r.baseline.recordedFailureCode,'authentication-denied');assert.equal(r.baseline.recordedCleanupFailureCode,'access-denied');for(const key of ['diagnosticAuthenticityVerified','authenticityVerified','recordedWindowOrderVerified','continuousMonitoringProven','serverDeployed'])assert.equal(r[key],false);
});
test('comparison arguments require two inputs and a complete nonduplicated scope pair',()=>{
 assert.deepEqual(observationComparisonOptions(['a','b','--organization-id',scope.organizationId.toUpperCase(),'--project-id',scope.projectId]).expected,scope);for(const a of [[],['a'],['','b'],['a',''],['a','--candidate'],['a','b','--project-id',scope.projectId],['a','b','--unknown','PRIVATE'],['a','b','--project-id',scope.projectId,'--project-id',scope.projectId]])assert.throws(()=>observationComparisonOptions(a));
});
test('file comparison bounds UTF-8 and each input and validates options before reading',async()=>temporary(async dir=>{
 const options=await inputs(dir);assert.equal((await compareObservationFiles(options)).status,'compared');await assert.rejects(compareObservationFiles({...options,private:'PRIVATE'}));await writeFile(options.candidatePath,Buffer.from([0xff]));await assert.rejects(compareObservationFiles(options));await writeFile(options.candidatePath,Buffer.alloc(1048577,32));await assert.rejects(compareObservationFiles(options));
}));
test('comparison CLI uses real exit codes 0/1/2 and generic diagnostics without input leaks',async()=>temporary(async dir=>{
 const options=await inputs(dir),args=[options.baselinePath,options.candidatePath];assert.equal(cli('scripts/compare-operations-observations.mjs',args).status,0);await writeFile(options.candidatePath,JSON.stringify(fixture(0)));assert.equal(cli('scripts/compare-operations-observations.mjs',args).status,1);await writeFile(options.candidatePath,JSON.stringify(fixture(2,'critical')));assert.equal(cli('scripts/compare-operations-observations.mjs',args).status,2);await writeFile(options.candidatePath,JSON.stringify({...fixture(),private:'PRIVATE-SHOULD-NOT-PUBLISH'}));const r=cli('scripts/compare-operations-observations.mjs',args);assert.equal(r.status,2);assert.equal(r.stdout,'');assert.doesNotMatch(r.stderr,/PRIVATE-SHOULD-NOT-PUBLISH/);
}));
test('static comparison HTML is Korean, scoped and has no scripts or external assets',()=>{
 const {html,comparison}=renderOperationalObservationComparison(fixture(),fixture(2,'ok',10),scope);assert.equal(comparison.status,'compared');assert.match(html,/<html lang="ko">/);assert.match(html,/Content-Security-Policy/);assert.match(html,/default-src 'none'/);assert.match(html,/기대 조직·프로젝트와 일치/);assert.match(html,/<caption>/);assert.match(html,/scope="col"/);assert.match(html,/scope="row"/);assert.doesNotMatch(html,/<script|<iframe|<form|<img|https?:|fetch\(|\.local\//i);
});
test('incomplete and historical critical HTML cannot describe present health or alert resolution',()=>{
 assert.match(renderOperationalObservationComparison(fixture(0),fixture()).html,/미완료 기록 포함/);assert.match(renderOperationalObservationComparison(fixture(2,'critical'),fixture(2,'ok')).html,/심각 경고 기록 포함/);assert.match(renderOperationalObservationComparison(fixture(),fixture(2,'ok')).html,/장애 해결을 판단하지 않습니다/);assert.match(renderOperationalObservationComparison(fixture(0),fixture(0)).html,/미완료 기록은 정상 운영의 근거가 아닙니다/);
});
test('comparison HTML rejects injectable raw fields and incorrect expected scope',()=>{
 const r=fixture();r.private='<script>PRIVATE</script>';assert.throws(()=>renderOperationalObservationComparison(r,fixture()));assert.throws(()=>renderOperationalObservationComparison(fixture(),fixture(),{...scope,projectId:randomUUID()}));
});
test('HTML output options protect both input paths and reject invalid destinations',()=>{
 assert.equal(observationComparisonReportOptions(['a','b','c.html']).outputPath,'c.html');for(const a of [[],['a','b'],['a','b','c.txt'],['a.html','b','a.html'],['a','b.html','b.html'],['a','b','--out'],['a','b','c.html','--organization-id',scope.organizationId]])assert.throws(()=>observationComparisonReportOptions(a));
});
test('comparison writer creates a new report and preserves an existing destination',async()=>temporary(async dir=>{
 const options={...await inputs(dir),outputPath:join(dir,'review.html')};const result=await writeObservationComparisonReport(options);assert.equal(result.comparisonStatus,'compared');const bytes=await readFile(options.outputPath);await assert.rejects(writeObservationComparisonReport(options),{code:'EEXIST'});assert.deepEqual(await readFile(options.outputPath),bytes);
}));
test('concurrent comparison report writers leave one complete winner',async()=>temporary(async dir=>{
 const options={...await inputs(dir),outputPath:join(dir,'review.html')};const r=await Promise.allSettled([writeObservationComparisonReport(options),writeObservationComparisonReport(options)]);assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.match(await readFile(options.outputPath,'utf8'),/<\/html>$/);
}));
test('invalid comparison input is rejected before an HTML file is created',async()=>temporary(async dir=>{
 const options={...await inputs(dir),outputPath:join(dir,'review.html')};await writeFile(options.candidatePath,JSON.stringify({...fixture(),private:'PRIVATE'}));await assert.rejects(writeObservationComparisonReport(options));await assert.rejects(access(options.outputPath),{code:'ENOENT'});
}));
test('partial comparison report writes remove only their owned output',async()=>temporary(async dir=>{
 const options={...await inputs(dir),outputPath:join(dir,'review.html')},removed=[];await assert.rejects(writeObservationComparisonReport(options,{create:async(path)=>{await writeFile(path,'partial',{flag:'wx'});return {writeFile:async()=>{throw Error('PRIVATE');},close:async()=>{}};},remove:async p=>{removed.push(p);await rm(p);}}));assert.deepEqual(removed,[options.outputPath]);await assert.rejects(access(options.outputPath),{code:'ENOENT'});
}));
test('creation and close failures preserve preexisting files and clean owned new files',async()=>temporary(async dir=>{
 const options={...await inputs(dir),outputPath:join(dir,'review.html')};await writeFile(options.outputPath,'original');let removed=false;await assert.rejects(writeObservationComparisonReport(options,{create:async()=>{throw Error('PRIVATE');},remove:async()=>{removed=true;}}));assert.equal(removed,false);assert.equal(await readFile(options.outputPath,'utf8'),'original');await rm(options.outputPath);await assert.rejects(writeObservationComparisonReport(options,{create:async p=>{await writeFile(p,'partial',{flag:'wx'});return {writeFile:async()=>{},close:async()=>{throw Error('PRIVATE');}};}}));await assert.rejects(access(options.outputPath),{code:'ENOENT'});
}));
test('HTML report CLI preserves incomplete and critical exit codes and rejects unsafe inputs',async()=>temporary(async dir=>{
 const options=await inputs(dir);for(const [kind,count,expected] of [['ok',2,0],['warning',0,1],['critical',2,2]]){await writeFile(options.candidatePath,JSON.stringify(fixture(count,kind,10)));const output=join(dir,kind+'.html'),r=cli('scripts/write-operations-comparison-report.mjs',[options.baselinePath,options.candidatePath,output]);assert.equal(r.status,expected);assert.equal(JSON.parse(r.stdout).outputCreated,true);assert.match(await readFile(output,'utf8'),/<\/html>$/);}await writeFile(options.candidatePath,JSON.stringify({...fixture(),private:'PRIVATE-SHOULD-NOT-PUBLISH'}));const output=join(dir,'invalid.html'),r=cli('scripts/write-operations-comparison-report.mjs',[options.baselinePath,options.candidatePath,output]);assert.equal(r.status,2);assert.doesNotMatch(r.stdout+r.stderr,/PRIVATE-SHOULD-NOT-PUBLISH/);await assert.rejects(access(output),{code:'ENOENT'});
}));
