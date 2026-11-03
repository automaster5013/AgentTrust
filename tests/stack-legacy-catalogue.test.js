import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,realpathSync,rmSync,readdirSync,symlinkSync} from 'node:fs';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {spawnSync} from 'node:child_process';
import {ReceiptSigner} from '../packages/receipts/signature.js';
import {hash} from '../packages/contracts/hash.js';
import {legacyCatalogueFromFiles,legacyCatalogueBudget,legacyCatalogueByteLimit,legacyCatalogueTotalByteLimit} from '../packages/stack-legacy-link/catalogue.js';
import {parseLegacyCatalogueArguments} from '../scripts/stack-legacy-catalogue.mjs';
import {legacyCatalogueHtmlFromFiles} from '../packages/stack-legacy-link/catalogue-report.js';
const id=n=>'abcdef00-0000-4000-8000-'+String(n).padStart(12,'0'),sha=value=>createHash('sha256').update(value).digest('hex');
const pair=generateKeyPairSync('ed25519'),pem=pair.publicKey.export({type:'spki',format:'pem'}),signer=new ReceiptSigner(pair.privateKey.export({type:'pkcs8',format:'pem'}));
function scratch(t){const base=resolve('.local');mkdirSync(base,{recursive:true});const directory=mkdtempSync(join(base,'stack-legacy-catalogue-unit-'));t.after(()=>{const path=realpathSync(directory),root=realpathSync(base),tail=relative(root,path);assert.ok(!isAbsolute(tail)&&!tail.startsWith('..')&&tail.startsWith('stack-legacy-catalogue-unit-'));rmSync(directory,{recursive:true,force:true});});return directory;}
function fixture(t,rows=[{}, {blocked:true}]){
 const directory=join(scratch(t),'inputs');mkdirSync(directory);writeFileSync(join(directory,'trusted.pem'),pem);const entries=[];
 for(const [index,row] of rows.entries()){
  const artifact={schemaVersion:1,receiptId:row.receiptId??id(1+index*10),organizationId:row.organizationId??id(2),projectId:id(3),checkedAt:'2026-10-08T00:00:00.000Z',request:{candidateRunId:id(4+index*10)},result:{runId:id(4+index*10),decision:row.blocked?'block':'pass',deploymentAllowed:!row.blocked,reasons:row.blocked?['CONFIDENTIAL_CATALOGUE_REASON_CANARY']:[]},evidence:{candidate:{runId:id(4+index*10),snapshotHash:'a'.repeat(64),resultHash:'b'.repeat(64)}}};
  const bytes=Buffer.from(JSON.stringify({artifact,artifactHash:hash(artifact),signature:signer.sign(artifact)},null,2)+'\n');
  const mapping={schemaVersion:1,sourcePlatform:'agenttrust-4310',targetPlatform:'agenttrust-4320',sourceOrganizationId:artifact.organizationId,sourceProjectId:artifact.projectId,targetOrganizationId:id(20),targetProjectId:id(30),sourceReceiptId:artifact.receiptId,sourceArtifactHash:hash(artifact),sourceReceiptBytesSha256:sha(bytes),sourceSigningKeyId:signer.keyId};
  const mappingBytes=Buffer.from(JSON.stringify(mapping)+'\n'),entry={receiptFile:'receipt-'+index+'.json',mappingFile:'mapping-'+index+'.json',trustedKeyFile:'trusted.pem',mappingSha256:sha(mappingBytes)};writeFileSync(join(directory,entry.receiptFile),bytes);writeFileSync(join(directory,entry.mappingFile),mappingBytes);entries.push(entry);
 }
 const data={schemaVersion:1,kind:'legacy-receipt-link-catalogue',entries},catalogueFile=join(directory,'catalogue.json');
 const save=value=>{writeFileSync(catalogueFile,JSON.stringify(value)+'\n');return {catalogueFile,expectedCatalogueSha256:sha(readFileSync(catalogueFile)),expectedTarget:{organizationId:id(20),projectId:id(30)}};};
 return {directory,data,catalogueFile,save,options:save(data)};
}
const snapshot=directory=>Object.fromEntries(readdirSync(directory).map(name=>[name,sha(readFileSync(join(directory,name)))]));
const args=options=>[options.catalogueFile,'--target-organization-id',options.expectedTarget.organizationId,'--target-project-id',options.expectedTarget.projectId,'--catalogue-sha256',options.expectedCatalogueSha256];

test('offline HTML rechecks original signed files and distinguishes historical success from current authority',async t=>{
 const f=fixture(t),before=snapshot(f.directory),html=await legacyCatalogueHtmlFromFiles(f.options);
 assert.match(html,/과거 통과/);assert.match(html,/과거 차단/);assert.match(html,/현재 배포 권한 없음 · 자료 가져오기 없음/);assert.match(html,/본문 미검증/);assert.match(html,/검토 본문 검증 없음/);
 assert.match(html,/Content-Security-Policy/);assert.match(html,/default-src 'none'/);assert.match(html,/tabindex="0" role="region"/);assert.match(html,/scope="col"/);
 assert.ok(html.includes(f.options.expectedCatalogueSha256));assert.ok(html.includes(f.options.expectedTarget.projectId));
 assert.ok(!/<(?:script|img|iframe|form)\b|\b(?:href|src)=/i.test(html));assert.ok(!html.includes('CONFIDENTIAL_')&&!html.includes(pem)&&!html.includes(f.directory));assert.deepEqual(snapshot(f.directory),before);
});

test('report CLI writes one complete HTML document or no partial result after a late failure',t=>{
 const f=fixture(t),before=snapshot(f.directory),command=[resolve('scripts/stack-legacy-catalogue-report.mjs'),...args(f.options)];
 const good=spawnSync(process.execPath,command,{cwd:resolve('.'),encoding:'utf8',timeout:8000});assert.equal(good.status,0,good.stderr);assert.ok(good.stdout.startsWith('<!doctype html>'));assert.ok(good.stdout.endsWith('</html>\n'));assert.equal(good.stderr,'');assert.deepEqual(snapshot(f.directory),before);
 writeFileSync(join(f.directory,f.data.entries[1].receiptFile),'CONFIDENTIAL_REPORT_LATE_FAILURE');const bad=spawnSync(process.execPath,command,{cwd:resolve('.'),encoding:'utf8',timeout:8000});assert.equal(bad.status,2);assert.equal(bad.stdout,'');assert.ok(!bad.stderr.includes('CONFIDENTIAL_')&&!bad.stderr.includes(f.directory)&&!bad.stderr.includes(pem));
});

test('HTML reports require independent source and target pins rather than trusting a summary',async t=>{
 const f=fixture(t);await assert.rejects(legacyCatalogueHtmlFromFiles({...f.options,expectedCatalogueSha256:'0'.repeat(64)}));await assert.rejects(legacyCatalogueHtmlFromFiles({...f.options,expectedTarget:{organizationId:id(99),projectId:id(30)}}));await assert.rejects(legacyCatalogueHtmlFromFiles({records:[],deploymentAllowed:true}));
});

test('catalogue independently binds every signed source without importing records or authority',async t=>{
 const f=fixture(t),before=snapshot(f.directory),report=await legacyCatalogueFromFiles(f.options);assert.equal(report.verifiedEntries,2);assert.deepEqual(report.records.map(x=>x.historicalDecision),['pass','block']);assert.deepEqual(report.targetCoordinates,f.options.expectedTarget);assert.deepEqual(snapshot(f.directory),before);assert.equal(report.catalogueDigestMatched,true);
 for(const key of ['catalogueCryptographicallySigned','catalogueOperatorApprovalVerified','sourceCurrentTrustPolicyVerified','targetTenantAuthorityVerified','actorMappingPerformed','sourceRecordRewritten','targetRecordImported','currentReviewerAuthorityVerified','currentReleasePermissionVerified','deploymentAllowed'])assert.equal(report[key],false);
 for(const record of report.records){assert.equal(record.sourceSignatureVerified,true);assert.equal(record.deploymentAllowed,false);assert.equal(record.targetRecordImported,false);}const output=JSON.stringify(report);assert.ok(!output.includes('CONFIDENTIAL_')&&!output.includes(pem)&&!output.includes(f.directory));
});

test('catalogue digest mismatch refuses before following a missing referenced file',async t=>{
 const f=fixture(t);rmSync(join(f.directory,f.data.entries[0].mappingFile));await assert.rejects(legacyCatalogueFromFiles({...f.options,expectedCatalogueSha256:'0'.repeat(64)}),{message:'Legacy catalogue preflight refused.'});
});

test('a late source byte mismatch cannot return the already verified first record',async t=>{
 const f=fixture(t);writeFileSync(join(f.directory,f.data.entries[1].receiptFile),'CONFIDENTIAL_BROKEN_SECOND_SOURCE');await assert.rejects(legacyCatalogueFromFiles(f.options));
});

test('independent mapping and target expectations cannot be replaced by the catalogue pin',async t=>{
 const f=fixture(t);await assert.rejects(legacyCatalogueFromFiles({...f.options,expectedTarget:{organizationId:id(99),projectId:id(30)}}));const changed=structuredClone(f.data);changed.entries[1].mappingSha256='0'.repeat(64);await assert.rejects(legacyCatalogueFromFiles(f.save(changed)));
});

test('duplicate records are rejected by original tenant and receipt identity',async t=>{
 const f=fixture(t),first=f.data.entries[0],second=f.data.entries[1];writeFileSync(join(f.directory,second.receiptFile),readFileSync(join(f.directory,first.receiptFile)));writeFileSync(join(f.directory,second.mappingFile),readFileSync(join(f.directory,first.mappingFile)));second.mappingSha256=first.mappingSha256;await assert.rejects(legacyCatalogueFromFiles(f.save(f.data)));
});

test('equal receipt identifiers from separately verified source tenants are not conflated',async t=>{
 const f=fixture(t,[{receiptId:id(1)},{receiptId:id(1),organizationId:id(99)}]),report=await legacyCatalogueFromFiles(f.options);assert.equal(report.verifiedEntries,2);assert.deepEqual(report.records.map(x=>x.sourceCoordinates.organizationId),[id(2),id(99)]);
});

test('catalogue file names forbid traversal absolute names hidden files and portable device aliases',async t=>{
 const f=fixture(t);
 for(const field of ['receiptFile','trustedKeyFile','mappingFile'])for(const value of ['../outside.json','nested/receipt.json','nested\\receipt.json','C:receipt.json','/receipt.json','.env','NUL','con.txt','COM1.json','lpt9.pem','receipt.','récépissé.json']){const changed=structuredClone(f.data);changed.entries[1][field]=value;await assert.rejects(legacyCatalogueFromFiles(f.save(changed)),{message:'Legacy catalogue preflight refused.'});}
});

test('catalogue schema entry count and mandatory field sets are exact',async t=>{
 const f=fixture(t);
 for(const changed of [{...f.data,schemaVersion:2},{...f.data,kind:'import'},{...f.data,role:'admin'},{...f.data,entries:[]},{...f.data,entries:Array(21).fill(f.data.entries[0])},{...f.data,entries:[{...f.data.entries[0],actorId:id(7)}]},{...f.data,entries:[null]}])await assert.rejects(legacyCatalogueFromFiles(f.save(changed)));
 for(const expectedCatalogueSha256 of [undefined,'','A'.repeat(64)])await assert.rejects(legacyCatalogueFromFiles({...f.options,expectedCatalogueSha256}));
});

test('invalid UTF-8 and oversized catalogue files are refused without input rewriting',async t=>{
 const f=fixture(t);
 for(const bytes of [Buffer.from([255]),Buffer.alloc(legacyCatalogueByteLimit+1,32)]){writeFileSync(f.catalogueFile,bytes);await assert.rejects(legacyCatalogueFromFiles({...f.options,expectedCatalogueSha256:sha(bytes)}));assert.deepEqual(readFileSync(f.catalogueFile),bytes);}
});

test('the aggregate byte budget counts repeated key reads and cannot exceed the fixed ceiling',async t=>{
 const f=fixture(t),bytes=readFileSync(f.catalogueFile).length+f.data.entries.reduce((n,e)=>n+['receiptFile','trustedKeyFile','mappingFile'].reduce((a,k)=>a+readFileSync(join(f.directory,e[k])).length,0),0);const report=await legacyCatalogueFromFiles({...f.options,maximumInputBytes:bytes});assert.equal(report.inputBytesRead,bytes);await assert.rejects(legacyCatalogueFromFiles({...f.options,maximumInputBytes:bytes-1}));
 for(const value of [0,-1,1.5,null,'1024',NaN,Infinity,legacyCatalogueTotalByteLimit+1])assert.throws(()=>legacyCatalogueBudget(value));assert.equal(legacyCatalogueBudget(),legacyCatalogueTotalByteLimit);
});

test('catalogue argument parsing requires explicit target pin and a bounded optional decimal budget',t=>{
 const f=fixture(t),input=args(f.options);assert.equal(parseLegacyCatalogueArguments(input).maximumInputBytes,legacyCatalogueTotalByteLimit);assert.equal(parseLegacyCatalogueArguments([...input,'--max-input-bytes','8192']).maximumInputBytes,8192);
 for(const invalid of [input.slice(0,-2),[...input,'--catalogue-sha256','a'.repeat(64)],[...input,'--max-input-bytes','0'],[...input,'--max-input-bytes','1e6'],[...input,'--max-input-bytes','67108865'],[...input,'--unknown','x'],input.map(x=>x===input[0]?'bad\0file':x)])assert.throws(()=>parseLegacyCatalogueArguments(invalid));
});

test('referenced symbolic links are refused even when the source bytes and signatures match',{skip:process.platform==='win32'},async t=>{
 const f=fixture(t);symlinkSync(join(f.directory,f.data.entries[0].receiptFile),join(f.directory,'alias.json'));const changed=structuredClone(f.data);changed.entries[0].receiptFile='alias.json';await assert.rejects(legacyCatalogueFromFiles(f.save(changed)));
});

test('replacing the input directory after valid reads is refused even with identical copied files',t=>{
 const f=fixture(t),entry=new URL('../packages/stack-legacy-link/catalogue.js',import.meta.url).href;
 const script=String.raw`const fs=require('node:fs'),fsp=require('node:fs/promises'),assert=require('node:assert/strict');const options=JSON.parse(process.argv[1]),entry=process.argv[2],root=fs.realpathSync(require('node:path').dirname(options.catalogueFile)),original=fsp.lstat;let seen=0;fsp.lstat=async(file,...rest)=>{if(file===root&&++seen===2){fs.renameSync(root,root+'-moved');fs.cpSync(root+'-moved',root,{recursive:true});}return original(file,...rest);};require('node:module').syncBuiltinESMExports();(async()=>{const {legacyCatalogueFromFiles}=await import(entry);await assert.rejects(legacyCatalogueFromFiles(options),{message:'Legacy catalogue preflight refused.'});fs.writeSync(1,'directory-swap-refused\n');})().catch(()=>{process.exitCode=1;fs.writeSync(2,'directory-race-probe-failed\n');});`;
 const result=spawnSync(process.execPath,['--input-type=commonjs','-e',script,JSON.stringify(f.options),entry],{cwd:resolve('.'),encoding:'utf8',timeout:8000});assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/directory-swap-refused/);
});

test('actual catalogue CLI preserves every input and emits no partial metadata or private failures',t=>{
 const f=fixture(t),before=snapshot(f.directory),command=[resolve('scripts/stack-legacy-catalogue.mjs'),...args(f.options)];const success=spawnSync(process.execPath,command,{cwd:resolve('.'),encoding:'utf8',timeout:8000});assert.equal(success.status,0,success.stderr);assert.equal(JSON.parse(success.stdout).verifiedEntries,2);assert.deepEqual(snapshot(f.directory),before);assert.ok(!success.stdout.includes('CONFIDENTIAL_')&&!success.stdout.includes(pem));
 writeFileSync(join(f.directory,f.data.entries[1].receiptFile),'CONFIDENTIAL_CATALOGUE_BROKEN_CANARY');const failed=spawnSync(process.execPath,command,{cwd:resolve('.'),encoding:'utf8',timeout:8000});assert.equal(failed.status,2);assert.equal(failed.stdout,'');assert.ok(!failed.stderr.includes('CONFIDENTIAL_')&&!failed.stderr.includes(f.directory)&&!failed.stderr.includes(pem));
});
