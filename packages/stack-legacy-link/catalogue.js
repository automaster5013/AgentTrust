import {createHash} from 'node:crypto';
import {lstat,realpath} from 'node:fs/promises';
import {basename,dirname,join,resolve} from 'node:path';
import {readBoundedLegacyLinkFile} from './files.js';
import {inspectLegacyReceiptLink,legacyLinkTarget,legacyLinkMappingByteLimit} from './receipt.js';
import {receiptFileLimit} from '../receipts/limits.js';
import {trustedReceiptKey} from '../receipts/signature.js';
import {inspectHistoricalReceipt} from '../receipts/inspection.js';
export const legacyCatalogueByteLimit=65536;
export const legacyCatalogueEntryLimit=20;
export const legacyCatalogueTotalByteLimit=64*1024*1024;
const reject=()=>{throw Error('Legacy catalogue preflight refused.');};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const digest=/^[a-f0-9]{64}$/;
export function legacyCatalogueBudget(value=legacyCatalogueTotalByteLimit){if(!Number.isSafeInteger(value)||value<1||value>legacyCatalogueTotalByteLimit)reject();return value;}
function portableFile(value){
 if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)||value.endsWith('.')||/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(value.split('.')[0]))reject();return value;
}
/** Explicit byte correspondence only. The catalogue is not an import or an authorization. */
export async function legacyCatalogueFromFiles(options){
 if(!object(options)||Object.keys(options).some(k=>!['catalogueFile','expectedCatalogueSha256','expectedTarget','maximumInputBytes'].includes(k)))reject();
 const target=legacyLinkTarget(options.expectedTarget),maximumInputBytes=legacyCatalogueBudget(options.maximumInputBytes);
 if(typeof options.catalogueFile!=='string'||!options.catalogueFile||options.catalogueFile.includes('\0')||typeof options.expectedCatalogueSha256!=='string'||!digest.test(options.expectedCatalogueSha256))reject();
 const requested=resolve(options.catalogueFile),parent=dirname(requested),root=await realpath(parent),before=await lstat(root,{bigint:true});
 if(!before.isDirectory()||before.isSymbolicLink())reject();
 let used=0;
 async function read(path,limit){const remaining=maximumInputBytes-used;if(remaining<1)reject();const bytes=await readBoundedLegacyLinkFile(path,Math.min(limit,remaining));used+=bytes.byteLength;if(used>maximumInputBytes)reject();return bytes;}
 const raw=await read(join(root,basename(requested)),legacyCatalogueByteLimit);if(sha(raw)!==options.expectedCatalogueSha256)reject();
 const catalogue=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
 if(!object(catalogue)||Object.keys(catalogue).sort().join(',')!=='entries,kind,schemaVersion'||![1,2].includes(catalogue.schemaVersion)||catalogue.kind!=='legacy-receipt-link-catalogue'||!Array.isArray(catalogue.entries)||catalogue.entries.length<1||catalogue.entries.length>legacyCatalogueEntryLimit)reject();
 const withBodies=catalogue.schemaVersion===2;
 for(const entry of catalogue.entries){
  const fields=withBodies?'bodyFile,bodySha256,mappingFile,mappingSha256,receiptFile,trustedKeyFile':'mappingFile,mappingSha256,receiptFile,trustedKeyFile';
  if(!object(entry)||Object.keys(entry).sort().join(',')!==fields||typeof entry.mappingSha256!=='string'||!digest.test(entry.mappingSha256)||withBodies&&(typeof entry.bodySha256!=='string'||!digest.test(entry.bodySha256)))reject();
  for(const field of ['mappingFile','receiptFile','trustedKeyFile',...(withBodies?['bodyFile']:[])])portableFile(entry[field]);
 }
 const records=[],seen=new Set();
 for(const entry of catalogue.entries){
  const mappingBytes=await read(join(root,entry.mappingFile),legacyLinkMappingByteLimit);if(sha(mappingBytes)!==entry.mappingSha256)reject();
  const keyBytes=await read(join(root,entry.trustedKeyFile),1024),trustedPublicKey=new TextDecoder('utf-8',{fatal:true}).decode(keyBytes);trustedReceiptKey(trustedPublicKey);
  const receiptBytes=await read(join(root,entry.receiptFile),receiptFileLimit);
  const record=inspectLegacyReceiptLink({mappingBytes,trustedPublicKey,receiptBytes,expectedMappingSha256:entry.mappingSha256,expectedTarget:target});
  const mapping=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(mappingBytes)),identity=JSON.stringify([mapping.sourceOrganizationId,mapping.sourceProjectId,record.sourceReceiptId]);
  if(seen.has(identity))reject();
  const linked={...record,sourceCoordinates:{organizationId:mapping.sourceOrganizationId,projectId:mapping.sourceProjectId}};
  if(withBodies){
   const bodyBytes=await read(join(root,entry.bodyFile),receiptFileLimit);if(sha(bodyBytes)!==entry.bodySha256)reject();
   const bundle=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bodyBytes));
   if(!object(bundle)||!['bodies,kind,schemaVersion','bodies,kind,review,schemaVersion'].includes(Object.keys(bundle).sort().join(','))||bundle.schemaVersion!==1||bundle.kind!=='legacy-receipt-source-bodies')reject();
   const receipt=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(receiptBytes)),reviewExpected=receipt.artifact.result.manualApproval?.reviewHash!==undefined;
   if(reviewExpected&&!Object.hasOwn(bundle,'review'))reject();
   const proof=inspectHistoricalReceipt(receipt,trustedPublicKey,{organizationId:mapping.sourceOrganizationId,projectId:mapping.sourceProjectId},bundle.review,bundle.bodies,true);
   if(proof.evidenceBodiesVerified!==true||proof.evidenceStructuresVerified!==true||proof.agentReexecuted!==false||reviewExpected&&proof.reviewBodyVerified!==true)reject();
   Object.assign(linked,{sourceBodyBundleBytesSha256:sha(bodyBytes),evidenceBodiesVerified:true,candidateEvidenceVerified:proof.candidateEvidenceVerified,baselineEvidenceVerified:proof.baselineEvidenceVerified,evidenceStructuresVerified:true,candidateEvidenceStructureVerified:proof.candidateEvidenceStructureVerified,baselineEvidenceStructureVerified:proof.baselineEvidenceStructureVerified,evidenceMetadataAuthenticated:false,unsignedMetadataUsedForStructure:false,rulesRecheckedFromRecordedEvidence:true,agentReexecuted:false,reviewBodyExpected:reviewExpected,reviewBodyVerified:proof.reviewBodyVerified});
  }
  seen.add(identity);records.push(linked);
 }
 const after=await lstat(root,{bigint:true});if(!after.isDirectory()||after.isSymbolicLink()||before.dev!==after.dev||before.ino!==after.ino||await realpath(parent)!==root)reject();
 return {schemaVersion:catalogue.schemaVersion,purpose:'legacy-receipt-link-catalogue-preflight',...(withBodies?{bodyEvidenceMode:'linked-source-bodies',bodyEvidenceEntriesVerified:records.length}:{}),catalogueBytesSha256:sha(raw),catalogueDigestMatched:true,targetCoordinates:target,verifiedEntries:records.length,inputBytesRead:used,maximumInputBytes,records,historicalEvidenceOnly:true,catalogueCryptographicallySigned:false,catalogueOperatorApprovalVerified:false,sourceCurrentTrustPolicyVerified:false,targetTenantAuthorityVerified:false,actorMappingPerformed:false,sourceRecordRewritten:false,targetRecordImported:false,currentReviewerAuthorityVerified:false,currentReleasePermissionVerified:false,deploymentAllowed:false};
}
