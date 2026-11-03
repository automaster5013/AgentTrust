'use client';
import {useEffect,useRef,useState} from 'react';
import {workspaceSections} from '../lib/workspace-sections';
type Account={username:string;role:string};
export default function WorkspaceTop({user,busy,onLogout}:{user:Account|null;busy:boolean;onLogout:()=>void}){
 const header=useRef<HTMLElement>(null);const [active,setActive]=useState('overview');
 useEffect(()=>{const sync=()=>{const id=window.location.hash.slice(1);if(workspaceSections.some(section=>section.id===id))setActive(id)};sync();window.addEventListener('hashchange',sync);return ()=>window.removeEventListener('hashchange',sync)},[]);
 useEffect(()=>{
  const node=header.current,root=node?.closest<HTMLElement>('.workspace-page');if(!node||!root)return;
  const measure=()=>root.style.setProperty('--workspace-top-height',Math.ceil(node.getBoundingClientRect().height)+'px');measure();
  const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(measure);observer?.observe(node);
  return ()=>{observer?.disconnect();root.style.removeProperty('--workspace-top-height')};
 },[]);
 return <header className="workspace-top" ref={header} aria-label="작업공간 공통 상단"><div className="workspace-top-heading"><a className="brand" href="#workspace-content">AgentTrust<span>평가와 릴리스 검토</span></a><span className="workspace-top-title">평가 워크스페이스</span></div><div className="workspace-top-actions"><a className="workspace-top-home" href="#workspace-content">Top으로 이동 ↑</a>{user&&<div className="account"><span>{user.username} · {user.role}</span><button disabled={busy} onClick={onLogout}>로그아웃</button></div>}</div><nav className="workspace-top-nav" aria-label="상단 주요 메뉴">{workspaceSections.map(section=><a key={section.id} href={'#'+section.id} aria-label={section.label+'로 이동'} aria-current={active===section.id?'location':undefined} onClick={()=>setActive(section.id)}>{section.label}</a>)}</nav></header>
}
