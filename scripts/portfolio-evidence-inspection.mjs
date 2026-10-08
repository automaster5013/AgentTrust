import {loadPortfolioEvidence} from './portfolio-evidence.mjs';
import {inspectHistoricalReceipt,normalizeReceiptExpectation} from '../packages/receipts/inspection.js';

export function normalizePortfolioExpectation(expected){
 if(expected!==undefined&&(!expected||Object.keys(expected).some(key=>!['organizationId','projectId'].includes(key))))throw Error('Invalid bundle scope.');
 return normalizeReceiptExpectation(expected);
}

export async function inspectPortfolioEvidence(directory,trustedPem,expectedManifestSha256,expectation){
 const expected=normalizePortfolioExpectation(expectation);
 const loaded=await loadPortfolioEvidence(directory,trustedPem,expectedManifestSha256);
 const reviews=new Map(loaded.reviews.map(review=>[review.id,review]));
 const records=loaded.receipts.map((receipt,index)=>({step:loaded.manifest.receipts[index].step,...inspectHistoricalReceipt(receipt,trustedPem,expected,reviews.get(receipt.artifact.result.manualApproval?.reviewId))}));
 return {schemaVersion:1,purpose:'historical-portfolio-evidence-inspection',...loaded.verification,
  semanticStructuresVerified:records.length,expectedScopeVerified:expected!==undefined,
  manifestCryptographicallySigned:false,evidenceBodiesVerified:false,currentReviewerAuthorityVerified:false,
  currentReleasePermissionVerified:false,deploymentAllowed:false,records};
}
