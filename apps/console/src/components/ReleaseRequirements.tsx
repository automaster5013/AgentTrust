'use client';
import {useEffect,useRef,useState} from 'react';
import {releaseRequirements,type ReleaseRequirements as Requirements} from '../lib/release-requirements';
import {RequestScope,type Identity} from '../lib/contracts';
import type {Campaign} from '../lib/campaign-contracts';
export default function ReleaseRequirements({user,record,disabled}:{user:Identity;record:Campaign;disabled:boolean}){
 const [value,setValue]=useState<Requirements|null>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),scope=useRef(new RequestScope());
 useEffect(()=>{scope.current.next();setValue(null);setMessage('');setBusy(false);return()=>{scope.current.next()}},[record.id,record.state,user.actorId,user.organizationId,user.projectId]);
 async function inspect(){if(disabled||busy)return;const generation=scope.current.next();setValue(null);setMessage('');setBusy(true);try{
  const response=await fetch('/backend/campaigns/'+record.id+'/release-requirements',{cache:'no-store',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('UNAVAILABLE');const result=releaseRequirements(await response.json(),user,record);
  if(scope.current.current(generation))setValue(result);
 }catch{if(scope.current.current(generation))setMessage('고정된 릴리스 조건을 확인하지 못했습니다. 다시 확인해 주세요.')}finally{if(scope.current.current(generation))setBusy(false)}}
 return <section aria-label="고정된 릴리스 조건"><h4>고정된 릴리스 조건</h4><button disabled={disabled||busy} onClick={inspect}>비교 기준·근거 유효 기간 확인</button>{value&&(value.enabled?<><p className="mono">고정 기준 캠페인 {value.baselineCampaignId}</p><p>양쪽 근거 유효 기간 {value.evidenceMaxAgeSeconds}초 · 만료 {new Date(value.evidenceExpiresAtEpochMillis).toLocaleString('ko-KR')}</p><p>현재 비교 {value.comparison.status} · 새 필수 실패 {value.comparison.newlyFailedRequiredCases.join(', ')||'없음'} · 미확인 {value.comparison.unresolvedRequiredCases.join(', ')||'없음'}</p><p>이 기준은 생성 후 변경할 수 없습니다. 현재 게이트에서 승인과 함께 다시 판정합니다.</p></>:<p>이 캠페인은 비교 기준을 고정하지 않았습니다. 기존 평가·승인 조건을 적용합니다.</p>)}{message&&<p role="status">{message}</p>}</section>;
}
