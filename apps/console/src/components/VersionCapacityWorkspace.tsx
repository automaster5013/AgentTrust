'use client';
import {useEffect,useRef,useState} from 'react';
import {RequestScope,type Identity} from '../lib/contracts';
import {versionCapacity,type VersionCapacity} from '../lib/version-capacity';
export default function VersionCapacityWorkspace({user,disabled}:{user:Identity;disabled:boolean}){
 const [snapshot,setSnapshot]=useState<VersionCapacity|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');const generation=useRef(new RequestScope()),active=useRef<AbortController|null>(null);
 function clear(){generation.current.next();active.current?.abort();setSnapshot(null);setBusy(false);setMessage('')}
 useEffect(()=>{clear();return ()=>{generation.current.next();active.current?.abort()}},[user.actorId,user.organizationId,user.projectId,disabled]);
 async function load(){if(disabled||busy)return;const token=generation.current.next(),controller=new AbortController();active.current?.abort();active.current=controller;setSnapshot(null);setMessage('');setBusy(true);
  try{const response=await fetch('/backend/version-capacity',{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)])});if(!response.ok)throw Error('UNAVAILABLE');const value=versionCapacity(await response.json(),user);if(generation.current.current(token))setSnapshot(value)}catch{if(generation.current.current(token))setMessage('버전 등록 용량이 미확인 상태입니다. 다시 조회해 주세요.')}finally{if(generation.current.current(token))setBusy(false)}
 }
 return <section className="card" role="region" aria-label="프로젝트 버전 등록 용량"><h3>프로젝트 버전 등록 용량</h3><p>현재 프로젝트의 에이전트·데이터셋 보관 버전을 각각 집계합니다. 폐기된 버전도 보관 수에 포함됩니다.</p><button type="button" disabled={disabled||busy} onClick={load}>프로젝트 버전 용량 조회</button><button type="button" disabled={!busy} onClick={clear}>버전 용량 조회 취소</button><p role="status" aria-live="polite">{busy?'버전 등록 용량을 조회하고 있습니다.':message||(!snapshot?'버전 등록 용량이 미확인 상태입니다.':'')}</p>{snapshot&&<><p>관측 시각 <time dateTime={snapshot.observedAt}>{snapshot.observedAt}</time></p><ul>{(['agents','datasets'] as const).map(kind=><li key={kind} data-version-capacity-kind={kind}>{kind==='agents'?'에이전트':'데이터셋'} · 보관 {snapshot[kind].used} / {snapshot[kind].limit}개 · 남은 {snapshot[kind].remaining}개{snapshot[kind].exhausted?' · 등록 한도 도달':''}</li>)}</ul></>}<p>조회 시점의 관측이며 용량 예약이 아닙니다. 실제 등록 시 서버가 한도를 다시 검사합니다. 기존 버전 삭제나 원본 정리는 수행하지 않습니다.</p></section>;
}
