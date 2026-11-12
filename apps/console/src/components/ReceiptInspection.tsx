'use client';
import {useEffect,useRef,useState} from 'react';
import {RequestScope,type Identity} from '../lib/contracts';
import type {ReceiptHistoryEntry} from '../lib/receipt-history';
import {selectedObservationTrustPath,verifiedSelectedObservation} from '../lib/receipt-inspection';
type Observation=Awaited<ReturnType<typeof verifiedSelectedObservation>>;
export default function ReceiptInspection({user,row,disabled}:{user:Identity;row:ReceiptHistoryEntry;disabled:boolean}){
 const [value,setValue]=useState<Observation|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');const scope=useRef(new RequestScope()),active=useRef<AbortController|null>(null);
 function clear(){scope.current.next();active.current?.abort();setValue(null);setBusy(false);setMessage('')}
 useEffect(()=>{clear();return ()=>{scope.current.next();active.current?.abort()}},[user.actorId,user.organizationId,user.projectId,user.role,row,disabled]);
 async function load(){if(disabled||busy)return;const token=scope.current.next(),controller=new AbortController();active.current?.abort();active.current=controller;setValue(null);setMessage('');setBusy(true);const current=()=>scope.current.current(token)&&!controller.signal.aborted;
  async function read(path:string){const response=await fetch('/backend/'+path,{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)])});if(!response.ok)throw Error('UNAVAILABLE');return response.json()}
  try{const bundle=await read('campaigns/'+row.campaignId+'/receipts/'+row.id+'/bundle');if(!current())return;const path=selectedObservationTrustPath(bundle,row),trust=await read(path),result=await verifiedSelectedObservation(bundle,trust,user,row);if(current())setValue(result)}catch{if(current())setMessage('선택한 관측의 서명과 보관 근거를 확인하지 못했습니다. 목록을 새로 조회한 뒤 다시 확인해 주세요.') }finally{if(current())setBusy(false)}
 }
 return <section role="region" aria-label="선택 서명 관측 상세"><h4>선택 서명 관측 상세</h4><p className="mono">선택 기록 {row.id}</p><button type="button" disabled={disabled||busy} onClick={load}>선택 관측 서명·근거 확인</button><button type="button" disabled={!busy&&!value} onClick={clear}>관측 상세 닫기·취소</button><p role="status" aria-live="polite">{busy?'선택한 기록의 서명과 보관 근거 연결을 확인하고 있습니다.':message}</p>{value&&<div data-receipt-inspection-id={value.receiptId}><p>개발용 신뢰영역의 Ed25519 서명과 부모·{value.childArchives}개 사례의 보관 바이트 연결을 검증했습니다.{value.baselineBytesVerified?' 고정 비교 기준의 보관 바이트도 검증했습니다.':''}</p><p>목록 보관 시각 <time dateTime={value.listedAt}>{value.listedAt}</time> · 서명된 발급 시각 <time dateTime={value.issuedAt}>{value.issuedAt}</time></p><p>당시 관측 판정 {{pass:'통과',block:'차단',inconclusive:'불확정'}[value.observedDecision]} · 당시 게이트 {value.historicalGateAllowed?'허용으로 관측':'허용 안 됨으로 관측'}</p><p aria-label="과거 관측 게이트 근거">{value.historicalGateReason}</p><p aria-label="서명된 관측 메모">{value.note}</p><p className="mono">부모 보관 SHA-256 {value.parentSha256}</p><p className="mono">검증한 공개 키 식별자 {value.keyId}</p></div>}<p>목록 시각은 서명된 발급 시각과 다른 메타데이터입니다. 과거 관측을 확인하며 현재 게이트·승인·배포 권한을 부여하지 않습니다. 새 기록 발급·서명·평가·배포를 실행하지 않습니다.</p></section>;
}
