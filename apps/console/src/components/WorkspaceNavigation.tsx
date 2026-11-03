'use client';
import {useEffect,useState} from 'react';
import {workspaceSections as sections} from '../lib/workspace-sections';
export default function WorkspaceNavigation(){
 const [active,setActive]=useState<string>('overview');
 useEffect(()=>{
  const syncHash=()=>{const id=window.location.hash.slice(1);if(sections.some(s=>s.id===id))setActive(id)};syncHash();window.addEventListener('hashchange',syncHash);
  const observer=typeof IntersectionObserver==='undefined'?null:new IntersectionObserver(entries=>{const visible=entries.filter(e=>e.isIntersecting).sort((a,b)=>a.boundingClientRect.top-b.boundingClientRect.top);if(visible[0])setActive(visible[0].target.id)},{rootMargin:'-12% 0px -68% 0px',threshold:0});
  for(const s of sections){const target=document.getElementById(s.id);if(target)observer?.observe(target)}
  return ()=>{observer?.disconnect();window.removeEventListener('hashchange',syncHash)};
 },[]);
 return <nav className="workspace-nav" aria-label="워크스페이스 탐색"><div className="nav-heading"><strong>AgentTrust</strong><span>통합 작업공간</span></div>{sections.map(s=><a key={s.id} href={'#'+s.id} aria-label={s.label} aria-current={active===s.id?'location':undefined} onFocus={event=>event.currentTarget.scrollIntoView({block:'nearest',inline:'nearest'})} onClick={()=>setActive(s.id)}><span className="nav-number" aria-hidden="true">{s.number}</span><span className="nav-copy"><strong>{s.label}</strong><small aria-hidden="true">{s.description}</small></span></a>)}<p className="nav-note">근거 확인 → 검토 → 현재 게이트<br/>현재 프로젝트의 권한으로 작업합니다.</p></nav>;
}
