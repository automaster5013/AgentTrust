import {createHash} from 'node:crypto';
import {inspectHistoricalReceipt} from '../receipts/inspection.js';
import {receiptFileLimit} from '../receipts/limits.js';
export const legacyLinkMappingByteLimit=8192;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const digest=/^[a-f0-9]{64}$/;
const fields=['schemaVersion','sourcePlatform','targetPlatform','sourceOrganizationId','sourceProjectId','targetOrganizationId','targetProjectId','sourceReceiptId','sourceArtifactHash','sourceReceiptBytesSha256','sourceSigningKeyId'].sort().join(',');
const reject=()=>{throw Error('Legacy receipt link preflight refused.');};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
function bytes(value,maximum){if(!(value instanceof Uint8Array)||!value.byteLength||value.byteLength>maximum)reject();return value;}
export function legacyLinkTarget(value){
 if(!object(value)||Object.keys(value).sort().join(',')!=='organizationId,projectId'||typeof value.organizationId!=='string'||typeof value.projectId!=='string'||!uuid.test(value.organizationId)||!uuid.test(value.projectId))reject();
 return {organizationId:value.organizationId,projectId:value.projectId};
}
/** An offline correspondence check, never a new receipt, actor mapping or authorization. */
export function inspectLegacyReceiptLink({receiptBytes,mappingBytes,trustedPublicKey,expectedMappingSha256,expectedTarget}){
 const target=legacyLinkTarget(expectedTarget);
 if(typeof expectedMappingSha256!=='string'||!digest.test(expectedMappingSha256))reject();
 const mappingRaw=bytes(mappingBytes,legacyLinkMappingByteLimit),mappingHash=sha256(mappingRaw);
 if(mappingHash!==expectedMappingSha256)reject();
 const mapping=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(mappingRaw));
 if(!object(mapping)||Object.keys(mapping).sort().join(',')!==fields||mapping.schemaVersion!==1||mapping.sourcePlatform!=='agenttrust-4310'||mapping.targetPlatform!=='agenttrust-4320')reject();
 for(const name of ['sourceOrganizationId','sourceProjectId','targetOrganizationId','targetProjectId','sourceReceiptId'])if(typeof mapping[name]!=='string'||!uuid.test(mapping[name]))reject();
 for(const name of ['sourceArtifactHash','sourceReceiptBytesSha256','sourceSigningKeyId'])if(typeof mapping[name]!=='string'||!digest.test(mapping[name]))reject();
 if(mapping.targetOrganizationId!==target.organizationId||mapping.targetProjectId!==target.projectId)reject();
 const receiptRaw=bytes(receiptBytes,receiptFileLimit),receiptHash=sha256(receiptRaw);
 if(receiptHash!==mapping.sourceReceiptBytesSha256)reject();
 const receipt=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(receiptRaw));
 const verified=inspectHistoricalReceipt(receipt,trustedPublicKey,{organizationId:mapping.sourceOrganizationId,projectId:mapping.sourceProjectId});
 if(verified.receiptId.toLowerCase()!==mapping.sourceReceiptId||verified.artifactHash!==mapping.sourceArtifactHash||verified.keyId!==mapping.sourceSigningKeyId)reject();
 return {schemaVersion:1,purpose:'legacy-receipt-link-preflight',sourcePlatform:'agenttrust-4310',targetPlatform:'agenttrust-4320',
  sourceReceiptId:mapping.sourceReceiptId,sourceArtifactHash:verified.artifactHash,sourceReceiptBytesSha256:receiptHash,sourceSigningKeyId:verified.keyId,mappingBytesSha256:mappingHash,
  sourceSignatureVerified:true,sourceStructureVerified:true,sourceTenantCoordinatesMatched:true,targetCoordinatesMatched:true,mappingDigestMatched:true,
  historicalDecision:verified.historicalDecision,historicalEvidenceOnly:true,evidenceBodiesVerified:false,reviewBodyVerified:false,
  mappingCryptographicallySigned:false,mappingOperatorApprovalVerified:false,sourceCurrentTrustPolicyVerified:false,targetTenantAuthorityVerified:false,actorMappingPerformed:false,
  sourceRecordRewritten:false,targetRecordImported:false,currentReviewerAuthorityVerified:false,currentReleasePermissionVerified:false,deploymentAllowed:false};
}
