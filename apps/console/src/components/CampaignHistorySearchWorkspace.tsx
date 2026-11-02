'use client';
import {useEffect,useRef,useState} from 'react';
import {RequestScope,type Identity} from '../lib/contracts';
import {evaluationJson} from '../lib/evaluation-request';
import {allCampaignHistorySearchFilters,campaignHistorySearchFilters,campaignHistorySearchPath,campaignHistorySearchPage,type CampaignHistorySearchFilters} from '../lib/campaign-history-search';
import type {CampaignHistoryEntry,CampaignHistoryPage} from '../lib/campaign-history';

export default function CampaignHistorySearchWorkspace({user,disabled,datasetVersionId,selectedCampaignId,onSelect,onBaseline}:{user:Identity;disabled:boolean;datasetVersionId:string|null;selectedCampaignId:string|null;onSelect:(id:string)=>void;onBaseline:(entry:CampaignHistoryEntry)=>void}){
 const [approval,setApproval]=useState<CampaignHistorySearchFilters['approval']>('all'),[agent,setAgent]=useState('');
 const [page,setPage]=useState<CampaignHistoryPage|null>(null),[history,setHistory]=useState<(string|null)[]>([null]),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const scope=useRef(new RequestScope()),active=useRef<AbortController|null>(null);
 function clear(){scope.current.next();active.current?.abort();setPage(null);setHistory([null]);setBusy(false);setMessage('');}
 useEffect(()=>{clear();setApproval(allCampaignHistorySearchFilters.approval);setAgent('');return ()=>{scope.current.next();active.current?.abort()}},[user.actorId,user.organizationId,user.projectId,disabled,datasetVersionId]);
 async function load(boundaries:(string|null)[]){
  if(disabled||busy)return;
  let filters:CampaignHistorySearchFilters;
  try{filters=campaignHistorySearchFilters({approval,agentVersionId:agent.trim()||null})}catch{clear();setMessage('에이전트 버전은 전체 UUID를 소문자로 입력하거나 비워 주세요.');return}
  const token=boundaries.at(-1)??null,generation=scope.current.next(),controller=new AbortController();active.current?.abort();active.current=controller;setBusy(true);setPage(null);setMessage('');
  try{const value=await evaluationJson(campaignHistorySearchPath(filters,datasetVersionId,token),{signal:controller.signal}),result=await campaignHistorySearchPage(value,user,filters,datasetVersionId,token);if(scope.current.current(generation)){setPage(result);setHistory(boundaries)}}
  catch{if(scope.current.current(generation))setMessage('전체 캠페인 이력 검색을 확인하지 못했습니다. 현재 서버의 지원 상태나 연결을 확인한 뒤 다시 검색해 주세요.')}
  finally{if(scope.current.current(generation))setBusy(false)}
 }
 return <section className="card" role="region" aria-label="전체 캠페인 이력 검색">
  <h3>전체 캠페인 이력 검색</h3><p>현재 프로젝트의 전체 저장 이력을 25개씩 검색합니다. {datasetVersionId?'선택한 캠페인과 같은 데이터셋 버전으로 검색합니다.':'모든 데이터셋 버전을 대상으로 검색합니다.'} 현재 페이지 필터와 별도로 동작합니다.</p>
  <form onSubmit={event=>{event.preventDefault();void load([null])}}><fieldset disabled={disabled}>
   <legend>전체 캠페인 검색 조건</legend>
   <label>전체 캠페인 승인 필요 설정<select value={approval} onChange={event=>{clear();setApproval(event.target.value as CampaignHistorySearchFilters['approval'])}}><option value="all">모든 승인 설정</option><option value="required">승인 필요</option><option value="not-required">승인 불필요</option></select></label>
   <label>전체 캠페인 에이전트 버전 UUID<input value={agent} maxLength={36} autoComplete="off" spellCheck={false} onChange={event=>{clear();setAgent(event.target.value)}} placeholder="비우면 모든 버전"/></label>
   <button type="submit" disabled={disabled||busy}>전체 캠페인 이력 검색 실행</button><button type="button" onClick={()=>{clear();setApproval('all');setAgent('')}}>전체 캠페인 검색 초기화</button>
  </fieldset></form><p role="status" aria-live="polite">{message||(busy?'전체 캠페인 이력을 검색하고 있습니다.':'')}</p>
  {page&&<><p>전체 캠페인 검색 페이지 {history.length} · {page.entries.length}개</p>{page.entries.length===0?<p>검색 조건에 맞는 캠페인이 없습니다.</p>:<div className="table-scroll" role="region" aria-label="전체 캠페인 검색 결과 표 · 좁은 화면에서 좌우로 이동" tabIndex={0}><table><caption>저장된 캠페인 요청 검색 결과</caption><thead><tr><th>요청 시간</th><th>캠페인 / 에이전트 버전</th><th>승인 필요 설정</th><th>근거와 비교</th></tr></thead><tbody>{page.entries.map(row=><tr key={row.id} data-campaign-search-id={row.id}><td><time dateTime={row.createdAt}>{new Date(row.createdAt).toLocaleString('ko-KR')}</time></td><td className="mono">{row.id} / {row.agentVersionId}</td><td>{row.requiresApproval?'승인 필요':'승인 불필요'}</td><td><button type="button" disabled={disabled||busy} onClick={()=>onSelect(row.id)}>검색 캠페인 근거 {row.id.slice(0,8)}</button>{datasetVersionId&&row.id!==selectedCampaignId&&<button type="button" disabled={disabled||busy} onClick={()=>onBaseline(row)}>검색 비교 기준 {row.id.slice(0,8)} 선택</button>}</td></tr>)}</tbody></table></div>}
  <nav aria-label="전체 캠페인 검색 페이지"><button type="button" disabled={disabled||busy||history.length<2} onClick={()=>void load(history.slice(0,-1))}>이전 전체 캠페인 검색 페이지</button><button type="button" disabled={disabled||busy||!page.nextCursor||history.length>=100} onClick={()=>void load([...history,page.nextCursor])}>다음 전체 캠페인 검색 페이지</button></nav>{history.length>=100&&<p>100페이지 한도에 도달했습니다. 조건을 좁히거나 처음부터 다시 검색하세요.</p>}</>}
  <p>승인 필요 설정은 요청 당시 값이며 현재 승인·완료 상태나 배포 권한이 아닙니다. 비교 적합성과 현재 게이트는 기존 근거 API에서 다시 확인합니다.</p>
 </section>;
}
