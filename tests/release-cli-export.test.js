import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {generateKeyPairSync} from 'node:crypto';
import {hash} from '../packages/contracts/hash.js';
import {ReceiptSigner,verifyReceipt} from '../packages/receipts/signature.js';
import {saveReleaseReceipt} from '../scripts/release-gate.mjs';
async function workspace(work){const dir=await mkdtemp(join(process.cwd(),'.local','receipt-export-'));try{await work(dir);}finally{await rm(dir,{recursive:true,force:true});}}
function signed(allowed){const pair=generateKeyPairSync('ed25519'),signer=new ReceiptSigner(pair.privateKey.export({type:'pkcs8',format:'pem'})),artifact={receiptId:'synthetic',result:{decision:allowed?'pass':'block',deploymentAllowed:allowed},request:{candidateRunId:'synthetic'}};return {report:{artifact,artifactHash:hash(artifact),signature:signer.sign(artifact),accessKey:'must-not-export'},key:signer.publicMetadata().publicKey};}
test('CI receipt export preserves signed pass and block evidence without response extras',async()=>workspace(async dir=>{
 for(const allowed of [true,false]){const {report,key}=signed(allowed),path=join(dir,String(allowed)+'.json');await saveReleaseReceipt(path,report);const text=await readFile(path,'utf8'),receipt=JSON.parse(text);assert.deepEqual(receipt,{artifact:report.artifact,artifactHash:report.artifactHash,signature:report.signature});assert.ok(!text.includes('must-not-export'));assert.equal(verifyReceipt(receipt,key).signatureVerified,true);assert.equal(receipt.artifact.result.deploymentAllowed,allowed);}
}));
test('CI receipt export never overwrites an existing artifact',async()=>workspace(async dir=>{
 const path=join(dir,'existing.json');await writeFile(path,'previous artifact');await assert.rejects(saveReleaseReceipt(path,signed(true).report),{code:'EEXIST'});assert.equal(await readFile(path,'utf8'),'previous artifact');
}));
test('invalid and unavailable exports fail without creating an artifact',async()=>workspace(async dir=>{
 const path=join(dir,'invalid.json'),report=signed(true).report;await assert.rejects(saveReleaseReceipt(path,{...report,artifactHash:'bad'}),/Invalid/);await assert.rejects(readFile(path),{code:'ENOENT'});await assert.rejects(saveReleaseReceipt('',report),/Invalid/);await assert.rejects(saveReleaseReceipt(join(dir,'missing','receipt.json'),report),{code:'ENOENT'});
}));
