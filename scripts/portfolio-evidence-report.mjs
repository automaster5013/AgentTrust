import {loadPortfolioEvidence} from './portfolio-evidence.mjs';

const escape=value=>String(value??'—').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const steps={release_compliant:'정상 응답',release_regression:'업무 회귀',release_missing_evidence:'필수 근거 누락',approval_required:'승인 대기',approval_valid:'당시 승인 후 허용',approval_rejected:'반려 후 차단'};
const decisions={pass:'허용',block:'차단'},manualStates={not_required:'불필요',missing:'승인 대기',approved:'당시 승인',rejected:'반려',expired:'만료',invalid:'유효하지 않음'};
export const evidenceReportReasonLimit=4096;
function reasonText(reasons){
 if(!reasons.length)return '없음 (당시 허용)';
 let text='';
 for(const [index,reason] of reasons.entries()){
  const prefix=index?' · ':'',remaining=evidenceReportReasonLimit-text.length-prefix.length;
  if(remaining<=0)return text+' [긴 이유는 일부만 표시: 원본 자료 확인]';
  const fragment=reason.slice(0,remaining),shown=fragment.trim()?fragment:'<빈 이유 문구>';
  text+=prefix+shown.slice(0,remaining);
  if(reason.length>remaining)return text+' [긴 이유는 일부만 표시: 원본 자료 확인]';
 }
 return text;
}

export const evidenceReportRegressionLimit=20;
export const evidenceReportComparisonFieldLimit=160;
function comparisonDetails(comparison){
 if(!comparison)return '<p>기준 비교 없음</p>';
 const regressions=comparison.regressions;
 const field=value=>{
  if(typeof value!=='string'||!value.trim())return '원본 상태 정보 없음';
  return value.length>evidenceReportComparisonFieldLimit?value.slice(0,evidenceReportComparisonFieldLimit)+' [일부 표시]':value;
 };
 const coverage=comparison.comparable?'완전한 기준 비교':'비교 불완전: 회귀 목록만으로 안전을 판단할 수 없습니다';
 const count=`회귀 항목 ${regressions.length}개 · 표시 ${Math.min(regressions.length,evidenceReportRegressionLimit)}개`;
 const rows=regressions.slice(0,evidenceReportRegressionLimit).map(row=>`<tr><td>${escape(field(row?.caseId))}</td><td>${escape(field(row?.ruleId))}</td><td>${escape(field(row?.before))}</td><td>${escape(field(row?.after))}</td></tr>`).join('');
 const body=rows?`<div class="table-wrap"><table><thead><tr><th>사례</th><th>규칙</th><th>기준 상태</th><th>후보 상태</th></tr></thead><tbody>${rows}</tbody></table></div>`:'<p>원본 회귀 목록에 항목이 없습니다. 당시 게이트와 비교 완전성을 함께 확인하세요.</p>';
 return `<section class="comparison"><h4>당시 기준 대비 회귀 근거</h4><p>${escape(coverage)} · ${escape(count)}</p>${body}${regressions.length>evidenceReportRegressionLimit?'<p>회귀 목록 일부만 표시: 전체 항목은 서명된 원본 자료를 확인하세요.</p>':''}</section>`;
}

// Render only the same bounded buffers authenticated by the offline reader.
// The HTML is a readable derivative, not another signed release artifact.
export async function createPortfolioEvidenceReport(directory,trustedPem,expectedManifestSha256){
 const loaded=await loadPortfolioEvidence(directory,trustedPem,expectedManifestSha256),{manifest,receipts,reviews,verification}=loaded;
 const table=receipts.map((receipt,index)=>{
  const a=receipt.artifact,r=a.result,m=r.manualApproval,c=r.comparison;
  return `<tr><th scope="row">${escape(steps[manifest.receipts[index].step])}</th><td>${escape(decisions[r.decision])}</td><td>${escape(manualStates[m?.status??'not_required'])}</td><td>${escape(c?c.comparable?(c.evaluationPassed??c.deploymentAllowed)?'통과':'회귀 차단':'비교 불가':'기준 비교 없음')}</td><td><code>${escape(a.receiptId)}</code></td></tr>`;
 }).join('');
 const details=receipts.map((receipt,index)=>{
  const a=receipt.artifact,q=a.request;
  const values=[['검증 기록 UUID',a.receiptId],['확인 시각',a.checkedAt],['후보 실행',q.candidateRunId],['기준 실행',q.baselineRunId],['에이전트 버전',q.agentVersionId],['데이터셋 버전',q.datasetVersionId],['정책 버전',q.policyVersionId],['스냅샷 SHA-256',a.evidence.candidate.snapshotHash],['평가 결과 SHA-256',a.evidence.candidate.resultHash],['기록 본문 SHA-256',receipt.artifactHash],['서명 키 ID',receipt.signature.keyId]];
  return `<article><h3>${escape(steps[manifest.receipts[index].step])}</h3><dl>${values.map(([label,value])=>`<dt>${escape(label)}</dt><dd><code>${escape(value)}</code></dd>`).join('')}</dl><p>당시 차단 이유: ${escape(reasonText(a.result.reasons))}</p>${comparisonDetails(a.result.comparison)}</article>`;
 }).join('');
 const opinions=reviews.map(review=>`<article><h3>${review.decision==='approved'?'당시 승인 의견':'반려 의견'}</h3><dl>${[['검토 UUID',review.id],['검토자 UUID',review.actorId],['후보 실행',review.runId],['검토 시각',review.createdAt],['검토 본문 SHA-256',review.reviewHash]].map(([label,value])=>`<dt>${escape(label)}</dt><dd><code>${escape(value)}</code></dd>`).join('')}</dl><pre>${escape(review.comment)}</pre></article>`).join('');
 const html=`<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>AgentTrust 합성 릴리스 감사 자료</title><style>
body{margin:0;background:#f2f5f8;color:#16273b;font:16px/1.6 system-ui,sans-serif}main{max-width:1100px;margin:0 auto;padding:32px 20px}h1{font-size:30px;line-height:1.25}h2{margin-top:36px}h3{font-size:19px}article,.notice,.summary{background:white;border:1px solid #ccd8e2;border-radius:12px;padding:20px;margin:16px 0}.notice{border-left:5px solid #aa5d14}.tag{color:#425b72;font-weight:650}table{width:100%;border-collapse:collapse;background:white}th,td{padding:12px;border:1px solid #ccd8e2;text-align:left;vertical-align:top}thead th{background:#dfe9f2}.table-wrap{overflow-x:auto}code,pre{font:13px/1.6 ui-monospace,monospace;overflow-wrap:anywhere;white-space:pre-wrap}dl{display:grid;grid-template-columns:170px minmax(0,1fr);gap:8px 16px}dt{font-weight:650}dd{margin:0}pre{background:#edf2f6;padding:14px;border-radius:8px}p{overflow-wrap:anywhere}@media(max-width:600px){main{padding:20px 12px}h1{font-size:25px}dl{grid-template-columns:1fr;gap:3px}dd{margin-bottom:10px}article,.notice,.summary{padding:16px}}@media print{body{background:white}main{padding:0}.table-wrap{overflow:visible}article{break-inside:avoid}}
</style></head><body><main><p class="tag">AgentTrust · 합성 시연 · 오프라인 감사 자료</p><h1>평가 근거와 당시 릴리스 판단</h1>
<div class="notice"><strong>현재 배포 허용을 확인한 보고서가 아닙니다.</strong><p>원본 자료의 Ed25519 서명 6개를 지정한 신뢰 공개키로 확인한 후 생성했습니다. 과거 승인·거절과 당시 평가 근거를 보여줍니다. 현재 관리자 권한·승인 유효 시간·현재 게이트는 별도 확인이 필요합니다.</p><p>이 HTML 자체는 서명되지 않은 읽기용 사본입니다. 원본 묶음과 독립 신뢰 공개키로 다시 검증하세요. 실제 고객 연동이나 서버 배포 결과를 나타내지 않습니다.</p></div>
<section class="summary"><h2>자료 검증 범위</h2><p>영수증: 6개 · Ed25519 서명 확인: 6개 · ${verification.reviewBodiesVerifiedOffline?'원래 검토 의견 오프라인 결합: 2개':'검토 의견 본문 미포함 (기존 형식)'}</p><dl><dt>조직 UUID</dt><dd><code>${escape(manifest.organizationId)}</code></dd><dt>프로젝트 UUID</dt><dd><code>${escape(manifest.projectId)}</code></dd><dt>신뢰 공개키 ID</dt><dd><code>${escape(manifest.keyId)}</code></dd><dt>목록 SHA-256</dt><dd><code>${escape(verification.manifestSha256)}</code></dd><dt>지정 목록 해시</dt><dd>${verification.expectedManifestDigestMatched?'일치 (지정 값의 독립 신뢰는 운영자 책임)':'별도 지정하지 않음'}</dd></dl></section>
<h2>여섯 단계의 당시 판단</h2><div class="table-wrap"><table><thead><tr><th>시나리오</th><th>당시 게이트</th><th>관리자 검토</th><th>기준 비교</th><th>검증 기록 UUID</th></tr></thead><tbody>${table}</tbody></table></div>
<h2>원본 기록과 고정 평가 근거</h2>${details}<h2>연결된 원래 검토 의견</h2>${opinions||'<p>이 묶음에는 의견 본문이 없습니다. 의견을 포함하려면 demo:evidence -- --with-reviews로 새 합성 자료를 생성하세요.</p>'}
<p>재검증: <code>npm run demo:evidence:verify -- &lt;원본 묶음 폴더&gt; &lt;독립 신뢰 공개키&gt; &lt;목록 SHA-256&gt;</code></p></main></body></html>`;
 return {html,verification};
}
