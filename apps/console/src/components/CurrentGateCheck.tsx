'use client';
import {useEffect,useRef,useState} from 'react';
import {gateCheckRemaining} from '../lib/gate-check-lifetime';
import {newGateChallenge,verifiedGateCheck,type GateCheck} from '../lib/gate-check-contracts';
import {verifiedCampaignArchive,type Campaign} from '../lib/campaign-contracts';
import {RequestScope,type Identity} from '../lib/contracts';
async function json(path:string,signal:AbortSignal){const response=await fetch('/backend/'+path,{signal,cache:'no-store'});if(!response.ok)throw Error('현재 판정을 확인하지 못했습니다.');return response.json() as Promise<unknown>}
export default function CurrentGateCheck({user,record,disabled}:{user:Identity;record:Campaign;disabled:boolean}){
 const [check,setCheck]=useState<(GateCheck&{monotonicExpiresAt:number})|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const scope=useRef(new RequestScope()),controller=useRef<AbortController|null>(null);
 useEffect(()=>{scope.current.next();controller.current?.abort();setCheck(null);setBusy(false);setMessage('');return ()=>{scope.current.next();controller.current?.abort()}},[record.id,user.actorId,user.organizationId,user.projectId,disabled]);
 useEffect(()=>{if(!check)return;const clear=()=>{setCheck(null);setMessage('확인 시간이 만료됐습니다. 다시 확인해 주세요.')};const remaining=Math.min(check.expiresAtEpochMillis-Date.now(),check.monotonicExpiresAt-performance.now());const expire=()=>{if(Date.now()>=check.expiresAtEpochMillis||performance.now()>=check.monotonicExpiresAt)clear()};if(remaining<=0){clear();return}const timer=setTimeout(clear,remaining);window.addEventListener('focus',expire);document.addEventListener('visibilitychange',expire);return ()=>{clearTimeout(timer);window.removeEventListener('focus',expire);document.removeEventListener('visibilitychange',expire)}},[check]);
 async function inspect(){
  if(disabled||busy||record.state==='queued')return;
  const generation=scope.current.next(),nonce=newGateChallenge(),started=Date.now(),monotonicStarted=performance.now(),abort=new AbortController(),signal=AbortSignal.any([abort.signal,AbortSignal.timeout(10000)]);controller.current?.abort();controller.current=abort;setCheck(null);setMessage('');setBusy(true);
  try{
   const [trust,evidence]=await Promise.all([json('gate-trust',signal),json('campaigns/'+record.id+'/evidence',signal)]);
   const archive=await verifiedCampaignArchive(evidence,user,record);
   const value=await json('campaigns/'+record.id+'/gate-check/'+nonce,signal);
   const result=await verifiedGateCheck(value,trust,user,record,archive,nonce,started);
   const now=performance.now(),remaining=gateCheckRemaining(result,Date.now(),monotonicStarted,now);
   if(remaining<=0||signal.aborted)throw Error('EXPIRED_GATE_CHECK');
   if(scope.current.current(generation)&&!abort.signal.aborted)setCheck({...result,monotonicExpiresAt:now+remaining});
  }catch{if(scope.current.current(generation)&&!abort.signal.aborted)setMessage('서명·범위·유효 시간을 확인하지 못했습니다. 다시 확인해 주세요.')}
  finally{if(scope.current.current(generation))setBusy(false)}
 }
 return <section aria-label="서명된 현재 판정 확인"><h3>서명된 현재 판정 확인</h3><p>이번 요청의 서명과 현재 승인 상태를 확인합니다. 확인 결과는 최대 30초 동안 표시됩니다.</p><button disabled={disabled||busy||record.state==='queued'} onClick={inspect}>{busy?'현재 판정 확인 중…':'현재 판정 서명 확인'}</button>{check&&<><p><strong>서명 확인 완료 · {check.observedGate.deploymentAllowed?'합성 릴리스 허용':'릴리스 허용 안 됨'}</strong></p><p>{check.observedGate.reason}</p><p>확인 시각 {new Date(check.checkedAtEpochMillis).toLocaleTimeString('ko-KR')} · 만료 {new Date(check.expiresAtEpochMillis).toLocaleTimeString('ko-KR')}</p></>}{message&&<p role="status">{message}</p>}<p>개발용 신뢰키를 사용합니다. 이 확인 결과로 배포를 실행하지 않습니다.</p></section>
}
