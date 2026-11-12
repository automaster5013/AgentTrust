'use client';
import {useEffect,useRef,useState} from 'react';
import {RequestScope,type Detail,type Identity} from '../lib/contracts';
import type {Campaign} from '../lib/campaign-contracts';
import {selectedCampaignCase,verifiedCaseParent,verifiedCaseDetail} from '../lib/campaign-case-inspection';
export default function CampaignCaseInspection({user,record,caseId,disabled}:{user:Identity;record:Campaign;caseId:string;disabled:boolean}){
 const [result,setResult]=useState<Detail|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');const generation=useRef(new RequestScope()),active=useRef<AbortController|null>(null);
 function clear(){generation.current.next();active.current?.abort();setResult(null);setBusy(false);setMessage('')}
 useEffect(()=>{clear();return ()=>{generation.current.next();active.current?.abort()}},[user.actorId,user.organizationId,user.projectId,user.role,record,caseId,disabled]);
 async function load(){if(disabled||busy)return;const token=generation.current.next(),controller=new AbortController();active.current?.abort();active.current=controller;setResult(null);setMessage('');setBusy(true);
  const current=()=>generation.current.current(token)&&!controller.signal.aborted;
  async function read(path:string){const response=await fetch('/backend/'+path,{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)])});if(!response.ok)throw Error('UNAVAILABLE');return response.json()}
  try{selectedCampaignCase(record,user,caseId);const selected=await verifiedCaseParent(await read('campaigns/'+record.id),user,record,caseId);if(!current())return;const value=verifiedCaseDetail(await read('runs/'+selected.runId),user,record,selected);if(current())setResult(value)}catch{if(current())setMessage('사례 평가 근거를 확인하지 못했습니다. 캠페인 상태를 새로 확인한 뒤 다시 조회해 주세요.')}finally{if(current())setBusy(false)}
 }
 const definition=record.datasetVersion.definition.cases.find(c=>c.id===caseId);
 return <section role="region" aria-label="선택 사례 평가 근거"><h4>선택 사례 {caseId}</h4><button type="button" disabled={disabled||busy} onClick={load}>선택 사례 근거 조회</button><button type="button" disabled={!busy&&!result} onClick={clear}>사례 근거 닫기·취소</button><p role="status" aria-live="polite">{busy?'캠페인 연결과 사례 평가 근거를 조회하고 있습니다.':message}</p>{result&&<div data-case-inspection-run={result.id}><p className="mono">평가 {result.id}</p><p>실행 엔진 {result.result.executionEngine}</p>{definition?.input!==undefined&&<><h5>고정된 사례 입력</h5><pre>{definition.input}</pre>{record.datasetVersion.definition.contract==='recorded-text-rules-v1'?<><h5>기록된 합성 출력</h5><pre>{definition.output}</pre><p>기록된 출력에 문자열 포함·미포함 규칙을 적용한 결과입니다. 외부 모델을 호출하지 않았습니다.</p></>:<><h5>고정된 기대 답안</h5><pre>{definition.expected}</pre></>}</>}<div className="table-scroll" role="region" aria-label="사례 평가 규칙 표 · 좁은 화면에서 좌우로 이동" tabIndex={0}><table><caption>선택 사례의 평가 규칙과 근거</caption><thead><tr><th>규칙</th><th>필수 여부</th><th>결과</th><th>근거</th></tr></thead><tbody>{result.result.rules.map((rule,index)=><tr key={index}><th>{rule.id}</th><td>{rule.required?'필수':'선택'}</td><td>{{pass:'통과',fail:'실패',inconclusive:'판정 보류'}[rule.status]}</td><td>{rule.reason}</td></tr>)}</tbody></table></div></div>}<p>현재 캠페인에 연결된 사례의 관측 근거입니다. 전체 캠페인 판정·현재 게이트·검토·서명·배포 권한은 별도로 확인합니다. 원시 모델 출력이나 도구 이벤트를 제공하는 화면은 아닙니다.</p></section>;
}
