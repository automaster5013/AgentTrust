import type {Identity} from './contracts.ts';
import type {ReceiptHistoryEntry} from './receipt-history.ts';
import {receiptTrustPath} from './receipt-contracts.ts';
import {verifiedObservationBundle} from './observation-bundles.ts';
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw Error('INVALID_SELECTED_OBSERVATION');return value as Record<string,unknown>}
function selected(row:ReceiptHistoryEntry){const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;if(!uuid.test(row.id)||!uuid.test(row.campaignId)||!/^[a-f0-9]{64}$/.test(row.keyId)||typeof row.createdAt!=='string'||row.createdAt.length>40||!Number.isFinite(Date.parse(row.createdAt)))throw Error('INVALID_SELECTED_OBSERVATION')}
/** The listed creation time is unsigned metadata, distinct from the signed issuedAt. */
export function selectedObservationTrustPath(value:unknown,row:ReceiptHistoryEntry):string{
 selected(row);const bundle=object(value),frame=object(bundle.receipt),campaign=object(bundle.campaign);
 if(campaign.id!==row.campaignId||frame.campaignId!==row.campaignId||frame.receiptId!==row.id||frame.keyId!==row.keyId||bundle.currentDeploymentAuthority!==false)throw Error('CHANGED_SELECTED_OBSERVATION');return receiptTrustPath(frame);
}
export async function verifiedSelectedObservation(value:unknown,trust:unknown,user:Identity,row:ReceiptHistoryEntry){
 selectedObservationTrustPath(value,row);const proof=await verifiedObservationBundle(value,trust,user,row.campaignId,row.id);if(proof.receipt.keyId!==row.keyId)throw Error('CHANGED_SELECTED_OBSERVATION');
 return {receiptId:row.id,campaignId:row.campaignId,keyId:row.keyId,listedAt:row.createdAt,issuedAt:proof.receipt.issuedAt,note:proof.receipt.note,observedDecision:proof.receipt.observedGate.decision,historicalGateAllowed:proof.receipt.observedGate.deploymentAllowed,historicalGateReason:proof.receipt.observedGate.reason,parentSha256:proof.parent.contentSha256,childArchives:proof.childArchives,baselineBytesVerified:proof.baselineBytesVerified,currentDeploymentAuthority:false as const};
}
