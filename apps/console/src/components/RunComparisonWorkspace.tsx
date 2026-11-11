'use client';
import {useEffect,useRef,useState} from 'react';
import {RequestScope,type Identity,type Run} from '../lib/contracts';
import {evaluationJson} from '../lib/evaluation-request';
import {runComparison,runComparisonPath,type RunComparison} from '../lib/run-comparison';
const labels={pass:'통과',block:'차단',fail:'실패',inconclusive:'판정 보류',missing:'규칙 없음'};
export default function RunComparisonWorkspace({user,candidate,records,disabled}:{user:Identity;candidate:Run;records:Run[];disabled:boolean}){
 const [baseline,setBaseline]=useState(''),[result,setResult]=useState<RunComparison|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const scope=useRef(new RequestScope()),active=useRef<AbortController|null>(null);
 function clear(){scope.current.next();active.current?.abort();setResult(null);setBusy(false);setMessage('')}
 useEffect(()=>{clear();setBaseline('');return ()=>{scope.current.next();active.current?.abort()}},[candidate.id,user.actorId,user.organizationId,user.projectId,disabled]);
 async function compare(){
  if(disabled||busy||candidate.state==='queued')return;
  let path:string;try{path=runComparisonPath(candidate.id,baseline.trim())}catch{clear();setMessage('다른 완료 평가의 정확한 ID를 입력해 주세요.');return}
  const requested=baseline.trim(),generation=scope.current.next(),controller=new AbortController();active.current?.abort();active.current=controller;setBusy(true);setResult(null);setMessage('');
  try{const value=await evaluationJson(path,{signal:controller.signal}),verified=runComparison(value,user,candidate.id,requested);if(scope.current.current(generation))setResult(verified)}
  catch{if(scope.current.current(generation))setMessage('비교 결과를 확인하지 못했습니다. 같은 프로젝트의 완료 평가인지 확인하고 다시 시도해 주세요.')}
  finally{if(scope.current.current(generation))setBusy(false)}
 }
 return <section aria-label="두 평가 결과 비교"><h3>두 평가 결과 비교</h3><p>현재 선택한 평가와 같은 프로젝트의 다른 완료 평가를 규칙별로 나란히 확인합니다. 조회만 수행하며 평가·검토 기록을 변경하지 않습니다.</p><p>비교 대상 평가 <span className="mono">{candidate.id}</span></p><form onSubmit={event=>{event.preventDefault();void compare()}}><label>비교 기준 평가 ID<input aria-label="비교 기준 평가 ID" list={'comparison-baselines-'+candidate.id} value={baseline} maxLength={36} disabled={disabled||candidate.state==='queued'} onChange={event=>{clear();setBaseline(event.target.value)}}/></label><datalist id={'comparison-baselines-'+candidate.id}>{records.filter(r=>r.id!==candidate.id&&r.state!=='queued').map(r=><option key={r.id} value={r.id}>{r.provider} · {r.scenario}</option>)}</datalist><button disabled={disabled||busy||candidate.state==='queued'}>두 평가 비교 실행</button><button type="button" disabled={!busy} onClick={clear}>평가 비교 취소</button></form>{candidate.state==='queued'&&<p>선택한 평가가 완료된 뒤 비교할 수 있습니다.</p>}<p role="status" aria-live="polite">{message||(busy?'두 평가 결과를 조회하고 있습니다.':'')}</p>{result&&<><p>기준 판정 {labels[result.baselineDecision]} · 대상 판정 {labels[result.candidateDecision]} · 상태 또는 필수 여부가 다른 규칙 {result.changedRules}개</p><div className="table-scroll" role="region" aria-label="평가 비교 규칙 표" tabIndex={0}><table><caption>규칙별 관측 결과 비교</caption><thead><tr><th>규칙</th><th>기준 결과</th><th>대상 결과</th><th>필수 여부 · 기준/대상</th></tr></thead><tbody>{result.rules.map(r=><tr key={r.ruleId}><th scope="row">{r.ruleId}</th><td>{labels[r.before]}</td><td>{labels[r.after]}</td><td>{r.baselineRequired===null?'없음':r.baselineRequired?'필수':'선택'} / {r.candidateRequired===null?'없음':r.candidateRequired?'필수':'선택'}</td></tr>)}</tbody></table></div><p>입력·데이터셋·정책이 동일하다는 확인을 포함하지 않는 결과 비교입니다. 차이가 없다는 사실은 회귀 통과나 배포 허용을 뜻하지 않습니다. 현재 게이트는 별도로 확인하세요.</p></>}</section>;
}
