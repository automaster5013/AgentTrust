'use client';
import {useEffect,useRef,useState} from 'react';
import {verifiedGateCheckExport,gateCheckExportAvailable} from '../lib/gate-check-export';
import {gateCheckRemaining} from '../lib/gate-check-lifetime';
import {newGateChallenge,type GateCheck} from '../lib/gate-check-contracts';
import {verifiedCampaignArchive,type Campaign} from '../lib/campaign-contracts';
import {RequestScope,type Identity} from '../lib/contracts';
async function json(path:string,signal:AbortSignal){const response=await fetch('/backend/'+path,{signal,cache:'no-store'});if(!response.ok)throw Error('현재 판정을 확인하지 못했습니다.');return response.json() as Promise<unknown>}
export default function CurrentGateCheck({user,record,disabled}:{user:Identity;record:Campaign;disabled:boolean}){
 const [check,setCheck]=useState<(GateCheck&{monotonicExpiresAt:number;exportJson:string;owner:string})|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const owner=JSON.stringify([record,user.actorId,user.organizationId,user.projectId,user.role]);
 const scope=useRef(new RequestScope()),controller=useRef<AbortController|null>(null);
 useEffect(()=>{scope.current.next();controller.current?.abort();setCheck(null);setBusy(false);setMessage('');return ()=>{scope.current.next();controller.current?.abort()}},[owner,disabled]);
 useEffect(()=>{if(!check)return;const clear=()=>{setCheck(null);setMessage('확인 시간이 만료됐습니다. 다시 확인해 주세요.')};const remaining=Math.min(check.expiresAtEpochMillis-Date.now(),check.monotonicExpiresAt-performance.now());const expire=()=>{if(Date.now()>=check.expiresAtEpochMillis||performance.now()>=check.monotonicExpiresAt)clear()};if(remaining<=0){clear();return}const timer=setTimeout(clear,remaining);window.addEventListener('focus',expire);document.addEventListener('visibilitychange',expire);return ()=>{clearTimeout(timer);window.removeEventListener('focus',expire);document.removeEventListener('visibilitychange',expire)}},[check]);
 async function inspect(){
  if(disabled||busy||record.state==='queued')return;
  const generation=scope.current.next(),nonce=newGateChallenge(),started=Date.now(),monotonicStarted=performance.now(),abort=new AbortController(),signal=AbortSignal.any([abort.signal,AbortSignal.timeout(10000)]);controller.current?.abort();controller.current=abort;setCheck(null);setMessage('');setBusy(true);
  try{
   const [trust,evidence]=await Promise.all([json('gate-trust',signal),json('campaigns/'+record.id+'/evidence',signal)]);
   const archive=await verifiedCampaignArchive(evidence,user,record);
   const value=await json('campaigns/'+record.id+'/gate-check/'+nonce,signal);
   const exported=await verifiedGateCheckExport(value,trust,user,record,archive,nonce,started),result=exported.check;
   const now=performance.now(),remaining=gateCheckRemaining(result,Date.now(),monotonicStarted,now);
   if(remaining<=0||signal.aborted)throw Error('EXPIRED_GATE_CHECK');
   if(scope.current.current(generation)&&!abort.signal.aborted)setCheck({...result,monotonicExpiresAt:now+remaining,exportJson:exported.json,owner});
  }catch{if(scope.current.current(generation)&&!abort.signal.aborted)setMessage('서명·범위·유효 시간을 확인하지 못했습니다. 다시 확인해 주세요.')}
  finally{if(scope.current.current(generation))setBusy(false)}
 }
 function cancel(){scope.current.next();controller.current?.abort();setCheck(null);setBusy(false);setMessage('요청 관측 확인을 취소했습니다.')}
 function download(){if(disabled||busy||!check||check.owner!==owner)return;if(!gateCheckExportAvailable(check,Date.now(),performance.now())){setCheck(null);setMessage('확인 시간이 만료되어 파일을 저장하지 않았습니다. 다시 확인해 주세요.');return;}const url=URL.createObjectURL(new Blob([check.exportJson],{type:'application/json;charset=utf-8'}));try{const link=document.createElement('a');link.href=url;link.download='agenttrust-gate-observation-'+record.id+'.json';document.body.appendChild(link);link.click();link.remove();setMessage('검증한 요청 관측을 저장했습니다. 파일은 과거 관측이며 현재 배포 권한이 아닙니다.')}finally{setTimeout(()=>URL.revokeObjectURL(url),1000)}}
 return <section aria-label="서명된 현재 판정 확인"><h3>서명된 현재 판정 확인</h3><p>이번 요청의 서명과 현재 승인 상태를 확인합니다. 확인 결과는 최대 30초 동안 표시됩니다.</p><button disabled={disabled||busy||record.state==='queued'} onClick={inspect}>{busy?'현재 판정 확인 중…':'현재 판정 서명 확인'}</button><button type="button" disabled={!busy} onClick={cancel}>현재 판정 확인 취소</button>{check&&check.owner===owner&&<><p><strong>서명 확인 완료 · {check.observedGate.deploymentAllowed?'합성 릴리스 허용':'릴리스 허용 안 됨'}</strong></p><p>{check.observedGate.reason}</p>{check.releaseRequirements?.enabled&&<p className="mono">서명에 묶인 비교 기준 {check.releaseRequirements.baselineCampaignId} · 유효 기간 {check.releaseRequirements.evidenceMaxAgeSeconds}초</p>}{check.versionLifecycle&&<section aria-label="서명에 묶인 버전 상태"><h4>서명에 묶인 버전 상태</h4><ul>{check.versionLifecycle.versions.map((version,index)=><li key={index}>{index>=2?'비교 기준':'후보'} {version.kind==='agents'?'에이전트':'데이터셋'} · {version.state==='active'?'활성':'폐기'} · <span className="mono">{version.versionId}</span></li>)}</ul></section>}<button type="button" disabled={disabled||busy} onClick={download}>확인한 요청 관측 JSON 저장</button><p>저장은 새 판정 조회나 서명을 요청하지 않습니다. 원래 서명 payload 바이트와 공개 개발키를 포함한 정규화 파일입니다. 운영 신뢰키 확인이나 현재 배포 토큰을 대신하지 않습니다.</p><p>확인 시각 {new Date(check.checkedAtEpochMillis).toLocaleTimeString('ko-KR')} · 만료 {new Date(check.expiresAtEpochMillis).toLocaleTimeString('ko-KR')}</p></>}<p role="status" aria-live="polite">{message||(busy?'서명과 현재 판정을 확인하고 있습니다.':'')}</p><p>개발용 신뢰키를 사용합니다. 이 확인 결과로 배포를 실행하지 않습니다.</p></section>
}
