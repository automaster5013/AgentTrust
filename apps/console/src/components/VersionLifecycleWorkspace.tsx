'use client';
import {useEffect,useRef,useState} from 'react';
import {RequestScope,type Identity} from '../lib/contracts';
import {verifiedAgentVersion,verifiedDatasetVersion,type Version} from '../lib/campaign-contracts';
import {versionLifecycle,type VersionLifecycle} from '../lib/version-lifecycle';
export default function VersionLifecycleWorkspace({user,kind,version,disabled}:{user:Identity;kind:'agents'|'datasets';version:Version;disabled:boolean}){
 const [state,setState]=useState<VersionLifecycle|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const scope=useRef(new RequestScope()),active=useRef<AbortController|null>(null),path='versions/'+kind+'/'+version.id+'/lifecycle';
 useEffect(()=>{scope.current.next();active.current?.abort();setState(null);setBusy(false);setMessage('');return ()=>{scope.current.next();active.current?.abort()}},[user.actorId,user.organizationId,user.projectId,version.id,kind]);
 async function request(path:string,controller:AbortController,init?:RequestInit){const response=await fetch('/backend/'+path,{...init,cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)])});if(!response.ok)throw Error('UNAVAILABLE');return response.json()}
 async function inspect(reason?:string){if(disabled||busy)return;const generation=scope.current.next(),controller=new AbortController();active.current?.abort();active.current=controller;setBusy(true);setState(null);setMessage('');
  try{
   const raw=await request('versions/'+kind+'/'+version.id,controller),verified=kind==='agents'?await verifiedAgentVersion(raw,user):await verifiedDatasetVersion(raw,user);
   if(verified.id!==version.id||verified.content_sha256!==version.content_sha256)throw Error('INVALID_VERSION');
   if(reason!==undefined){if(user.role!=='admin'||!reason.trim()||reason.length>500)throw Error('INVALID_RETIREMENT');const csrf=await request('csrf',controller);if(typeof csrf.token!=='string'||csrf.token.length>2048)throw Error('INVALID_CSRF');const result=await request(path+'/retirement',controller,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-TOKEN':csrf.token},body:JSON.stringify({reason})});const checked=versionLifecycle(result,user,kind,version.id,version.content_sha256);if(checked.state!=='retired')throw Error('INVALID_RETIREMENT');}
   const checked=versionLifecycle(await request(path,controller),user,kind,version.id,version.content_sha256);
   if(scope.current.current(generation)){setState(checked);setMessage(checked.state==='retired'?'폐기 상태를 확인했습니다. 새 실행과 현재 릴리스 허용에 사용할 수 없습니다.':'활성 상태를 확인했습니다.')}
  }catch{if(scope.current.current(generation))setMessage('버전 상태 또는 폐기 결과를 확인하지 못했습니다. 상태를 다시 조회해 주세요.')}finally{if(scope.current.current(generation))setBusy(false)}
 }
 function retire(event:React.FormEvent<HTMLFormElement>){event.preventDefault();const reason=new FormData(event.currentTarget).get('reason');if(typeof reason==='string')void inspect(reason)}
 return <div aria-label={'버전 수명주기 '+version.resource_key+' v'+version.version}><button type="button" disabled={disabled||busy} onClick={()=>inspect()}>버전 상태 확인</button><p role="status">{message}</p>{state&&<><p>상태: {state.state==='active'?'활성':'폐기'}</p>{state.state==='retired'&&<><p>폐기 시각: {state.retiredAt}</p><p>폐기 사유: {state.reason}</p></>}{user.role==='admin'&&state.state==='active'&&<form onSubmit={retire}><label>버전 폐기 사유<textarea name="reason" required maxLength={500}/></label><p>폐기는 되돌릴 수 없습니다. 원본 버전·과거 근거는 보존하며, 다시 실행하려면 새 버전을 등록해야 합니다.</p><button disabled={disabled||busy}>이 버전 폐기</button></form>}</>}</div>
}
