import type {Identity,Run} from '../lib/contracts';

export default function WorkspaceOverview({user,records,state}:{user:Identity;records:Run[];state:'loading'|'ready'|'unavailable'}){
 const ready=state==='ready';
 const cards=[['최근 조회한 평가',records.length],['평가 통과',records.filter(r=>r.decision==='pass').length],['차단',records.filter(r=>r.decision==='block').length],['판정 보류',records.filter(r=>r.decision==='inconclusive').length]] as const;
 return <section id="overview" className="workspace-overview" aria-labelledby="workspace-overview-heading" tabIndex={-1}>
  <div className="title"><div><p className="section-kicker">WORKSPACE HOME</p><h2 id="workspace-overview-heading">프로젝트 홈</h2></div><span className="workspace-edition">4320 통합 플랫폼</span></div>
  <p>현재 프로젝트에서 평가를 실행하고, 근거와 검토 이력까지 한곳에서 확인하세요.</p>
  <dl className="overview-metrics">{cards.map(([label,count])=><div key={label}><dt>{label}</dt><dd>{ready?count:'미확인'}</dd></div>)}</dl>
  <p className="overview-caption">{ready?`최근 조회한 최대 50개 평가 기준 · 진행 중 ${records.filter(r=>r.state==='queued').length}개. 프로젝트 전체 통계가 아닙니다.`:state==='loading'?'평가 목록을 조회하고 있습니다. 확인 전에는 건수를 표시하지 않습니다.':'평가 목록을 확인하지 못했습니다. 평가 실행·조회에서 목록을 다시 조회하세요.'} 평가 통과 건수는 현재 릴리스 허용 건수가 아닙니다.</p>
  <div className="overview-actions"><a className="overview-primary" href="#evaluations">{user.role==='viewer'?'평가 근거 살펴보기':'새 평가 준비'}</a><a href="#campaigns">버전·캠페인 열기</a><a href="#history">이력·감사 확인</a></div>
 </section>;
}

export function PlatformScope(){
 return <section id="platform" className="card platform-scope" aria-labelledby="platform-scope-heading" tabIndex={-1}>
  <p className="section-kicker">PLATFORM SCOPE</p><h2 id="platform-scope-heading">플랫폼 지원 범위</h2>
  <p>4320은 Next.js·Java/Spring Boot·Python/FastAPI 기반 AgentTrust의 통합 작업공간입니다. 평가·버전·캠페인·준비 상태·사용량·이력·감사는 같은 로그인과 프로젝트 범위에서 제공합니다.</p>
  <div className="platform-scope-grid"><div><h3>현재 작업공간</h3><ul><li>선택한 평가의 규칙·보관 근거·현재 게이트 확인</li><li>불변 버전과 캠페인·회귀 근거 탐색</li><li>역할에 따른 실행·취소·관리자 검토</li><li>현재 프로젝트의 평가 이력·감사 조회</li></ul></div><div><h3>기존 자료와 이전 범위</h3><p>기존 4310 자료는 보존됩니다. 이 화면에 기존 기록·계정·서명이 자동으로 이전된 것은 아닙니다.</p><p>기존 프로젝트 관리·접근 키 발급·세션 관리와 범용 평가 기능의 전체 이전은 아직 완료되지 않았습니다.</p></div></div>
  <p className="scope-boundary">조회 권한은 쓰기 권한이 아니며, 관리자 승인과 현재 게이트 확인도 실제 배포를 실행하지 않습니다.</p>
 </section>;
}
