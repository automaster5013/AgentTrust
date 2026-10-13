'use client';
import {useEffect,useRef,useState} from 'react';
import {campaignReviews,type CampaignReview} from '../lib/campaign-reviews';
import type {Identity} from '../lib/contracts';
export default function CampaignReviewHistory({user,campaignId,disabled}:{user:Identity;campaignId:string;disabled:boolean}){
 const [rows,setRows]=useState<CampaignReview[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState('');const generation=useRef(0),controller=useRef<AbortController|null>(null);
 useEffect(()=>{generation.current++;controller.current?.abort();setRows([]);setBusy(false);setMessage('');return ()=>{generation.current++;controller.current?.abort()}},[campaignId,user.actorId,user.organizationId,user.projectId,disabled]);
 async function inspect(){if(disabled||busy)return;const own=++generation.current,abort=new AbortController();controller.current?.abort();controller.current=abort;setRows([]);setMessage('');setBusy(true);
  try{const response=await fetch('/backend/campaigns/'+campaignId+'/reviews',{cache:'no-store',signal:AbortSignal.any([abort.signal,AbortSignal.timeout(10000)])});if(!response.ok)throw Error('UNAVAILABLE');const entries=campaignReviews(await response.json(),user,campaignId);if(own===generation.current){setRows(entries);setMessage(entries.length?'최근 검토 이력을 확인했습니다.':'검토 이력이 없습니다.')}}catch{if(own===generation.current&&!abort.signal.aborted)setMessage('검토 이력을 확인하지 못했습니다. 다시 조회해 주세요.')}finally{if(own===generation.current)setBusy(false)}
 }
 return <section aria-label="캠페인 검토 이력"><h4>캠페인 검토 이력</h4><p>최근 50개 검토 기록입니다. 과거 승인은 현재 배포 권한이 아닙니다. 현재 게이트를 별도로 확인하세요.</p><button disabled={disabled||busy} onClick={inspect}>캠페인 검토 이력 조회</button><p role="status">{message}</p><ol>{rows.map(row=><li key={row.id}><strong>{row.decision==='approved'?'승인':'반려'} · 순서 {row.sequence}</strong><p>{row.reason}</p><p className="mono">검토자 {row.actorId} · {row.createdAt}</p><p className="mono">정책 {row.policyVersion} · {row.policyDigest}</p></li>)}</ol></section>;
}
