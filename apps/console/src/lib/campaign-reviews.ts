import type {Identity} from './contracts.ts';
export type CampaignReview={id:string;decision:'approved'|'rejected';reason:string;actorId:string;sequence:number;policyVersion:string;policyDigest:string;createdAt:string};
function object(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error('INVALID_REVIEW_HISTORY');return v as Record<string,unknown>}
function uuid(v:unknown):string{if(typeof v!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v))throw Error('INVALID_REVIEW_HISTORY');return v}
function timestamp(v:unknown):string{
 if(typeof v!=='string')throw Error('INVALID_REVIEW_HISTORY');const match=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(?:Z|\+00:00)$/.exec(v);if(!match)throw Error('INVALID_REVIEW_HISTORY');
 const millis=Date.parse(match[1]+'Z');if(!Number.isFinite(millis)||new Date(millis).toISOString()!==match[1]+'.000Z')throw Error('INVALID_REVIEW_HISTORY');return v;
}
export function campaignReviews(value:unknown,user:Identity,campaignId:string):CampaignReview[]{
 const frame=object(value);uuid(campaignId);
 if(Object.keys(frame).length!==6||frame.campaignId!==campaignId||frame.organizationId!==user.organizationId||frame.projectId!==user.projectId||frame.limit!==50||frame.deploymentAuthority!==false||!Array.isArray(frame.entries)||frame.entries.length>50)throw Error('INVALID_REVIEW_HISTORY');
 const ids=new Set<string>();let previous=Number.MAX_SAFE_INTEGER;
 return frame.entries.map(raw=>{const r=object(raw),id=uuid(r.id),actorId=uuid(r.actor_id);
  if(Object.keys(r).length!==8||ids.has(id)||!Number.isSafeInteger(r.review_sequence)||(r.review_sequence as number)<1||(r.review_sequence as number)>=previous||typeof r.decision!=='string'||!['approved','rejected'].includes(r.decision)||typeof r.reason!=='string'||r.reason.length>500||typeof r.policy_version!=='string'||!/^\d+\.\d+\.\d+$/.test(r.policy_version)||typeof r.policy_digest!=='string'||!/^sha256:[a-f0-9]{64}$/.test(r.policy_digest)||typeof r.created_at!=='string'||r.created_at.length>50||!Number.isFinite(Date.parse(r.created_at)))throw Error('INVALID_REVIEW_HISTORY');
  ids.add(id);previous=r.review_sequence as number;return {id,actorId,sequence:previous,decision:r.decision as 'approved'|'rejected',reason:r.reason,policyVersion:r.policy_version,policyDigest:r.policy_digest,createdAt:timestamp(r.created_at)};
 });
}

export type CampaignReviewPage={entries:CampaignReview[];nextCursor:string|null};
export function reviewCursor(token:string,user:Identity,campaignId:string,domain:'CRV'|'RRV'='CRV'):number{
 if(!/^[A-Za-z0-9_-]{79}$/.test(token))throw Error('INVALID_REVIEW_CURSOR');
 const raw=atob(token.replaceAll('-','+').replaceAll('_','/')),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
 if(bytes.length!==59||btoa(raw).replaceAll('+','-').replaceAll('/','_').replaceAll('=','')!==token||String.fromCharCode(...bytes.slice(0,3))!==domain)throw Error('INVALID_REVIEW_CURSOR');
 const uuidAt=(offset:number)=>{const hex=Array.from(bytes.slice(offset,offset+16),b=>b.toString(16).padStart(2,'0')).join('');return hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20)};
 const sequence=new DataView(bytes.buffer).getBigInt64(51);
 if(uuidAt(3)!==user.organizationId||uuidAt(19)!==user.projectId||uuidAt(35)!==campaignId||sequence<1n||sequence>BigInt(Number.MAX_SAFE_INTEGER))throw Error('INVALID_REVIEW_CURSOR');return Number(sequence);
}
export function campaignReviewPage(value:unknown,user:Identity,campaignId:string,requestedCursor:string|null=null):CampaignReviewPage{
 const page=object(value);
 if(Object.keys(page).sort().join(',')!=='campaignId,deploymentAuthority,entries,limit,nextCursor,ordering,organizationId,projectId'||page.ordering!=='review-sequence-desc')throw Error('INVALID_REVIEW_PAGE');
 const {nextCursor,ordering,...frame}=page;
 const entries=campaignReviews(frame,user,campaignId),boundary=requestedCursor===null?null:reviewCursor(requestedCursor,user,campaignId);
 if(boundary!==null&&entries.some(row=>row.sequence>=boundary))throw Error('INVALID_REVIEW_BOUNDARY');
 if(nextCursor!==null&&(typeof nextCursor!=='string'||entries.length!==50||reviewCursor(nextCursor,user,campaignId)!==entries.at(-1)!.sequence))throw Error('INVALID_REVIEW_CURSOR');
 return {entries,nextCursor:nextCursor as string|null};
}
