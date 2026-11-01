import {createHash} from 'node:crypto';
import {lstat,realpath} from 'node:fs/promises';
import {basename,dirname,join,resolve} from 'node:path';
import {readBoundedLegacyLinkFile} from './files.js';
import {inspectLegacyReceiptLink,legacyLinkTarget,legacyLinkMappingByteLimit} from './receipt.js';
import {receiptFileLimit} from '../receipts/limits.js';
import {trustedReceiptKey} from '../receipts/signature.js';
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
 if(!object(catalogue)||Object.keys(catalogue).sort().join(',')!=='entries,kind,schemaVersion'||catalogue.schemaVersion!==1||catalogue.kind!=='legacy-receipt-link-catalogue'||!Array.isArray(catalogue.entries)||catalogue.entries.length<1||catalogue.entries.length>legacyCatalogueEntryLimit)reject();
 for(const entry of catalogue.entries){
  if(!object(entry)||Object.keys(entry).sort().join(',')!=='mappingFile,mappingSha256,receiptFile,trustedKeyFile'||typeof entry.mappingSha256!=='string'||!digest.test(entry.mappingSha256))reject();
  for(const field of ['mappingFile','receiptFile','trustedKeyFile'])portableFile(entry[field]);
 }
 const records=[],seen=new Set();
 for(const entry of catalogue.entries){
  const mappingBytes=await read(join(root,entry.mappingFile),legacyLinkMappingByteLimit);if(sha(mappingBytes)!==entry.mappingSha256)reject();
  const keyBytes=await read(join(root,entry.trustedKeyFile),1024),trustedPublicKey=new TextDecoder('utf-8',{fatal:true}).decode(keyBytes);trustedReceiptKey(trustedPublicKey);
  const receiptBytes=await read(join(root,entry.receiptFile),receiptFileLimit);
  const record=inspectLegacyReceiptLink({mappingBytes,trustedPublicKey,receiptBytes,expectedMappingSha256:entry.mappingSha256,expectedTarget:target});
  const mapping=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(mappingBytes)),identity=JSON.stringify([mapping.sourceOrganizationId,mapping.sourceProjectId,record.sourceReceiptId]);
  if(seen.has(identity))reject();seen.add(identity);records.push({...record,sourceCoordinates:{organizationId:mapping.sourceOrganizationId,projectId:mapping.sourceProjectId}});
 }
 const after=await lstat(root,{bigint:true});if(!after.isDirectory()||after.isSymbolicLink()||before.dev!==after.dev||before.ino!==after.ino||await realpath(parent)!==root)reject();
 return {schemaVersion:1,purpose:'legacy-receipt-link-catalogue-preflight',catalogueBytesSha256:sha(raw),catalogueDigestMatched:true,targetCoordinates:target,verifiedEntries:records.length,inputBytesRead:used,maximumInputBytes,records,historicalEvidenceOnly:true,catalogueCryptographicallySigned:false,catalogueOperatorApprovalVerified:false,sourceCurrentTrustPolicyVerified:false,targetTenantAuthorityVerified:false,actorMappingPerformed:false,sourceRecordRewritten:false,targetRecordImported:false,currentReviewerAuthorityVerified:false,currentReleasePermissionVerified:false,deploymentAllowed:false};
}
