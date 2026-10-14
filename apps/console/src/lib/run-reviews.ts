import type {Identity} from './contracts.ts';
import {campaignReviews,reviewCursor,type CampaignReviewPage} from './campaign-reviews.ts';
export function runReviewPage(value:unknown,user:Identity,runId:string,requestedCursor:string|null=null):CampaignReviewPage{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('INVALID_RUN_REVIEW_PAGE');const page=value as Record<string,unknown>;
 if(Object.keys(page).sort().join(',')!=='deploymentAuthority,entries,limit,nextCursor,ordering,organizationId,projectId,runId'||page.runId!==runId||page.ordering!=='review-sequence-desc')throw Error('INVALID_RUN_REVIEW_PAGE');
 const {runId:recordedRun,nextCursor,ordering,...frame}=page;
 const entries=campaignReviews({...frame,campaignId:recordedRun},user,runId),boundary=requestedCursor===null?null:reviewCursor(requestedCursor,user,runId,'RRV');
 if(boundary!==null&&entries.some(row=>row.sequence>=boundary))throw Error('INVALID_RUN_REVIEW_BOUNDARY');
 if(nextCursor!==null&&(typeof nextCursor!=='string'||entries.length!==50||reviewCursor(nextCursor,user,runId,'RRV')!==entries.at(-1)!.sequence))throw Error('INVALID_RUN_REVIEW_CURSOR');
 return {entries,nextCursor:nextCursor as string|null};
}
