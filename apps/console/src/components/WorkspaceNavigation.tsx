'use client';
import {useEffect,useState} from 'react';
const sections=[{id:'evaluations',label:'평가 실행·조회',description:'실행과 근거 확인',number:'01'},{id:'campaigns',label:'버전·캠페인',description:'기준과 회귀 분석',number:'02'},{id:'operations',label:'준비 상태·사용량',description:'실행 전 상태 확인',number:'03'},{id:'history',label:'이력·감사',description:'과거 기록과 추적',number:'04'}] as const;
export default function WorkspaceNavigation(){
 const [active,setActive]=useState<string>('evaluations');
 useEffect(()=>{
  const syncHash=()=>{const id=window.location.hash.slice(1);if(sections.some(s=>s.id===id))setActive(id)};syncHash();window.addEventListener('hashchange',syncHash);
  const observer=typeof IntersectionObserver==='undefined'?null:new IntersectionObserver(entries=>{const visible=entries.filter(e=>e.isIntersecting).sort((a,b)=>a.boundingClientRect.top-b.boundingClientRect.top);if(visible[0])setActive(visible[0].target.id)},{rootMargin:'-12% 0px -68% 0px',threshold:0});
  for(const s of sections){const target=document.getElementById(s.id);if(target)observer?.observe(target)}
  return ()=>{observer?.disconnect();window.removeEventListener('hashchange',syncHash)};
 },[]);
 return <nav className="workspace-nav" aria-label="워크스페이스 탐색"><p className="nav-heading" aria-hidden="true">워크스페이스</p>{sections.map(s=><a key={s.id} href={'#'+s.id} aria-label={s.label} aria-current={active===s.id?'location':undefined} onClick={()=>setActive(s.id)}><span className="nav-number" aria-hidden="true">{s.number}</span><span className="nav-copy"><strong>{s.label}</strong><small aria-hidden="true">{s.description}</small></span></a>)}<p className="nav-note">근거 확인 → 검토 → 현재 게이트</p></nav>;
}
