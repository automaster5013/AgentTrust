import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,realpathSync,rmSync,readdirSync,symlinkSync} from 'node:fs';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {spawnSync} from 'node:child_process';
import {hash} from '../packages/contracts/hash.js';
import {evaluate} from '../packages/evaluator/index.js';
import {compareRuns} from '../packages/evaluator/comparison.js';
import {ReceiptSigner} from '../packages/receipts/signature.js';
import {legacyCatalogueFromFiles} from '../packages/stack-legacy-link/catalogue.js';
const id=n=>'abcdef00-0000-4000-8000-'+String(n).padStart(12,'0'),sha=value=>createHash('sha256').update(value).digest('hex');
const pair=generateKeyPairSync('ed25519'),pem=pair.publicKey.export({type:'spki',format:'pem'}),signer=new ReceiptSigner(pair.privateKey.export({type:'pkcs8',format:'pem'}));
function scratch(t){const base=resolve('.local');mkdirSync(base,{recursive:true});const dir=mkdtempSync(join(base,'stack-legacy-bodies-unit-'));t.after(()=>{const actual=realpathSync(dir),root=realpathSync(base),tail=relative(root,actual);assert.ok(!isAbsolute(tail)&&!tail.startsWith('..')&&tail.startsWith('stack-legacy-bodies-unit-'));rmSync(dir,{recursive:true,force:true});});return dir;}
function fixture(t,{withBaseline=false,mode='compliant',manualStatus}={}){
 const directory=scratch(t),manual=manualStatus!==undefined,version=(n,data)=>({id:id(n),contentHash:hash(data),createdAt:'2026-10-08T00:00:00.000Z',...data});
 function run(n,mode){const snapshot={agent:version(n+10,{name:'Recorded synthetic agent',mode}),dataset:version(20,{name:'Recorded synthetic criteria',cases:[{id:'case',input:'CONFIDENTIAL_BODY_INPUT',mock:{output:'refund CONFIDENTIAL_BODY_OUTPUT',toolEvents:[]},rules:[{id:'required',type:'contains',value:'refund'}]}]}),policy:version(21,{name:'Recorded synthetic policy',minimumPassRate:1,...(manual?{requiresManualApproval:true}:{})})};const body={id:id(n),organizationId:id(2),projectId:id(3),snapshot,snapshotHash:hash(snapshot),agentVersionId:snapshot.agent.id,datasetVersionId:snapshot.dataset.id,policyVersionId:snapshot.policy.id,...evaluate(snapshot)};body.resultHash=hash({results:body.results,gate:body.gate});return body;}
 const candidate=run(4,mode),baseline=withBaseline?run(5,'compliant'):undefined,bodies={candidate,...(baseline?{baseline}:{})},comparison=baseline?compareRuns(baseline,candidate):undefined;
 const evaluationPassed=candidate.gate.decision==='pass'&&(!comparison||(comparison.evaluationPassed??comparison.deploymentAllowed)),allowed=evaluationPassed&&(!manual||manualStatus==='approved');
 const artifact={schemaVersion:1,receiptId:id(1),organizationId:id(2),projectId:id(3),checkedAt:'2026-10-08T01:00:00.000Z',request:{candidateRunId:id(4),agentVersionId:candidate.agentVersionId,datasetVersionId:candidate.datasetVersionId,policyVersionId:candidate.policyVersionId,...(baseline?{baselineRunId:id(5)}:{})},result:{runId:id(4),decision:allowed?'pass':'block',deploymentAllowed:allowed,reasons:allowed?[]:['CONFIDENTIAL_BODY_DENIAL'],...(comparison?{comparison}:{})},evidence:{}};
 let review;
 if(manual){artifact.result.manualApproval={required:true,status:manualStatus};if(manualStatus!=='missing'){const payload={schemaVersion:1,id:id(50),organizationId:id(2),projectId:id(3),runId:id(4),actorId:id(60),decision:manualStatus==='rejected'?'rejected':'approved',comment:'CONFIDENTIAL_BODY_REVIEW',createdAt:'2026-10-08T00:30:00.000Z',snapshotHash:candidate.snapshotHash,resultHash:candidate.resultHash};review={...payload,reviewHash:hash(payload)};Object.assign(artifact.result.manualApproval,{reviewId:review.id,reviewHash:review.reviewHash});}}
 const entry={receiptFile:'receipt.json',trustedKeyFile:'trusted.pem',mappingFile:'mapping.json',mappingSha256:'',bodyFile:'bodies.json',bodySha256:''},catalogue={schemaVersion:2,kind:'legacy-receipt-link-catalogue',entries:[entry]},bundle={schemaVersion:1,kind:'legacy-receipt-source-bodies',bodies,...(review?{review}:{})},catalogueFile=join(directory,'catalogue.json');writeFileSync(join(directory,'trusted.pem'),pem);
 function saveCatalogue(){writeFileSync(catalogueFile,JSON.stringify(catalogue)+'\n');return {catalogueFile,expectedCatalogueSha256:sha(readFileSync(catalogueFile)),expectedTarget:{organizationId:id(20),projectId:id(30)}};}
 function saveBodies(){writeFileSync(join(directory,entry.bodyFile),JSON.stringify(bundle)+'\n');entry.bodySha256=sha(readFileSync(join(directory,entry.bodyFile)));return saveCatalogue();}
 function seal(){for(const [name,body] of Object.entries(bodies)){body.snapshotHash=hash(body.snapshot);body.resultHash=hash({results:body.results,gate:body.gate});artifact.evidence[name]={runId:body.id,snapshotHash:body.snapshotHash,resultHash:body.resultHash};}const receipt={artifact,artifactHash:hash(artifact),signature:signer.sign(artifact)};const receiptBytes=Buffer.from(JSON.stringify(receipt)+'\n');writeFileSync(join(directory,entry.receiptFile),receiptBytes);const mapping={schemaVersion:1,sourcePlatform:'agenttrust-4310',targetPlatform:'agenttrust-4320',sourceOrganizationId:artifact.organizationId,sourceProjectId:artifact.projectId,targetOrganizationId:id(20),targetProjectId:id(30),sourceReceiptId:artifact.receiptId,sourceArtifactHash:receipt.artifactHash,sourceReceiptBytesSha256:sha(receiptBytes),sourceSigningKeyId:signer.keyId};writeFileSync(join(directory,entry.mappingFile),JSON.stringify(mapping)+'\n');entry.mappingSha256=sha(readFileSync(join(directory,entry.mappingFile)));return saveBodies();}
 return {directory,catalogueFile,catalogue,entry,bundle,bodies,artifact,review,seal,saveBodies,saveCatalogue,options:seal()};
}
const snapshot=directory=>Object.fromEntries(readdirSync(directory).map(name=>[name,sha(readFileSync(join(directory,name)))]));
const cli=options=>[resolve('scripts/stack-legacy-catalogue.mjs'),options.catalogueFile,'--target-organization-id',id(20),'--target-project-id',id(30),'--catalogue-sha256',options.expectedCatalogueSha256];

test('catalogue v2 verifies signed source bodies and their structure without importing or reexecuting',async t=>{
 for(const withBaseline of [false,true]){const f=fixture(t,{withBaseline}),before=snapshot(f.directory),report=await legacyCatalogueFromFiles(f.options),record=report.records[0];assert.equal(report.schemaVersion,2);assert.equal(report.bodyEvidenceMode,'linked-source-bodies');assert.equal(report.bodyEvidenceEntriesVerified,1);assert.equal(record.evidenceBodiesVerified,true);assert.equal(record.evidenceStructuresVerified,true);assert.equal(record.baselineEvidenceVerified,withBaseline);assert.equal(record.agentReexecuted,false);assert.equal(record.evidenceMetadataAuthenticated,false);assert.equal(record.unsignedMetadataUsedForStructure,false);assert.equal(record.deploymentAllowed,false);assert.equal(report.targetRecordImported,false);assert.equal(report.currentReleasePermissionVerified,false);assert.deepEqual(snapshot(f.directory),before);assert.ok(!JSON.stringify(report).includes('CONFIDENTIAL_'));}
});

test('historical blocked outcomes retain denial after paired body and comparison verification',async t=>{
 const f=fixture(t,{withBaseline:true,mode:'regression'}),record=(await legacyCatalogueFromFiles(f.options)).records[0];assert.equal(record.historicalDecision,'block');assert.equal(record.evidenceStructuresVerified,true);assert.equal(record.deploymentAllowed,false);
});

test('unsigned run annotations are ignored and never copied into the body verification result',async t=>{
 const f=fixture(t);Object.assign(f.bodies.candidate,{state:'CONFIDENTIAL_FORGED_STATE',summary:{passRate:999},agentVersionId:id(99),completedAt:'CONFIDENTIAL_FORGED_TIME'});const record=(await legacyCatalogueFromFiles(f.saveBodies())).records[0];assert.equal(record.evidenceStructuresVerified,true);assert.equal(record.evidenceMetadataAuthenticated,false);assert.ok(!JSON.stringify(record).includes('CONFIDENTIAL_'));
});

test('changed body payload cannot be authenticated by updating its unsigned hash and catalogue pin',async t=>{
 const f=fixture(t);f.bodies.candidate.results[0].evidence.output='CONFIDENTIAL_CHANGED_OUTPUT';f.bodies.candidate.resultHash=hash({results:f.bodies.candidate.results,gate:f.bodies.candidate.gate});await assert.rejects(legacyCatalogueFromFiles(f.saveBodies()));
});

test('source body tenant coordinates cannot be rewritten to the target project',async t=>{
 const f=fixture(t);f.bodies.candidate.organizationId=id(20);f.bodies.candidate.projectId=id(30);await assert.rejects(legacyCatalogueFromFiles(f.saveBodies()));
});

test('authentic signatures and matching raw pins cannot hide inconsistent stored rule evidence',async t=>{
 const f=fixture(t);f.bodies.candidate.results[0].rules[0].status='fail';const options=f.seal();await assert.rejects(legacyCatalogueFromFiles(options));const metadata=structuredClone(f.catalogue);metadata.schemaVersion=1;delete metadata.entries[0].bodyFile;delete metadata.entries[0].bodySha256;writeFileSync(f.catalogueFile,JSON.stringify(metadata)+'\n');const report=await legacyCatalogueFromFiles({...options,expectedCatalogueSha256:sha(readFileSync(f.catalogueFile))});assert.equal(report.records[0].evidenceBodiesVerified,false);
});

test('the paired body comparison is recalculated from authenticated evidence instead of trusting signed arithmetic',async t=>{
 const f=fixture(t,{withBaseline:true});f.artifact.result.comparison.passRateDelta=0.5;await assert.rejects(legacyCatalogueFromFiles(f.seal()));
});

test('review hashes in the receipt require the original body and do not establish current reviewer authority',async t=>{
 for(const manualStatus of ['approved','rejected','expired']){const f=fixture(t,{manualStatus}),record=(await legacyCatalogueFromFiles(f.options)).records[0];assert.equal(record.reviewBodyExpected,true);assert.equal(record.reviewBodyVerified,true);assert.equal(record.currentReviewerAuthorityVerified,false);assert.equal(record.currentReleasePermissionVerified,false);assert.equal(record.deploymentAllowed,false);assert.ok(!JSON.stringify(record).includes(f.review.actorId));delete f.bundle.review;await assert.rejects(legacyCatalogueFromFiles(f.saveBodies()));}
});

test('a missing historical approval stays explicitly unverified while recorded result bodies can be checked',async t=>{
 const f=fixture(t,{manualStatus:'missing'}),record=(await legacyCatalogueFromFiles(f.options)).records[0];assert.equal(record.reviewBodyExpected,false);assert.equal(record.reviewBodyVerified,false);assert.equal(record.historicalDecision,'block');assert.equal(record.evidenceBodiesVerified,true);assert.equal(record.deploymentAllowed,false);
});

test('a modified review cannot replace the signed reference by recomputing its own hash',async t=>{
 const f=fixture(t,{manualStatus:'approved'});f.bundle.review.comment='CONFIDENTIAL_MODIFIED_REVIEW';const {reviewHash,...payload}=f.bundle.review;f.bundle.review.reviewHash=hash(payload);await assert.rejects(legacyCatalogueFromFiles(f.saveBodies()));
});

test('body selection and bundle schemas are closed and candidate/baseline selection cannot be incomplete',async t=>{
 const f=fixture(t,{withBaseline:true});delete f.bundle.bodies.baseline;await assert.rejects(legacyCatalogueFromFiles(f.saveBodies()));const other=fixture(t);other.bundle.currentReleasePermissionVerified=true;await assert.rejects(legacyCatalogueFromFiles(other.saveBodies()));
 for(const mutate of [entry=>{delete entry.bodySha256;},entry=>{entry.bodySha256='0'.repeat(64);},entry=>{entry.bodyFile='../outside.json';}]){const x=fixture(t);mutate(x.entry);await assert.rejects(legacyCatalogueFromFiles(x.saveCatalogue()));}
});

test('body raw byte pin is distinct from JSON meaning and all body reads count toward the same total budget',async t=>{
 const f=fixture(t),path=join(f.directory,f.entry.bodyFile);writeFileSync(path,JSON.stringify(f.bundle,null,2)+'\n');await assert.rejects(legacyCatalogueFromFiles(f.options));f.entry.bodySha256=sha(readFileSync(path));const options=f.saveCatalogue(),report=await legacyCatalogueFromFiles(options);await assert.rejects(legacyCatalogueFromFiles({...options,maximumInputBytes:report.inputBytesRead-1}));assert.equal((await legacyCatalogueFromFiles({...options,maximumInputBytes:report.inputBytesRead})).inputBytesRead,report.inputBytesRead);
});

test('body JSON errors and complete historical receipt references are mandatory for strict body mode',async t=>{
 const f=fixture(t);writeFileSync(join(f.directory,f.entry.bodyFile),Buffer.from([255]));f.entry.bodySha256=sha(readFileSync(join(f.directory,f.entry.bodyFile)));await assert.rejects(legacyCatalogueFromFiles(f.saveCatalogue()));const missing=fixture(t,{mode:'regression'});missing.artifact.evidence.candidate.resultHash=null;const receipt={artifact:missing.artifact,artifactHash:hash(missing.artifact),signature:signer.sign(missing.artifact)},bytes=Buffer.from(JSON.stringify(receipt)+'\n');writeFileSync(join(missing.directory,missing.entry.receiptFile),bytes);const mapping=JSON.parse(readFileSync(join(missing.directory,missing.entry.mappingFile),'utf8'));mapping.sourceArtifactHash=receipt.artifactHash;mapping.sourceReceiptBytesSha256=sha(bytes);writeFileSync(join(missing.directory,missing.entry.mappingFile),JSON.stringify(mapping)+'\n');missing.entry.mappingSha256=sha(readFileSync(join(missing.directory,missing.entry.mappingFile)));await assert.rejects(legacyCatalogueFromFiles(missing.saveCatalogue()));
});

test('actual v2 CLI preserves every byte and redacts bodies, reviews and failed partial proof',t=>{
 const f=fixture(t,{withBaseline:true,manualStatus:'approved'}),before=snapshot(f.directory);const success=spawnSync(process.execPath,cli(f.options),{cwd:resolve('.'),encoding:'utf8',timeout:8000});assert.equal(success.status,0,success.stderr);const report=JSON.parse(success.stdout);assert.equal(report.records[0].reviewBodyVerified,true);assert.ok(!success.stdout.includes('CONFIDENTIAL_')&&!success.stdout.includes(f.review.actorId)&&!success.stdout.includes(f.directory));assert.deepEqual(snapshot(f.directory),before);
 f.bodies.candidate.results[0].evidence.output='CONFIDENTIAL_CLI_BROKEN_OUTPUT';const failed=spawnSync(process.execPath,cli(f.saveBodies()),{cwd:resolve('.'),encoding:'utf8',timeout:8000});assert.equal(failed.status,2);assert.equal(failed.stdout,'');assert.ok(!failed.stderr.includes('CONFIDENTIAL_')&&!failed.stderr.includes(f.directory));
});


test('linked body files cannot use a symbolic-link alias',{skip:process.platform==='win32'},async t=>{
 const f=fixture(t);symlinkSync(join(f.directory,f.entry.bodyFile),join(f.directory,'body-alias.json'));f.entry.bodyFile='body-alias.json';await assert.rejects(legacyCatalogueFromFiles(f.saveCatalogue()));
});

test('a second record body failure emits no partial proof for the first verified body',async t=>{
 const first=fixture(t),second=fixture(t,{withBaseline:true});second.artifact.receiptId=id(9);second.seal();const entry={...second.entry,receiptFile:'second-receipt.json',mappingFile:'second-mapping.json',bodyFile:'second-bodies.json'};
 for(const field of ['receiptFile','mappingFile','bodyFile'])writeFileSync(join(first.directory,entry[field]),readFileSync(join(second.directory,second.entry[field])));
 first.catalogue.entries.push(entry);const options=first.saveCatalogue();assert.equal((await legacyCatalogueFromFiles(options)).bodyEvidenceEntriesVerified,2);
 const body=JSON.parse(readFileSync(join(first.directory,entry.bodyFile),'utf8'));body.bodies.candidate.results[0].evidence.output='CONFIDENTIAL_SECOND_RECORD_BODY';writeFileSync(join(first.directory,entry.bodyFile),JSON.stringify(body)+'\n');entry.bodySha256=sha(readFileSync(join(first.directory,entry.bodyFile)));const before=snapshot(first.directory),failed=spawnSync(process.execPath,cli(first.saveCatalogue()),{cwd:resolve('.'),encoding:'utf8',timeout:8000});assert.equal(failed.status,2);assert.equal(failed.stdout,'');assert.ok(!failed.stderr.includes('CONFIDENTIAL_')&&!failed.stderr.includes(first.directory));const after=snapshot(first.directory);delete before['catalogue.json'];delete after['catalogue.json'];assert.deepEqual(after,before);
});
