import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,realpathSync,rmSync,symlinkSync} from 'node:fs';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {spawnSync} from 'node:child_process';
import {ReceiptSigner} from '../packages/receipts/signature.js';
import {hash} from '../packages/contracts/hash.js';
import {inspectLegacyReceiptLink,legacyLinkMappingByteLimit} from '../packages/stack-legacy-link/receipt.js';
import {parseLegacyLinkArguments,readBoundedLegacyLinkFile} from '../scripts/stack-legacy-receipt-link.mjs';
const id=n=>'abcdef00-0000-4000-8000-'+String(n).padStart(12,'0');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const pair=generateKeyPairSync('ed25519'),publicPem=pair.publicKey.export({type:'spki',format:'pem'}),privatePem=pair.privateKey.export({type:'pkcs8',format:'pem'}),signer=new ReceiptSigner(privatePem);
function fixture(blocked=false){
 const artifact={schemaVersion:1,receiptId:id(1),organizationId:id(2),projectId:id(3),checkedAt:'2026-10-08T00:00:00.000Z',request:{candidateRunId:id(4)},result:{runId:id(4),decision:blocked?'block':'pass',deploymentAllowed:!blocked,reasons:blocked?['CONFIDENTIAL_LINK_REASON_CANARY']:[]},evidence:{candidate:{runId:id(4),snapshotHash:'a'.repeat(64),resultHash:'b'.repeat(64)}}};
 const receipt={artifact,artifactHash:hash(artifact),signature:signer.sign(artifact)},receiptBytes=Buffer.from(JSON.stringify(receipt,null,2)+'\n');
 const mapping={schemaVersion:1,sourcePlatform:'agenttrust-4310',targetPlatform:'agenttrust-4320',sourceOrganizationId:id(2),sourceProjectId:id(3),targetOrganizationId:id(20),targetProjectId:id(30),sourceReceiptId:id(1),sourceArtifactHash:receipt.artifactHash,sourceReceiptBytesSha256:sha(receiptBytes),sourceSigningKeyId:signer.keyId};
 const mappingBytes=Buffer.from(JSON.stringify(mapping)+'\n'),expectedTarget={organizationId:id(20),projectId:id(30)};
 return {receipt,mapping,receiptBytes,mappingBytes,expectedTarget,expectedMappingSha256:sha(mappingBytes),trustedPublicKey:publicPem};
}
function changedMapping(base,changes){const mappingBytes=Buffer.from(JSON.stringify({...base.mapping,...changes}));return {...base,mappingBytes,expectedMappingSha256:sha(mappingBytes)};}
function scratch(t){const base=resolve('.local');mkdirSync(base,{recursive:true});const directory=mkdtempSync(join(base,'stack-legacy-link-unit-'));t.after(()=>{const child=realpathSync(directory),root=realpathSync(base),suffix=relative(root,child);assert.ok(!isAbsolute(suffix)&&!suffix.startsWith('..')&&suffix.startsWith('stack-legacy-link-unit-'));rmSync(directory,{recursive:true,force:true});});return directory;}

test('legacy signature and raw bytes are preserved while target coordinates never grant current authority',()=>{
 const value=fixture(),before=Buffer.from(value.receiptBytes),summary=inspectLegacyReceiptLink(value);
 assert.equal(summary.sourceSignatureVerified,true);assert.equal(summary.mappingDigestMatched,true);assert.equal(summary.historicalDecision,'pass');assert.equal(summary.sourceReceiptBytesSha256,sha(before));assert.deepEqual(value.receiptBytes,before);
 for(const key of ['targetRecordImported','sourceRecordRewritten','actorMappingPerformed','mappingCryptographicallySigned','mappingOperatorApprovalVerified','sourceCurrentTrustPolicyVerified','targetTenantAuthorityVerified','currentReviewerAuthorityVerified','currentReleasePermissionVerified','deploymentAllowed','evidenceBodiesVerified','reviewBodyVerified'])assert.equal(summary[key],false);
 assert.equal(summary.sourceTenantCoordinatesMatched,true);assert.equal(summary.targetCoordinatesMatched,true);
});

test('historical block remains blocked and confidential original reasons are not printed',()=>{
 const summary=inspectLegacyReceiptLink(fixture(true));assert.equal(summary.historicalDecision,'block');assert.equal(summary.deploymentAllowed,false);assert.ok(!JSON.stringify(summary).includes('CONFIDENTIAL_LINK_REASON_CANARY'));
});

test('changing raw receipt serialization or mapping bytes cannot reuse independent byte expectations',()=>{
 const value=fixture();assert.throws(()=>inspectLegacyReceiptLink({...value,receiptBytes:Buffer.from(JSON.stringify(value.receipt))}));
 assert.throws(()=>inspectLegacyReceiptLink({...value,mappingBytes:Buffer.from(JSON.stringify(value.mapping,null,2))}));
});

test('recomputed unsigned hashes cannot replace a valid signature or disguise signed contradictions',()=>{
 const value=fixture();value.receipt.artifact.result.reasons=['CONFIDENTIAL_FORGERY_CANARY'];value.receipt.artifactHash=hash(value.receipt.artifact);const receiptBytes=Buffer.from(JSON.stringify(value.receipt));
 const forged=changedMapping({...value,receiptBytes},{sourceArtifactHash:value.receipt.artifactHash,sourceReceiptBytesSha256:sha(receiptBytes)});assert.throws(()=>inspectLegacyReceiptLink(forged));
 value.receipt.signature=signer.sign(value.receipt.artifact);assert.throws(()=>inspectLegacyReceiptLink(forged));
});

test('source identity key tenant and artifact mismatches refuse even rehashed descriptors',()=>{
 const value=fixture();
 for(const change of [{sourceOrganizationId:id(9)},{sourceProjectId:id(9)},{sourceReceiptId:id(9)},{sourceArtifactHash:'c'.repeat(64)},{sourceReceiptBytesSha256:'c'.repeat(64)},{sourceSigningKeyId:'c'.repeat(64)}])assert.throws(()=>inspectLegacyReceiptLink(changedMapping(value,change)));
 assert.throws(()=>inspectLegacyReceiptLink({...value,trustedPublicKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'})}));assert.throws(()=>inspectLegacyReceiptLink({...value,trustedPublicKey:privatePem}));
});

test('target expectation is independent and arbitrary actor role key or authority imports are forbidden',()=>{
 const value=fixture();for(const change of [{targetOrganizationId:id(99)},{targetProjectId:id(99)},{schemaVersion:2},{sourcePlatform:'agenttrust-4320'},{targetPlatform:'agenttrust-4310'},{actorMappings:[]},{deploymentAllowed:true},{privateKey:'CONFIDENTIAL_KEY_CANARY'}])assert.throws(()=>inspectLegacyReceiptLink(changedMapping(value,change)));
 for(const expectedTarget of [undefined,{}, {organizationId:id(20)}, {organizationId:[id(20)],projectId:id(30)},{organizationId:id(20).toUpperCase(),projectId:id(30)}, {...value.expectedTarget,role:'admin'}])assert.throws(()=>inspectLegacyReceiptLink({...value,expectedTarget}));
 for(const expectedMappingSha256 of [undefined,'','A'.repeat(64),'0'.repeat(64)])assert.throws(()=>inspectLegacyReceiptLink({...value,expectedMappingSha256}));
});

test('bounded strict UTF-8 files and mandatory fields refuse malformed or excessive inputs',()=>{
 const value=fixture();for(const receiptBytes of [Buffer.alloc(0),Buffer.alloc(16*1024*1024+1)])assert.throws(()=>inspectLegacyReceiptLink({...value,receiptBytes}));
 for(const mappingBytes of [Buffer.alloc(0),Buffer.alloc(legacyLinkMappingByteLimit+1),Buffer.from([255])])assert.throws(()=>inspectLegacyReceiptLink({...value,mappingBytes,expectedMappingSha256:sha(mappingBytes)}));
 const unicode=fixture(true);unicode.receipt.artifact.result.reasons=['\ufffd'];unicode.receipt.artifactHash=hash(unicode.receipt.artifact);unicode.receipt.signature=signer.sign(unicode.receipt.artifact);
 const valid=Buffer.from(JSON.stringify(unicode.receipt)),offset=valid.indexOf(Buffer.from('\ufffd'));assert.ok(offset>=0);
 const invalidUtf8=Buffer.concat([valid.subarray(0,offset),Buffer.from([255]),valid.subarray(offset+3)]);
 assert.throws(()=>inspectLegacyReceiptLink(changedMapping({...unicode,receiptBytes:invalidUtf8},{sourceArtifactHash:unicode.receipt.artifactHash,sourceReceiptBytesSha256:sha(invalidUtf8)})));
 const mapping={...value.mapping};delete mapping.sourceReceiptId;const mappingBytes=Buffer.from(JSON.stringify(mapping));assert.throws(()=>inspectLegacyReceiptLink({...value,mappingBytes,expectedMappingSha256:sha(mappingBytes)}));
});

test('CLI requires exact target and independently conveyed mapping digest without fallback or duplicate options',()=>{
 const value=fixture(),args=['receipt.json','trusted-public.pem','mapping.json','--target-organization-id',id(20),'--target-project-id',id(30),'--mapping-sha256',value.expectedMappingSha256];assert.deepEqual(parseLegacyLinkArguments(args).expectedTarget,value.expectedTarget);
 for(const invalid of [args.slice(0,-2),[...args,'--mapping-sha256',value.expectedMappingSha256],args.map(x=>x==='--target-project-id'?'--organization-id':x),args.map(x=>x==='--target-project-id'?'--target-organization-id':x)])assert.throws(()=>parseLegacyLinkArguments(invalid));
});

test('bounded reader refuses directories empty oversized and symlink inputs',async t=>{
 const directory=scratch(t),path=join(directory,'bounded.json');writeFileSync(path,'123456789');await assert.rejects(readBoundedLegacyLinkFile(path,8));await assert.rejects(readBoundedLegacyLinkFile(directory,1024));writeFileSync(path,'');await assert.rejects(readBoundedLegacyLinkFile(path,8));writeFileSync(path,'ok');assert.equal((await readBoundedLegacyLinkFile(path,2)).toString(),'ok');
 if(process.platform!=='win32'){const link=join(directory,'alias');symlinkSync(path,link);await assert.rejects(readBoundedLegacyLinkFile(link,8));}
});

test('actual CLI emits safe metadata and preserves all three input files; failures emit no private values',t=>{
 const directory=scratch(t),value=fixture(true),receipt=join(directory,'receipt.json'),key=join(directory,'trusted.pem'),mapping=join(directory,'mapping.json');writeFileSync(receipt,value.receiptBytes);writeFileSync(key,publicPem);writeFileSync(mapping,value.mappingBytes);
 const args=[resolve('scripts/stack-legacy-receipt-link.mjs'),receipt,key,mapping,'--target-organization-id',id(20),'--target-project-id',id(30),'--mapping-sha256',value.expectedMappingSha256];
 const success=spawnSync(process.execPath,args,{cwd:resolve('.'),encoding:'utf8',timeout:8000});assert.equal(success.status,0,success.stderr);const summary=JSON.parse(success.stdout);assert.equal(summary.sourceSignatureVerified,true);assert.equal(summary.targetRecordImported,false);assert.equal(summary.deploymentAllowed,false);assert.ok(!success.stdout.includes('CONFIDENTIAL_LINK_REASON_CANARY'));assert.deepEqual(readFileSync(receipt),value.receiptBytes);assert.deepEqual(readFileSync(mapping),value.mappingBytes);assert.equal(readFileSync(key,'utf8'),publicPem);
 writeFileSync(receipt,'CONFIDENTIAL_INVALID_RECEIPT_CANARY');const failed=spawnSync(process.execPath,args,{cwd:resolve('.'),encoding:'utf8',timeout:8000});assert.equal(failed.status,2);assert.equal(failed.stdout,'');assert.ok(!failed.stderr.includes('CONFIDENTIAL_'));assert.ok(!failed.stderr.includes(directory));assert.ok(!failed.stderr.includes(publicPem));
});


test('regular-to-FIFO replacement cannot hang the bounded reader after its initial lstat',{skip:process.platform!=='linux',timeout:20000},t=>{
 const directory=scratch(t),path=join(directory,'raced-input.json'),entry=new URL('../scripts/stack-legacy-receipt-link.mjs',import.meta.url).href;
 // Patch only this disposable child's lstat: return a real regular-file stat, then
 // replace that owned fixture with a real FIFO before the production open call.
 const script=String.raw`
 const fs=require('node:fs'),fsp=require('node:fs/promises'),assert=require('node:assert/strict');
 const [path,mode,entry]=process.argv.slice(1),originalStat=fsp.lstat,originalOpen=fsp.open;
 fsp.lstat=async file=>{const stat=await originalStat(file);if(file===path){fs.unlinkSync(path);require('node:child_process').execFileSync('mkfifo',['--',path]);fs.writeSync(1,'fifo-swapped\n');}return stat;};
 if(mode==='blocking-control')fsp.open=(file,flags,...rest)=>originalOpen(file,flags&~fs.constants.O_NONBLOCK,...rest);
 require('node:module').syncBuiltinESMExports();
 (async()=>{const {readBoundedLegacyLinkFile}=await import(entry);await assert.rejects(readBoundedLegacyLinkFile(path,128),/File identity changed/);fs.writeSync(1,'fifo-refused\n');})().catch(()=>{fs.writeSync(2,'race-probe-failed\n');process.exitCode=1;});
 `;
 function probe(mode,timeout){rmSync(path,{force:true});writeFileSync(path,'owned synthetic input');return spawnSync(process.execPath,['--input-type=commonjs','-e',script,path,mode,entry],{cwd:resolve('.'),encoding:'utf8',timeout});}
 const blocking=probe('blocking-control',5000);assert.equal(blocking.error?.code,'ETIMEDOUT');assert.match(blocking.stdout,/fifo-swapped/);
 const protectedRead=probe('protected-reader',8000);assert.equal(protectedRead.status,0,protectedRead.stderr);assert.match(protectedRead.stdout,/fifo-swapped/);assert.match(protectedRead.stdout,/fifo-refused/);
});
