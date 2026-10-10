import {verifiedCampaign,verifiedCampaignArchive} from './campaign-contracts.ts';
import {verifiedReceipt} from './receipt-contracts.ts';
import {detail,archivedEvidence,type Identity} from './contracts.ts';
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw Error('INVALID_OBSERVATION_BUNDLE');return value as Record<string,unknown>}
export async function verifiedObservationBundle(value:unknown,trust:unknown,user:Identity,campaignId:string,receiptId:string){
 const bundle=object(value);if(Object.keys(bundle).length!==7||bundle.schemaVersion!==1||bundle.kind!=='campaign-observation-bundle'||bundle.currentDeploymentAuthority!==false||new TextEncoder().encode(JSON.stringify(value)).length>524288)throw Error('INVALID_OBSERVATION_BUNDLE');
 const record=await verifiedCampaign(bundle.campaign,user,campaignId),parent=await verifiedCampaignArchive(bundle.parent,user,record),receipt=await verifiedReceipt(bundle.receipt,trust,user,record,parent);if(receipt.receiptId!==receiptId||!Array.isArray(bundle.children)||bundle.children.length!==record.cases.length)throw Error('INVALID_OBSERVATION_BUNDLE');
 await Promise.all(bundle.children.map(async(value,i)=>{const item=object(value),c=record.cases[i],reference=parent.childArchives[i];if(Object.keys(item).length!==2)throw Error('INVALID_OBSERVATION_BUNDLE');const run=detail(item.run,user,c.runId);if(run.state!==c.state||run.decision!==c.decision||run.scenario!==c.scenario||run.provider!==c.provider)throw Error('INVALID_CASE_BINDING');const proof=await archivedEvidence(item.archive,user,run);if(proof.contentSha256!==reference.contentSha256||proof.contentBytes!==reference.contentBytes||proof.storageVersion!==reference.storageVersion)throw Error('INVALID_OBSERVATION_BUNDLE')}));
 return {record,parent,receipt,childArchives:record.cases.length,childBytesVerified:true,currentDeploymentAuthority:false};
}
