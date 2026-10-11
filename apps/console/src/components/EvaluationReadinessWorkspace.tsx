 'use client';
import {useEffect,useRef,useState} from 'react';
import {RequestScope,type Identity} from '../lib/contracts';
import {evaluationReadiness,type Readiness} from '../lib/evaluation-readiness';
export default function EvaluationReadinessWorkspace({user,disabled}:{user:Identity;disabled:boolean}){
 const [result,setResult]=useState<Readiness|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const scope=useRef(new RequestScope()),active=useRef<AbortController|null>(null);
 useEffect(()=>()=>{scope.current.next();active.current?.abort()},[user.actorId,user.organizationId,user.projectId]);
 async function load(){if(disabled||busy)return;const generation=scope.current.next(),controller=new AbortController();active.current?.abort();active.current=controller;setBusy(true);setResult(null);setMessage('');
  try{const response=await fetch('/backend/evaluation-readiness',{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)])});if(![200,503].includes(response.status))throw Error('UNAVAILABLE');const value=evaluationReadiness(await response.json(),user,response.status);if(scope.current.current(generation))setResult(value)}catch{if(scope.current.current(generation))setMessage('준비 상태를 확인하지 못했습니다. 다시 조회해 주세요.')}finally{if(scope.current.current(generation))setBusy(false)}
 }
 const labels:Record<string,string>={database:'프로젝트 데이터베이스', 'worker-queue':'Python 평가 워커·NATS 큐',policy:'OPA 정책 엔진'};
 return <section className="card" role="region" aria-label="평가 경로 준비 상태"><h2>평가 경로 준비 상태</h2><p>현재 데이터베이스 연결, 두 평가 큐의 설정과 정책 응답을 확인합니다.</p><button type="button" disabled={disabled||busy} onClick={load}>평가 경로 상태 확인</button><p role="status" aria-live="polite">{message||(busy?'준비 상태를 확인하고 있습니다.':result?(result.ready?'평가 경로 연결 확인 완료':'평가 경로의 일부 연결을 확인하지 못했습니다.'):'')}</p>{result&&<><ul>{result.dependencies.map(d=><li key={d.name}>{labels[d.name]} · {d.available?'연결 확인':'확인 불가'}</li>)}</ul><p>확인 시각 <time dateTime={result.checkedAt}>{new Date(result.checkedAt).toLocaleString('ko-KR')}</time></p></>}<p>조회 시점의 연결 확인입니다. 모델 실행 성공, 운영 배포 준비 완료 또는 릴리스 승인을 의미하지 않습니다.</p></section>
}
