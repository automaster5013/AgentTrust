'use client';
import {useEffect,useRef,useState} from 'react';
import {RequestScope,type Detail,type Identity} from '../lib/contracts';
import {evaluationJson} from '../lib/evaluation-request';
import {evaluationResultExport} from '../lib/evaluation-result-export';
export default function EvaluationResultExport({user,record,disabled}:{user:Identity;record:Detail;disabled:boolean}){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const generation=useRef(new RequestScope()),active=useRef<AbortController|null>(null),objectUrl=useRef<string|null>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 function release(){if(timer.current!==null){clearTimeout(timer.current);timer.current=null}if(objectUrl.current!==null){URL.revokeObjectURL(objectUrl.current);objectUrl.current=null}}
 function clear(){generation.current.next();active.current?.abort();release();setBusy(false);setMessage('')}
 useEffect(()=>{clear();return ()=>{generation.current.next();active.current?.abort();release()}},[user.actorId,user.organizationId,user.projectId,record,disabled]);
 async function download(){
  if(disabled||busy||record.state==='queued')return;const token=generation.current.next(),controller=new AbortController();active.current?.abort();active.current=controller;release();setBusy(true);setMessage('');
  try{const raw=await evaluationJson('runs/'+record.id,{signal:controller.signal}),file=evaluationResultExport(raw,user,record);if(!generation.current.current(token))return;
   const url=URL.createObjectURL(new Blob([file.json],{type:'application/json;charset=utf-8'}));objectUrl.current=url;const anchor=document.createElement('a');anchor.href=url;anchor.download=file.filename;document.body.appendChild(anchor);try{anchor.click()}finally{anchor.remove()}timer.current=setTimeout(release,1000);setMessage('선택한 완료 평가의 관측 결과 JSON 저장을 요청했습니다. '+file.bytes+'바이트 · 현재 배포 권한은 포함하지 않습니다.');
  }catch{if(generation.current.current(token))setMessage('선택한 완료 평가의 범위와 내용 일치를 확인하지 못해 파일을 저장하지 않았습니다. 근거를 다시 조회한 뒤 시도해 주세요.')}
  finally{if(generation.current.current(token))setBusy(false)}
 }
 return <section aria-label="완료 평가 결과 JSON 저장"><h3>결과 JSON 저장</h3><p>현재 선택한 완료 평가를 다시 읽어 화면의 관측 결과와 일치할 때만 최대 512KiB JSON을 저장합니다. 조회 권한으로만 동작하며 평가·검토를 변경하지 않습니다.</p><button type="button" disabled={disabled||busy||record.state==='queued'} onClick={download}>완료 평가 결과 JSON 저장</button><button type="button" disabled={!busy} onClick={clear}>결과 JSON 저장 취소</button>{record.state==='queued'&&<p>평가가 완료된 뒤 저장할 수 있습니다.</p>}<p role="status" aria-live="polite">{busy?'선택한 평가 결과를 다시 확인하고 있습니다.':message}</p><p>서명 없는 과거 관측 결과입니다. 현재 게이트·관리자 승인·배포 토큰을 포함하지 않으며 MinIO 보관 근거나 독립 서명 검증을 대체하지 않습니다.</p></section>;
}
