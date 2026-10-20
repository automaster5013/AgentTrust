'use client';
import {useEffect,useState} from 'react';
import {evaluationJson} from '../lib/evaluation-request';
import {campaignReviewPage,type CampaignReview} from '../lib/campaign-reviews';
import {runReviewPage} from '../lib/run-reviews';
import type {Identity} from '../lib/contracts';

type Basis={recordId:string;scope:string;version:number;sequence:number;latest:CampaignReview|null};
export function useReviewBasis(user:Identity|null,resource:'runs'|'campaigns',recordId:string|null,enabled:boolean){
 const [basis,setBasis]=useState<Basis|null>(null),[version,setVersion]=useState(0),[loading,setLoading]=useState(false);
 const scope=user?user.organizationId+'/'+user.projectId+'/'+user.actorId:'';
 useEffect(()=>{
  setBasis(null);setLoading(false);if(!enabled||!user||!recordId)return;
  const abort=new AbortController();let live=true;setLoading(true);
  evaluationJson(resource+'/'+recordId+'/reviews/page',{signal:abort.signal}).then(value=>{
   const page=(resource==='runs'?runReviewPage:campaignReviewPage)(value,user,recordId);
   if(live)setBasis({recordId,scope,version,sequence:page.entries[0]?.sequence??0,latest:page.entries[0]??null});
  }).catch(()=>{if(live)setBasis(null)}).finally(()=>{if(live)setLoading(false)});
  return ()=>{live=false;abort.abort()};
 },[resource,recordId,scope,enabled,version]);
 return {basis:enabled&&basis?.recordId===recordId&&basis.scope===scope&&basis.version===version?basis:null,loading,reload:()=>setVersion(value=>value+1)};
}
export function ReviewBasisNotice({value}:{value:ReturnType<typeof useReviewBasis>}){
 return <section className="review-history" aria-label="저장 전 검토 기준"><h4>저장 전 검토 기준</h4><p>화면에서 확인한 최신 검토 순서가 바뀌면 저장을 거부합니다. 변경된 결정을 읽고 다시 제출해 주세요.</p>{value.basis?<>{value.basis.latest?<><p>확인한 최신 검토: {value.basis.latest.decision==='approved'?'승인':'반려'} · 순서 {value.basis.sequence}</p><p>{value.basis.latest.reason}</p><p className="mono">검토자 {value.basis.latest.actorId} · {value.basis.latest.createdAt}</p></>:<p>확인한 검토 기록 없음 · 순서 0</p>}</>:<p aria-live="polite" aria-atomic="true">{value.loading?'최신 검토 기준을 조회하고 있습니다.':'최신 검토 기준을 확인하지 못해 저장할 수 없습니다.'}</p>}<button type="button" disabled={value.loading} onClick={value.reload}>검토 기준 다시 조회</button></section>;
}
