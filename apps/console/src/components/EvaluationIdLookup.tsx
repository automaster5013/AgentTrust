'use client';
import {useEffect,useRef,useState} from 'react';
import {evaluationLookupId} from '../lib/evaluation-lookup';
import {RequestScope} from '../lib/contracts';
export default function EvaluationIdLookup({disabled,onOpen}:{disabled:boolean;onOpen:(id:string)=>Promise<boolean>}){
 const [value,setValue]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');const scope=useRef(new RequestScope());
 useEffect(()=>()=>{scope.current.next()},[]);
 async function open(event:React.FormEvent<HTMLFormElement>){
  event.preventDefault();if(disabled||busy)return;
  let id:string;try{id=evaluationLookupId(value)}catch{setMessage('전체 평가 ID를 입력해 주세요. 하이픈을 포함한 36자 ID가 필요합니다.');return}
  const generation=scope.current.next();setBusy(true);setMessage('평가 근거와 현재 게이트를 조회하고 있습니다.');
  try{const opened=await onOpen(id);if(!scope.current.current(generation))return;
   setMessage(opened?'평가 근거와 현재 게이트를 확인했습니다.':'평가를 확인하지 못했습니다. ID와 현재 프로젝트를 확인하고 다시 시도해 주세요.');
   if(opened)requestAnimationFrame(()=>{if(scope.current.current(generation)){const target=document.getElementById('selected-evaluation-evidence');target?.focus();target?.scrollIntoView({block:'start'})}});
  }catch{if(scope.current.current(generation))setMessage('평가를 확인하지 못했습니다. 다시 시도해 주세요.')}
  finally{if(scope.current.current(generation))setBusy(false)}
 }
 return <form onSubmit={open} aria-label="평가 ID로 근거 바로 열기"><h3>평가 ID로 근거 바로 열기</h3><p id="evaluation-id-help">평가 ID를 알고 있다면 이력 페이지를 넘기지 않고 근거와 현재 게이트를 확인할 수 있습니다. 현재 조직·프로젝트에서 접근 가능한 평가만 열립니다.</p><label>전체 평가 ID<input name="evaluationId" value={value} maxLength={80} autoComplete="off" spellCheck={false} aria-describedby="evaluation-id-help" disabled={disabled||busy} onChange={event=>{setValue(event.target.value);setMessage('')}}/></label><button type="submit" disabled={disabled||busy||!value.trim()}>평가 ID로 근거 확인</button><p role="status" aria-live="polite">{message}</p></form>
}
