import {legacyCatalogueFromFiles} from './catalogue.js';
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cell=value=>'<td>'+escape(value)+'</td>';
/** Always verifies original files; never accepts an unsigned JSON summary as proof. */
export async function legacyCatalogueHtmlFromFiles(options){
 const proof=await legacyCatalogueFromFiles(options);
 const decisions={pass:'과거 통과',block:'과거 차단',inconclusive:'과거 판정 불가'};
 const rows=proof.records.map(record=>{
  const body=record.evidenceBodiesVerified===true&&record.evidenceStructuresVerified===true?'본문·구조 검증':'본문 미검증';
  const review=record.reviewBodyVerified===true?'참조 검토 본문 검증':'검토 본문 검증 없음';
  return '<tr>'+[record.sourceCoordinates.organizationId,record.sourceCoordinates.projectId,record.sourceReceiptId,decisions[record.historicalDecision]??'과거 판정 미확인',body,review,record.sourceReceiptBytesSha256,record.mappingBytesSha256,record.sourceSigningKeyId,...(record.sourceBodyBundleBytesSha256?[record.sourceBodyBundleBytesSha256]:['해당 없음'])].map(cell).join('')+'</tr>';
 }).join('');
 const headers=['원래 조직','원래 프로젝트','원래 기록','과거 판정','본문 근거','검토 근거','원본 기록 SHA-256','연결 설명자 SHA-256','원래 서명 키 지문','본문 봉투 SHA-256'];
 return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>기존 서명 기록 사전검사</title>
<style>body{font-family:system-ui,sans-serif;line-height:1.6;margin:2rem;color:#18342f;background:#f7faf9}main{max-width:100rem;margin:auto}h1{font-size:1.8rem}.notice{border:2px solid #805800;padding:1rem;background:#fff9e9}code,td{overflow-wrap:anywhere}dt{font-weight:bold}dd{margin:0 0 1rem}section[tabindex]{overflow-x:auto}section:focus-visible{outline:3px solid #176a55;outline-offset:4px}table{border-collapse:collapse;min-width:72rem;background:white}caption{text-align:left;font-weight:bold;padding:1rem 0}th,td{vertical-align:top;text-align:left;padding:.75rem;border:1px solid #becdc7}th{background:#e6efeb}footer{margin-top:1.5rem}</style></head>
<body><main><h1>기존 서명 기록 사전검사</h1><p class="notice"><strong>현재 배포 권한 없음 · 자료 가져오기 없음</strong><br>과거 통과는 현재 릴리스 허용이 아닙니다. 이 문서는 새 서명이나 운영자 승인을 제공하지 않습니다. 원본 파일과 독립 지문으로 재검증해야 합니다.</p>
<dl><dt>대상 조직 / 프로젝트</dt><dd><code>${escape(proof.targetCoordinates.organizationId)} / ${escape(proof.targetCoordinates.projectId)}</code></dd><dt>독립 대조한 목록 SHA-256</dt><dd><code>${escape(proof.catalogueBytesSha256)}</code></dd><dt>검증 범위</dt><dd>원래 서명·바이트·출처·연결 설명자 대조 ${proof.verifiedEntries}건. 목록 v${proof.schemaVersion}. 실제 읽은 입력 ${proof.inputBytesRead}바이트 / 상한 ${proof.maximumInputBytes}바이트.</dd></dl>
<section tabindex="0" role="region" aria-label="기존 기록 검증 표 · 좌우 이동"><table><caption>과거 기록의 읽기 전용 대조 결과</caption><thead><tr>${headers.map(h=>'<th scope="col">'+escape(h)+'</th>').join('')}</tr></thead><tbody>${rows}</tbody></table></section>
<footer>목록 자체의 암호 서명·운영자 승인, 현재 출처 키 신뢰 정책·대상 조직 권한, 주체/역할 승계, 현재 검토자·릴리스 권한은 검증하지 않았습니다. 원본 기록을 다시 쓰거나 모델을 재실행하지 않았습니다. 출력에는 모델 입출력·검토 의견·계정·원본 경로를 포함하지 않습니다. 공유 전 조직·프로젝트·기록 식별자와 지문 공개 범위를 확인하세요.</footer></main></body></html>\n`;
}
