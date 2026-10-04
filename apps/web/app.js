const $ = id => document.getElementById(id);
const navigation=[['evaluation','nav-evaluation'],['history','nav-history'],['evidence','nav-evidence'],['review-panel','nav-review'],['release-check-panel','nav-release'],['receipts-panel','nav-receipts'],['versions','nav-versions'],['projects','nav-projects'],['sessions-panel','nav-sessions']];
function updateNavigation(){
  const section=globalThis.location?.hash.slice(1)||'evaluation';
  for(const [target,id] of navigation){const link=$(id),selected=target===section;link.className=selected?'active':'';link.ariaCurrent=selected?'location':null;}
}
function restorePanelLocation(){
  const id=globalThis.location?.hash.slice(1),target=id&&$(id);
  if(target?.getClientRects?.().length)target.scrollIntoView({block:'start'});
}
globalThis.addEventListener?.('hashchange',updateNavigation);updateNavigation();
let currentRun = null;
let evidencePage=0,evidenceCaseId=null;
const evidencePageSize=10;
let actor = null;
let activeProjectId = null;
let scopeEpoch = 0;
let authenticationSequence=0;
let logoutOperation=null;
let issuedKeySequence=0,clipboardOperation=null;
function clearIssuedKey(){
  issuedKeySequence++;clipboardOperation=null;$('ci-key-copy').disabled=false;$('ci-issued-key').value='';$('ci-key-box').hidden=true;
}
function currentAuthentication(sequence,epoch,error){
  return sequence===authenticationSequence&&epoch===scopeEpoch||error?.authenticationSequence===authenticationSequence&&error?.authenticationEpoch===scopeEpoch;
}
let loading = false;
let versionBusy=false;
let workspaceMutation=null;
let selectedRunId = null;
let selectedRunSequence=0;
let cancelOperation=null;
const cancellationPending=()=>cancelOperation?.epoch===scopeEpoch&&cancelOperation?.selection===selectedRunSequence&&cancelOperation?.runId===selectedRunId;
let keyCursor=null,receiptCursor=null,runCursor=null;
let historySequence=0;
let lookupSequence=0,lookupBusy=false;
let auditCursor=null,auditSequence=0;
let inspectionSequence=0,comparisonSequence=0,keyHistorySequence=0,receiptHistorySequence=0,reviewSequence=0;
let receiptInspectionSequence=0,receiptInspectionTrigger=null;
let receiptFilters={decision:'',candidateRunId:''},receiptShown=0;
let reviewBusy=false,reviewCursor=null,reviewShown=0;
let finalGateSequence=0,finalGateBusy=false,currentReceipt=null;
let recentBaselineRuns=[];
function renderBaselineChoices(){
  $('gate-comparison-inputs').hidden=!$('gate-baseline-enabled').checked;
  const selected=$('gate-baseline-id').value.trim().toLowerCase();
  const placeholder=node('option','최근 완료 실행에서 선택 (최대 100개)');placeholder.value='';
  $('gate-baseline-recent').replaceChildren(placeholder,...recentBaselineRuns.filter(r=>r.state==='succeeded'&&r.id!==selectedRunId).map(r=>{const option=node('option',`${r.agentName} · ${r.datasetName} · ${new Date(r.createdAt).toLocaleString('ko-KR')} · ${r.id.slice(0,8)}`);option.value=r.id;return option;}));
  if(recentBaselineRuns.some(r=>r.id===selected&&r.id!==selectedRunId))$('gate-baseline-recent').value=selected;
  $('gate-baseline-recent').disabled=!$('gate-baseline-enabled').checked;
}
function finalComparisonText(comparison){
  if(!comparison||comparison.comparable!==true)return '회귀 비교: 미완료 (비교 가능한 전체 근거가 필요합니다.)\n';
  const passed=(comparison.evaluationPassed??comparison.deploymentAllowed)===true;
  const changes=Array.isArray(comparison.changes)?comparison.changes:[];
  const regressions=Array.isArray(comparison.regressions)?comparison.regressions:[];
  return '회귀 비교: '+(passed?'통과':'차단')+' · 변경 규칙 '+changes.length+'개 · 회귀 '+regressions.length+'개\n'+
    (comparison.requiresManualApproval?'관리자 승인은 별도로 확인합니다.\n':'')+
    regressions.slice(0,10).map(r=>'회귀: 사례 '+r.caseId+' · 규칙 '+r.ruleId+' · '+r.before+' → '+r.after+'\n').join('')+
    (regressions.length>10?'나머지 회귀 '+(regressions.length-10)+'개는 검증 기록 JSON에서 확인하세요.\n':'');
}
function renderRegressionLinks(comparison){
  const runId=selectedRunId,sequence=finalGateSequence,selection=selectedRunSequence,epoch=scopeEpoch;
  const regressions=Array.isArray(comparison?.regressions)?comparison.regressions:[];
  $('gate-regression-links').replaceChildren(...regressions.slice(0,10).filter(r=>currentRun?.results.some(c=>c.caseId===r.caseId)).map(r=>{
    const link=node('a','사례 '+r.caseId+' · 규칙 '+r.ruleId+' 근거 보기','secondary');link.href='#evidence';
    link.addEventListener('click',event=>{
      if(sequence!==finalGateSequence||selection!==selectedRunSequence||epoch!==scopeEpoch||selectedRunId!==runId||currentRun?.id!==runId){event.preventDefault();return;}
      evidenceCaseId=r.caseId;evidencePage=0;$('evidence-search').value='';$('evidence-filter').value='';renderEvidence();
    });return link;
  }));
}
function invalidateFinalGate(text="최종 게이트를 아직 확인하지 않았습니다."){
  renderBaselineChoices();$('gate-regression-links').replaceChildren();
  finalGateSequence++;finalGateBusy=false;currentReceipt=null;$('current-receipt-download').disabled=true;renderNextAction();
  $("manual-gate-output").textContent=text;
  $("release-check-panel").hidden=!currentRun||currentRun.id!==selectedRunId;
  $("manual-gate-check").disabled=!currentRun||currentRun.id!==selectedRunId||!terminal.has(currentRun.state)||reviewBusy;
  updateRunNavigation();
}
function updateRunNavigation(){
  const selected=!!actor&&!!currentRun&&currentRun.id===selectedRunId;
  $('nav-evidence').hidden=!selected;$('nav-release').hidden=!selected;$('nav-review').hidden=!selected||$('review-panel').hidden;
}
function renderNextAction(result){
  const run=currentRun?.id===selectedRunId?currentRun:null;
  let title='평가를 시작하세요',detail=actor?.role==='viewer'?'조회자는 실행 기록에서 평가 근거를 확인할 수 있습니다.':'에이전트·데이터셋·정책 버전을 선택하고 새 평가를 실행하세요.',target=actor?.role==='viewer'?'history':'evaluation',label=actor?.role==='viewer'?'실행 기록 보기':'평가 설정 보기';
  if(run){
    target='evidence';label='평가 근거 보기';
    if(!terminal.has(run.state)){title='평가 완료를 기다리세요';detail='워커가 처리 중입니다. 완료되기 전에는 릴리스를 허용하지 않습니다.';}
    else if(run.gate.decision==='block'){title='실패한 근거를 확인하고 수정하세요';detail='필수 규칙과 통과율을 확인하세요. 변경은 새 버전으로 등록하고 다시 평가해야 합니다.';}
    else if(run.gate.decision!=='pass'){title='누락된 근거와 실행 오류를 확인하세요';detail='취소·시간 초과·증거 누락은 통과가 아닙니다. 원인을 해결한 뒤 새 평가를 실행하세요.';}
    else if(result?.reasons?.includes('Result is missing, stale or future-dated.')){title='결과 유효 시간을 확인하고 다시 평가하세요';detail='평가 결과가 없거나 오래됐거나 미래 시각입니다. 현재 유효한 결과로 최종 게이트를 다시 확인하세요.';target='evaluation';label='새 평가 설정 보기';}
    else if(result?.deploymentAllowed===true){title='확인 기록을 보관하고 배포 직전에 다시 검증하세요';detail='이 결과는 확인 시점의 판단입니다. CI에서 새 최종 게이트를 확인한 뒤 배포 절차를 진행하세요.';target='receipts-panel';label='검증 기록 보기';}
    else if(result?.manualApproval&&result.manualApproval.status!=='approved'){
      title={missing:'관리자 검토를 요청하세요',rejected:'반려 의견을 확인하세요',expired:'관리자 승인을 다시 요청하세요',invalid:'승인 근거와 검토자 상태를 확인하세요'}[result.manualApproval.status]||'관리자 검토 상태를 확인하세요';
      detail=actor?.role==='admin'?'평가 근거와 검토 이력을 확인하고 검토를 기록한 뒤 최종 게이트를 다시 확인하세요.':'관리자에게 근거 검토를 요청하세요. 현재 권한으로 승인 기록을 작성할 수 없습니다.';target='review-panel';label='릴리스 검토 보기';
    }
    else if(result){title='최종 게이트의 차단 사유를 확인하세요';detail='버전·근거·유효 시간 등 차단 사유를 해결한 뒤 다시 확인하세요. 평가 통과만으로 릴리스할 수 없습니다.';target='release-check-panel';label='최종 게이트 보기';}
    else if(run.gate.requiresManualApproval){title='관리자 검토와 최종 확인이 필요합니다';detail=actor?.role==='admin'?'평가 근거를 검토하고 승인 여부를 기록하세요. 기존 승인이 있다면 최종 게이트에서 유효성을 확인하세요.':'관리자 검토를 요청하세요. 기존 승인이 있다면 최종 게이트에서 유효성을 확인할 수 있습니다.';target='review-panel';label='릴리스 검토 보기';}
    else{title='최종 릴리스 게이트를 확인하세요';detail='평가 기준을 통과했습니다. 고정 버전·근거·유효 시간을 최종 게이트에서 함께 확인하세요.';target='release-check-panel';label='최종 게이트 보기';}
  }
  $('next-action-title').textContent=title;$('next-action-detail').textContent=detail;$('next-action-link').textContent=label;$('next-action-link').href='#'+target;
}
function releaseReason(reason){
  const labels={'Result is missing, stale or future-dated.':'평가 결과가 없거나 유효 시간이 지났거나 미래 시각입니다.','A completed passing evaluation is required.':'완료된 통과 평가가 필요합니다.','Evidence integrity verification failed.':'평가 근거의 무결성 검증에 실패했습니다.','Evidence structure, version binding or summary is inconsistent.':'근거 구조·고정 버전·요약이 일치하지 않습니다.','Evaluation coverage is incomplete.':'평가 사례의 근거가 완전하지 않습니다.','Baseline comparison is incomplete or regressed.':'기준 실행 비교가 불완전하거나 회귀했습니다.','A required rule failed.':'필수 규칙이 실패했습니다.'};
  if(reason.startsWith('A current administrator approval'))return '현재 유효한 관리자 승인이 필요합니다.';
  if(reason.startsWith('Version mismatch:'))return '요청한 버전과 평가 실행의 고정 버전이 일치하지 않습니다.';
  return labels[reason]||reason;
}
// Compare JSON structure without depending on object key order or recursive stack depth.
// This binds the displayed result to the record; trusted-key signature verification remains a CLI responsibility.
function sameReleaseJson(left,right){
  const pending=[[left,right,0]];let visited=0;
  while(pending.length){
    const [a,b,depth]=pending.pop();if(++visited>100000||depth>64)return false;
    if(a===b)continue;
    if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
    const keys=Object.keys(a),other=Object.keys(b);if(keys.length!==other.length)return false;
    for(const key of keys){if(!Object.hasOwn(b,key))return false;pending.push([a[key],b[key],depth+1]);}
  }
  return true;
}
function matchesHistoricalReceipt(data,record,organizationId,projectId){
  const artifact=data?.artifact,baseline=record.baseline_run_id??null,signature=data?.signature;
  const checked=Date.parse(artifact?.checkedAt),listed=Date.parse(record.created_at);
  return !!organizationId&&artifact?.schemaVersion===1&&artifact.receiptId===record.id&&artifact.organizationId===organizationId&&artifact.projectId===projectId&&
    /^[a-f0-9]{64}$/.test(record.artifact_hash||'')&&data.artifactHash===record.artifact_hash&&Number.isFinite(checked)&&checked===listed&&
    artifact.request?.candidateRunId===record.candidate_run_id&&artifact.result?.runId===record.candidate_run_id&&artifact.evidence?.candidate?.runId===record.candidate_run_id&&
    (artifact.request?.baselineRunId??null)===baseline&&(baseline?artifact.evidence?.baseline?.runId===baseline:!Object.hasOwn(artifact.evidence??{},'baseline'))&&
    ['pass','block'].includes(record.decision)&&artifact.result.decision===record.decision&&artifact.result.deploymentAllowed===(record.decision==='pass')&&
    (record.signing_key_id?signature?.keyId===record.signing_key_id&&signature.algorithm==='Ed25519'&&/^[A-Za-z0-9+/]{86}==$/.test(signature.value||''):signature===undefined);
}
async function verifyArtifactBody(artifact,expectedHash){
  if(!/^[a-f0-9]{64}$/.test(expectedHash||''))throw Error('검증 기록의 본문 해시가 없습니다.');
  let visited=0;
  const canonical=(value,depth=0)=>{
    if(++visited>100000||depth>64)throw Error('검증 기록의 본문이 검증 한도를 초과했습니다.');
    if(value===null||typeof value==='string'||typeof value==='boolean')return value;
    if(typeof value==='number'&&Number.isFinite(value))return value;
    if(!value||typeof value!=='object')throw Error('검증 기록의 본문 형식이 올바르지 않습니다.');
    const keys=Object.keys(value);if(keys.length>100000-visited)throw Error('검증 기록의 본문이 검증 한도를 초과했습니다.');
    return Array.isArray(value)?value.map(item=>canonical(item,depth+1)):Object.fromEntries(keys.sort().map(key=>[key,canonical(value[key],depth+1)]));
  };
  const bytes=new TextEncoder().encode(JSON.stringify(canonical(artifact)));
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  const actual=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
  if(actual!==expectedHash)throw Error('검증 기록의 본문 해시가 저장된 기록과 일치하지 않습니다.');
}
async function verifyHistoricalReceipt(data,record,organizationId,projectId){
  if(!matchesHistoricalReceipt(data,record,organizationId,projectId))throw Error('검증 기록이 선택한 기록과 현재 조직·프로젝트 범위에 일치하지 않습니다.');
  await verifyArtifactBody(data.artifact,record.artifact_hash);
}
function clearReceiptInspection(restoreFocus=false){
  const trigger=receiptInspectionTrigger;receiptInspectionTrigger=null;receiptInspectionSequence++;$('receipt-inspection').hidden=true;$('receipt-inspection-output').textContent='';if(restoreFocus===true){if(trigger?.isConnected&&!trigger.disabled)trigger.focus?.();else $('receipts-panel').focus?.();}
}
function receiptInspectionText(data){
  const artifact=data.artifact,{request,result}=artifact;
  if(!Array.isArray(result.reasons)||!result.reasons.every(reason=>typeof reason==='string'&&reason.length<=500))throw Error('Invalid historical reasons');
  const approvals={approved:'승인 유효',rejected:'반려',missing:'승인 대기',expired:'승인 만료',invalid:'승인 무효'};
  if(result.manualApproval&&(!Object.hasOwn(approvals,result.manualApproval.status)||result.manualApproval.required!==true))throw Error('Invalid historical approval');
  if(result.comparison){
    const c=result.comparison;
    if(c.candidateRunId!==request.candidateRunId||c.baselineRunId!==request.baselineRunId||typeof c.comparable!=='boolean'||typeof(c.evaluationPassed??c.deploymentAllowed)!=='boolean'||!Array.isArray(c.changes)||!Array.isArray(c.regressions)||c.changes.length>2000||c.regressions.length>2000)throw Error('Invalid historical comparison');
    for(const r of c.regressions.slice(0,10))if(!['caseId','ruleId','before','after'].every(key=>typeof r[key]==='string'&&r[key].length<=100))throw Error('Invalid historical regression');
  }
  const version=key=>typeof request[key]==='string'&&request[key].length<=80?request[key]:'(미지정)';
  const evidence=artifact.evidence.candidate;
  const evidenceHash=key=>typeof evidence[key]==='string'&&evidence[key].length<=64?evidence[key]:'(기록 없음)';
  const lines=[`과거 확인 시점의 판정: ${decisionLabels[result.decision]}`,`검증 기록 ${artifact.receiptId}`,`확인 시각 ${artifact.checkedAt}`,`후보 실행 ${request.candidateRunId}`,`기준 실행 ${request.baselineRunId||'제외'}`,`에이전트 버전 ${version('agentVersionId')}`,`데이터셋 버전 ${version('datasetVersionId')}`,`정책 버전 ${version('policyVersionId')}`,`관리자 검토: ${approvals[result.manualApproval?.status]||'불필요'}`,result.comparison?finalComparisonText(result.comparison).trim():'회귀 비교: 제외',`차단 사유: ${result.reasons.length?result.reasons.slice(0,20).map(releaseReason).join('\n'):'없음'}`];
  if(result.reasons.length>20)lines.push(`나머지 사유 ${result.reasons.length-20}개는 기록 JSON에서 확인하세요.`);
  lines.push(`후보 스냅샷 해시 ${evidenceHash('snapshotHash')}`,`후보 결과 해시 ${evidenceHash('resultHash')}`,`본문 SHA-256 확인됨: ${data.artifactHash}`,data.signature?`서명 포함 · 키 ${data.signature.keyId} · 공개키 검증은 별도 CLI`:'서명 없음 · 본문 해시 확인은 발급자 서명 검증이 아닙니다.');
  return lines.join('\n');
}
function historicalReviewReference(artifact){
  const manual=artifact.result.manualApproval;
  if(!manual?.reviewId&&!manual?.reviewHash)return null;
  const valid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
  if(!valid(manual.reviewId)||!valid(artifact.request.candidateRunId)||!/^[a-f0-9]{64}$/.test(manual.reviewHash||''))throw Error('Invalid historical review reference');
  return {reviewId:manual.reviewId,runId:artifact.request.candidateRunId};
}
async function historicalReviewText(artifact,review){
  const manual=artifact.result.manualApproval,reference=historicalReviewReference(artifact);
  if(!reference||review?.schemaVersion!==1||review.id!==reference.reviewId||review.runId!==reference.runId||review.organizationId!==artifact.organizationId||review.projectId!==artifact.projectId||review.reviewHash!==manual.reviewHash||review.snapshotHash!==artifact.evidence.candidate.snapshotHash||review.resultHash!==artifact.evidence.candidate.resultHash||typeof review.actorId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(review.actorId)||typeof review.comment!=='string'||review.comment.length>500||!['approved','rejected'].includes(review.decision)||['approved','expired'].includes(manual.status)&&review.decision!=='approved'||manual.status==='rejected'&&review.decision!=='rejected'||manual.status==='missing'||!Number.isFinite(Date.parse(review.createdAt))||Date.parse(review.createdAt)>Date.parse(artifact.checkedAt))throw Error('Historical review mismatch');
  const {reviewHash,...payload}=review;await verifyArtifactBody(payload,manual.reviewHash);
  return `연결된 과거 검토 근거 (본문 해시 확인)\n검토 기록 ${review.id}\n검토자 ID ${review.actorId}\n검토 시각 ${review.createdAt}\n검토 결정 ${review.decision==='approved'?'승인':'반려'}\n검토 의견 ${review.comment||'(의견 없음)'}\n검토 본문 SHA-256 ${reviewHash}\n이 과거 검토는 현재 승인 상태나 검토자의 현재 권한을 확인하지 않습니다.`;
}
clearReceiptInspection();
let sessionCursor=null,sessionSequence=0,sessionBusy=false,sessionButtons=[];
const terminal = new Set(['succeeded', 'failed', 'cancelled', 'timed_out']);
const decisionLabels = { pass: '통과', block: '차단', inconclusive: '판정 불가' };
const stateLabels = { queued: '대기 중', running: '실행 중', succeeded: '평가 완료', failed: '실행 실패', cancelled: '취소됨', timed_out: '시간 초과' };
function message(text, error = false) { $('status').textContent = text; $('status').className = error ? 'error' : ''; }
async function listAction(work,generation,onError=error=>message(error.message,true),restore){
  const epoch=scopeEpoch;let sequence;
  try{const pending=work();sequence=generation();await pending;}
  catch(error){if(epoch===scopeEpoch&&sequence===generation()){onError(error);restore?.();}}
}
async function readApiResponse(response){
  const reader=response.body?.getReader();if(!reader)throw new Error('Missing API response body.');
  const chunks=[];let bytes=0;
  try{
    for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;
      if(bytes>8*1024*1024){await reader.cancel();throw new Error('API response exceeds size limit.');}chunks.push(value);
    }
  }finally{reader.releaseLock();}
  const body=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.byteLength;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body));
}
async function api(path, options = {}) {
  const epoch=scopeEpoch;
  let response,data;
  try{
    response=await fetch(path,{...options,signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json','X-AgentTrust-Request':'local-ui',...(activeProjectId?{'X-AgentTrust-Project':activeProjectId}:{}),...options.headers}});
    data=await readApiResponse(response);
  }catch(error){
    if(epoch!==scopeEpoch)throw new Error('워크스페이스가 변경되어 이전 요청의 결과를 표시하지 않습니다.');
    if(error.name==='TimeoutError')throw new Error('요청 시간이 초과됐습니다. 서버에서 처리됐을 수 있으므로 기록을 조회한 뒤 다시 시도하세요.');
    throw new Error('서버 응답을 읽지 못했습니다. 기록을 조회한 뒤 다시 시도하세요.');
  }
  if(epoch!==scopeEpoch)throw new Error('워크스페이스가 변경되어 이전 요청의 결과를 표시하지 않습니다.');
  if (!response.ok){
    const error=new Error(typeof data?.error==='string'&&data.error.length<=500?data.error:'요청을 완료하지 못했습니다.');
    if(response.status===401){showLogin();error.authenticationSequence=authenticationSequence;error.authenticationEpoch=scopeEpoch;}
    throw error;
  }
  return data;
}
function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
async function catalog(selectedDataset) {
  const epoch=scopeEpoch,data=await api('/v1/catalog');if(epoch!==scopeEpoch)return;
  inspectionSequence++;$('version-inspection-output').textContent='';$('version-inspection-meta').textContent='선택한 버전의 고정된 내용과 해시를 확인할 수 있습니다.';
  for (const [kind, id] of [['agent', 'agent'], ['dataset', 'dataset-select'], ['policy', 'policy']]) {
    const select = $(id); const previous = typeof selectedDataset==='object' && selectedDataset?.[kind] ? selectedDataset[kind] : kind === 'dataset' && typeof selectedDataset==='string' ? selectedDataset : select.value;
    select.replaceChildren(...data[kind].map(v => {
      const option = node('option', `${v.name}${v.cases ? ` · ${v.cases}개 사례` : ''}${kind==='policy'?` · ${Math.round(v.minimumPassRate*100)}%${v.requiresManualApproval?' · 관리자 검토':''}`:''}`);
      option.value = v.id; return option;
    }));
    if (data[kind].some(v => v.id === previous)) select.value = previous;
    else if(kind==='agent') select.value=data.agent.find(v=>v.mode==='compliant')?.id || select.value;
  }
  updateButtons();
}
function updateButtons(){
  workspaceControls();
  const writer=actor&&actor.role!=='viewer';
  for(const [kind,id] of [['agent','agent'],['dataset','dataset-select'],['policy','policy']])$('inspect-'+kind).disabled=!$(id).value;
  $('dataset-copy').disabled=!writer||!$('dataset-select').value;
  $('run-button').disabled=!writer||loading||!$('agent').value||!$('dataset-select').value||!$('policy').value;
  $('dataset-button').disabled=!writer||versionBusy;$('agent-create').disabled=!writer||versionBusy;$('policy-create').disabled=actor?.role!=='admin'||versionBusy;
}
function workspaceControls(){
  const busy=workspaceMutation!==null;
  $('workspace-project').disabled=busy;$('logout-button').disabled=busy||logoutOperation!==null;
  for(const id of ['ci-create','project-create'])$(id).disabled=busy||actor?.role!=='admin';
}
function render(run) {
  if(currentRun?.id===run.id&&terminal.has(currentRun.state)&&!terminal.has(run.state))return false;
  comparisonSequence++;
  if(currentRun?.id!==run.id){reviewCursor=null;reviewShown=0;$('review-history-status').textContent='';$('review-more').disabled=true;$('review-comment').value='';$('manual-gate-output').textContent='';evidencePage=0;evidenceCaseId=null;$('evidence-search').value='';$('evidence-filter').value='';}
  currentRun = run;
  invalidateFinalGate();
  $('comparison-result').textContent='후보 실행을 조회한 뒤 기준 실행을 선택하세요.';
  const decision = run.gate.decision;
  $('gate-badge').textContent = decision.toUpperCase(); $('gate-badge').className = `gate ${decision}`;
  $('gate-title').textContent = { pass: '정의된 배포 기준을 통과했습니다', block: '배포를 차단해야 합니다', inconclusive: '추가 검증이 필요합니다' }[decision];
  const reasons = { 'Evaluation worker returned inconsistent evidence.':'평가 근거가 규칙·요약과 일치하지 않습니다. 배포를 허용하지 않습니다.', 'Evaluation evidence is invalid or exceeded its result budget.':'평가 근거가 올바르지 않거나 결과 예산을 초과했습니다. 배포를 허용하지 않습니다.', 'A required rule failed.': '필수 규칙이 실패했습니다. 사례별 근거를 확인하고 변경을 수정하세요.', 'Required evaluation evidence is incomplete.': '실행 오류 또는 필수 증거 누락으로 안전하게 판단할 수 없습니다.', 'The policy pass rate threshold was not met.': '정책에서 요구하는 규칙 통과율을 충족하지 못했습니다.', 'All required rules passed and the policy threshold was met.': '모든 필수 규칙과 통과율 조건을 충족했습니다. 판정은 해당 테스트 범위에 한정됩니다.', 'Evaluation has not completed.': '평가가 완료될 때까지 배포를 허용하지 않습니다.', 'Evaluation was cancelled.': '실행을 취소했습니다. 완료되지 않은 평가는 배포를 허용하지 않습니다.', 'Evaluation exceeded its time budget.': '설정한 시간 예산을 초과했습니다. 배포를 허용하지 않습니다.', 'Evaluation exceeded its case budget.': '설정한 사례 예산을 초과했습니다. 배포를 허용하지 않습니다.' };
  $('gate-reason').textContent = reasons[run.gate.reason] || run.gate.reason;
  $('allowed').textContent = run.gate.requiresManualApproval&&run.gate.evaluationPassed?'관리자 승인 필요':run.gate.deploymentAllowed ? '허용' : '허용 안 함';
  if(run.gate.requiresManualApproval&&run.gate.evaluationPassed)$('gate-title').textContent='평가 통과 · 관리자 검토가 필요합니다';
  $('run-state').textContent = stateLabels[run.state] || run.state;
  for (const [key, id] of [['cases', 'case-count'], ['pass', 'pass-count'], ['fail', 'fail-count'], ['inconclusive', 'unknown-count']]) $(id).textContent = run.summary?.[key] ?? '—';
  $('snapshot').textContent = `실행 ${run.id}\n에이전트 ${run.snapshot.agent.name} · 데이터셋 ${run.snapshot.dataset.name} · 정책 ${run.snapshot.policy.name}\n스냅샷 SHA-256 ${run.snapshotHash}`;
  $('download').disabled = !terminal.has(run.state);
  $('cancel-button').disabled = terminal.has(run.state) || actor?.role === 'viewer' || cancellationPending();
  renderEvidence();
  return true;
}
function renderEvidence(){
  const run=currentRun,results=run?.results||[],search=$('evidence-search').value.trim().toLocaleLowerCase(),filter=$('evidence-filter').value;
  const matches=results.filter(c=>{
    if(evidenceCaseId!==null&&c.caseId!==evidenceCaseId)return false;
    if(search&&!`${c.caseId} ${c.input}`.toLocaleLowerCase().includes(search))return false;
    if(filter==='fail')return c.rules.some(r=>r.status==='fail');
    if(filter==='inconclusive')return !!c.error||c.rules.some(r=>r.status==='inconclusive');
    if(filter==='pass')return !c.error&&c.rules.length>0&&c.rules.every(r=>r.status==='pass');
    return true;
  });
  evidencePage=Math.min(evidencePage,Math.max(0,Math.ceil(matches.length/evidencePageSize)-1));
  const start=evidencePage*evidencePageSize,visible=matches.slice(start,start+evidencePageSize);
  $('evidence-focus').textContent=evidenceCaseId===null?'':'선택 사례: '+evidenceCaseId;
  $('evidence-focus-clear').hidden=evidenceCaseId===null;
  $('evidence-search').disabled=!run;$('evidence-filter').disabled=!run;
  $('evidence-previous').disabled=!run||evidencePage===0;$('evidence-next').disabled=!run||start+evidencePageSize>=matches.length;
  $('evidence-count').textContent=!run?'실행을 선택하면 사례를 찾아볼 수 있습니다.':matches.length?`일치 ${matches.length} / 전체 ${results.length}개 사례 · ${start+1}–${start+visible.length} 표시`:`일치 0 / 전체 ${results.length}개 사례`;
  const cards = visible.map(c => {
    const card = node('article', undefined, 'case');
    card.append(node('h3', c.caseId), node('div', '입력', 'case-label'), node('pre', c.input), node('div', '에이전트 출력', 'case-label'), node('pre', c.error || c.evidence.output || '(출력 증거 없음)'));
    card.append(node('div', '도구 이벤트', 'case-label'), node('pre', JSON.stringify(c.evidence.toolEvents ?? '(증거 없음)', null, 2)));
    for (const r of c.rules) {
      const row = node('div', undefined, 'rule-row');
      const detail = node('div', undefined, 'rule-info'); detail.append(node('strong', `${r.ruleId} · ${r.required ? '필수' : '선택'}`), node('span', r.reason));
      row.append(node('span', { pass: 'PASS', fail: 'FAIL', inconclusive: 'INCONCLUSIVE' }[r.status], `chip ${r.status}`), detail); card.append(row);
    }
    return card;
  });
  $('results').replaceChildren(...(cards.length ? cards : [node('div', !run?'첫 평가를 실행해 규칙별 판정과 에이전트 출력을 확인하세요.':results.length?'검색·필터에 맞는 사례가 없습니다.':terminal.has(run.state)?'실행이 종료됐습니다. 확정된 사례 결과가 없습니다.':'평가 결과를 기다리고 있습니다.', 'empty')]));
}
for(const id of ['evidence-search','evidence-filter'])$(id).addEventListener(id==='evidence-search'?'input':'change',()=>{evidenceCaseId=null;evidencePage=0;renderEvidence();});
$('evidence-focus-clear').addEventListener('click',()=>{evidenceCaseId=null;evidencePage=0;renderEvidence();});
$('evidence-previous').addEventListener('click',()=>{evidencePage=Math.max(0,evidencePage-1);renderEvidence();});
$('evidence-next').addEventListener('click',()=>{evidencePage++;renderEvidence();});
async function history(append=false) {
  if(append&&!runCursor)return;
  const sequence=++historySequence,params=new URLSearchParams({limit:'25'});
  if($('history-state').value)params.set('state',$('history-state').value);
  if($('history-decision').value)params.set('decision',$('history-decision').value);
  if(append)params.set('cursor',runCursor);
  const [page,baselines]=await Promise.all([api('/v1/runs?'+params.toString()),append?Promise.resolve(null):api('/v1/runs?limit=100&state=succeeded')]);
  if(sequence!==historySequence)return;
  runCursor=page.nextCursor;$('history-more').disabled=!runCursor;
  if(!append){
  const runs=baselines.items;recentBaselineRuns=runs;renderBaselineChoices();
  const previous=$('baseline-run').value;
  $('baseline-run').replaceChildren(...runs.map(r=>{const option=node('option',`${r.agentName} · ${stateLabels[r.state]} · ${r.id.slice(0,8)}`);option.value=r.id;return option;}));
  if(runs.some(r=>r.id===previous))$('baseline-run').value=previous;
  $('history-body').replaceChildren();
  }
  $('history-body').append(...page.items.map(r => {
    const row = node('tr');
    row.append(node('td', r.agentName), node('td', r.datasetName), node('td', stateLabels[r.state] || r.state));
    const gate = node('td'); gate.append(node('span', decisionLabels[r.gate.decision]+(r.gate.requiresManualApproval&&r.gate.evaluationPassed?' · 관리자 검토':''), `chip ${r.gate.decision}`));
    const action = node('td'); const button = node('button', '조회', 'secondary');
    button.addEventListener('click', () => listAction(()=>selectRun(r.id),()=>selectedRunSequence)); action.append(button);
    row.append(gate, node('td', new Date(r.createdAt).toLocaleString('ko-KR')), action); return row;
  }));
}
async function selectRun(id,initialRun) {
  selectedRunId = id;const sequence=++selectedRunSequence;$('receipt-navigation-status').textContent='';invalidateFinalGate();
  reviewSequence++;$('review-panel').hidden=true;$('review-approve').disabled=true;$('review-reject').disabled=true;$('review-more').disabled=true;$('cancel-button').disabled=true;$('download').disabled=true;updateRunNavigation();
  for (let attempt = 0; attempt < 800; attempt++) {
    const run = attempt===0&&initialRun?initialRun:await api(`/v1/runs/${id}`);
    if (selectedRunId !== id||sequence!==selectedRunSequence) return;
    if(!render(run))return;await reviewHistory(run);
    if (terminal.has(run.state)) { await history(); await auditHistory(); return; }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error('평가가 아직 완료되지 않았습니다. 실행 기록에서 다시 조회하세요.');
}
$('run-form').addEventListener('submit', async event => {
  event.preventDefault(); if (loading) return;
  const epoch=scopeEpoch;let selection=selectedRunSequence;
  const isCurrent=()=>epoch===scopeEpoch&&selection===selectedRunSequence;
  loading = true; $('run-button').disabled = true; message('평가 실행을 요청했습니다…');
  try {
    const run = await api('/v1/runs', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ agentVersionId: $('agent').value, datasetVersionId: $('dataset-select').value, policyVersionId: $('policy').value, timeoutMs: Number($('timeout-ms').value), caseBudget: Number($('case-budget').value) }) });
    if(!isCurrent())return;selection=selectedRunSequence+1;
    await selectRun(run.id);if(isCurrent())message('평가가 종료되었습니다. 게이트 판정과 근거를 확인하세요.');
  } catch (e) { if(isCurrent())message(e.message, true); }
  finally { if(epoch===scopeEpoch){loading = false; updateButtons();} }
});
$('dataset-form').addEventListener('submit', async event => {
  event.preventDefault();if(versionBusy||$('dataset-button').disabled)return;const epoch=scopeEpoch;versionBusy=true;updateButtons();
  try {
    const value = JSON.parse($('dataset-json').value);
    const version = await api('/v1/dataset-versions', { method: 'POST', body: JSON.stringify(value) });
    if(epoch!==scopeEpoch)return;await catalog(version.id);if(epoch===scopeEpoch)message(`데이터셋 새 버전을 등록했습니다: ${version.name}`);
  } catch (e) { if(epoch===scopeEpoch)message(e.message, true); }
  finally { if(epoch===scopeEpoch){versionBusy=false;updateButtons();} }
});
$('download').addEventListener('click', () => {
  if (!currentRun||currentRun.id!==selectedRunId||!terminal.has(currentRun.state)) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(currentRun, null, 2)], { type: 'application/json' }));
  const link = node('a'); link.href = url; link.download = `agenttrust-${currentRun.id}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
function clearProjectData(){
  cancelOperation=null;
  $('workspace-nav').hidden=true;$('nav-projects').hidden=true;
  $('operations-refresh').disabled=false;
  reviewBusy=false;loading=false;versionBusy=false;workspaceMutation=null;workspaceControls();
  recentBaselineRuns=[];
  $('gate-baseline-enabled').checked=false;$('gate-baseline-id').value='';$('gate-baseline-id').disabled=true;
  lookupSequence++;lookupBusy=false;$('run-lookup-button').disabled=false;$('run-lookup-id').value='';$('run-lookup-status').textContent='';$('receipt-navigation-status').textContent='';
  evidencePage=0;evidenceCaseId=null;$('evidence-search').value='';$('evidence-filter').value='';
  sessionSequence++;sessionBusy=false;sessionCursor=null;sessionButtons=[];$('session-list').replaceChildren();$('sessions-status').textContent='';$('sessions-more').disabled=true;sessionControls();
  comparisonSequence++;keyHistorySequence++;receiptHistorySequence++;reviewSequence++;reviewCursor=null;reviewShown=0;$('review-history-status').textContent='';$('review-more').disabled=true;
  inspectionSequence++;$('version-inspection-output').textContent='';$('version-inspection-meta').textContent='선택한 버전의 고정된 내용과 해시를 확인할 수 있습니다.';
  auditSequence++;auditCursor=null;$('audit-more').disabled=true;$('audit-action').value='';
  currentRun=null;invalidateFinalGate();renderEvidence();selectedRunId=null;selectedRunSequence++;historySequence++;runCursor=null;$('history-more').disabled=true;$('history-state').value='';$('history-decision').value='';message('');$('run-button').disabled=true;$('dataset-button').disabled=true;
  for(const id of ['agent-name','policy-name','project-name'])$(id).value='';
  for(const id of ['agent','dataset-select','policy'])$(id).replaceChildren();
  receiptFilters={decision:'',candidateRunId:''};receiptShown=0;$('receipt-decision').value='';$('receipt-candidate-id').value='';$('receipt-filter-status').textContent='';
  keyCursor=null;receiptCursor=null;$('ci-more').disabled=true;$('receipts-more').disabled=true;
  clearIssuedKey();clearReceiptInspection();$('ci-key-list').replaceChildren();$('receipt-list').replaceChildren();$('ci-project').replaceChildren();$('ci-name').value='';$('ci-status').textContent='';
  $('baseline-run').replaceChildren();$('comparison-result').textContent='';
$('results').replaceChildren();$('history-body').replaceChildren();$('audit-list').replaceChildren();
  $('gate-badge').textContent='실행 대기';$('gate-badge').className='gate idle';$('gate-title').textContent='배포 판단을 기다립니다';
  $('gate-reason').textContent='평가를 실행하면 정책을 기준으로 결과를 표시합니다.';$('allowed').textContent='—';$('run-state').textContent='대기';
  $('snapshot').textContent='아직 선택한 실행이 없습니다.';$('dataset-json').value='';$('usage-summary').textContent='';
  $('review-panel').hidden=true;$('review-list').replaceChildren();$('review-comment').value='';$('manual-gate-output').textContent='';
  $('operations-detail').textContent='';$('operations-alert').textContent='';
  for(const id of ['worker-signal','queue-waiting','queue-running','queue-overdue'])$(id).textContent='—';
  for(const id of ['case-count','pass-count','fail-count','unknown-count'])$(id).textContent='—';
  $('download').disabled=true;$('cancel-button').disabled=true;
}
function showLogin(){
  authenticationSequence++;logoutOperation=null;$('login-button').disabled=false;$('logout-button').disabled=false;
  scopeEpoch++;activeProjectId=null;actor=null;clearProjectData();
  $('workspace-project').replaceChildren();$('access-key').value='';$('loading-panel').hidden=true;$('workspace-ui').hidden=true;$('login-panel').hidden=false;
}
async function auditHistory(append=false) {
  if(actor?.role!=='admin'||append&&!auditCursor)return;
  const sequence=++auditSequence,params=new URLSearchParams({limit:'25'});
  if($('audit-action').value)params.set('action',$('audit-action').value);
  if(append)params.set('cursor',auditCursor);
  const [page,usage,operations]=await Promise.all([api('/v1/audit-events?'+params),append?null:api('/v1/usage'),append?null:api('/v1/operations')]);
  if(sequence!==auditSequence)return;
  auditCursor=page.nextCursor;$('audit-more').disabled=!auditCursor;
  if(!append){renderOperations(operations);
    $('usage-summary').textContent=`조직 전체 완료 실행 ${usage.completed_runs}개 · 결과 사례 ${usage.evaluated_cases}개 · 시도 ${usage.attempts}회 (모의 사용량)`;
    $('audit-list').replaceChildren();}
  $('audit-list').append(...page.items.map(e=>{
    const row=node('div',undefined,'audit-entry');row.append(node('strong',e.action+' '),node('span',`${new Date(e.created_at).toLocaleString('ko-KR')} · ${e.resource_id || '—'}`));return row;
  }));
  if(!append&&!page.items.length)$('audit-list').textContent='선택한 동작의 감사 기록이 없습니다.';
}
async function initialize() {
  const epoch=scopeEpoch,assertCurrent=()=>{if(epoch!==scopeEpoch)throw new Error('워크스페이스가 변경되어 이전 요청의 결과를 표시하지 않습니다.');};
  $('loading-panel').hidden=false;$('workspace-ui').hidden=true;$('login-panel').hidden=true;
  const identity=await api('/v1/me');assertCurrent();actor=identity;activeProjectId=actor.projectId;renderNextAction();
  $('workspace-project').replaceChildren(...actor.projects.map(p=>{const option=node('option',p.name);option.value=p.id;return option;}));$('workspace-project').value=activeProjectId;
  $('identity-label').textContent=`${actor.organizationName} · ${actor.name} · ${actor.role}`;
  $('audit-panel').hidden=actor.role!=='admin';
  $('ci-panel').hidden=actor.role!=='admin';$('projects').hidden=actor.role!=='admin';$('operations-panel').hidden=actor.role!=='admin';
  $('ci-project').replaceChildren(...actor.projects.map(p=>{const option=node('option',p.name);option.value=p.id;return option;}));
  $('ci-project').value=activeProjectId;
  for(const load of [ciHistory,receiptHistory,sessionHistory,catalog]){await load();assertCurrent();}
  const sample=await api('/v1/sample-dataset');assertCurrent();$('dataset-json').value=JSON.stringify(sample,null,2);
  await history();assertCurrent();await auditHistory();assertCurrent();
  updateButtons();$('loading-panel').hidden=true;$('workspace-ui').hidden=false;$('login-panel').hidden=true;
  $('nav-projects').hidden=actor.role!=='admin';$('workspace-nav').hidden=false;updateRunNavigation();updateNavigation();restorePanelLocation();
}
$('login-form').addEventListener('submit',async event=>{
  event.preventDefault();if($('login-button').disabled)return;const sequence=++authenticationSequence,epoch=scopeEpoch;$('login-button').disabled=true;$('login-status').textContent='';
  try{const accessKey=$('access-key').value;await api('/v1/auth/login',{method:'POST',body:JSON.stringify({accessKey})});if(!currentAuthentication(sequence,epoch))return;$('access-key').value='';await initialize();}
  catch(e){if(currentAuthentication(sequence,epoch,e)){showLogin();$('login-status').textContent=e.message;}}
  finally{if(currentAuthentication(sequence,epoch))$('login-button').disabled=false;}
});
$('logout-button').addEventListener('click',async()=>{
  if(logoutOperation)return;const epoch=scopeEpoch,operation={};logoutOperation=operation;$('logout-button').disabled=true;
  try{await api('/v1/auth/logout',{method:'POST',body:'{}'});if(epoch===scopeEpoch)showLogin();}catch(e){if(epoch===scopeEpoch)message(e.message,true);}
  finally{if(epoch===scopeEpoch&&logoutOperation===operation){logoutOperation=null;workspaceControls();}}
});
$('cancel-button').addEventListener('click',async()=>{
  if(!currentRun||currentRun.id!==selectedRunId||terminal.has(currentRun.state)||actor?.role==='viewer'||cancellationPending())return;const target=currentRun,epoch=scopeEpoch,selection=selectedRunSequence;
  const operation={epoch,selection,runId:target.id};cancelOperation=operation;
  const isCurrent=()=>epoch===scopeEpoch&&selection===selectedRunSequence&&selectedRunId===target.id;$('cancel-button').disabled=true;
  try{const run=await api(`/v1/runs/${target.id}/cancel`,{method:'POST',body:'{}'});
    if(!isCurrent())return;render(run);await reviewHistory(run);if(!isCurrent())return;
    await history();if(!isCurrent())return;await auditHistory();if(!isCurrent())return;
    message(run.state==='cancelled'?`실행 ${target.id.slice(0,8)}을 취소했습니다. 늦은 응답은 판정에 반영되지 않습니다.`:`실행 ${target.id.slice(0,8)}은 이미 종료되어 취소되지 않았습니다. 현재 상태: ${stateLabels[run.state]||run.state}.`);
  }catch(e){if(isCurrent())message(e.message,true);}
  finally{if(isCurrent()&&cancelOperation===operation){cancelOperation=null;$('cancel-button').disabled=!currentRun||terminal.has(currentRun.state)||actor?.role==='viewer';}}
});
$('audit-action').addEventListener('change',()=>listAction(()=>auditHistory(),()=>auditSequence));
$('audit-more').addEventListener('click',()=>listAction(()=>auditHistory(true),()=>auditSequence));
$('audit-refresh').addEventListener('click',()=>listAction(()=>auditHistory(),()=>auditSequence));


$('baseline-run').addEventListener('change',()=>{comparisonSequence++;$('comparison-result').textContent='기준 실행이 변경됐습니다. 다시 비교하세요.';});
$('compare-form').addEventListener('submit',async event=>{
  event.preventDefault();if(!currentRun){message('먼저 후보 실행을 조회하세요.',true);return;}
  const sequence=++comparisonSequence,candidateId=currentRun.id,baselineId=$('baseline-run').value;
  const current=()=>sequence===comparisonSequence&&selectedRunId===candidateId&&$('baseline-run').value===baselineId;
  try{const result=await api('/v1/compare',{method:'POST',body:JSON.stringify({candidateRunId:candidateId,baselineRunId:baselineId})});
    if(!current())return;
    $('comparison-result').textContent=`${result.comparable?'비교 완료':'비교 불가: 불완전한 평가'} · 회귀 ${result.regressions.length}개 · 배포 ${result.deploymentAllowed?'허용':'차단'}\n통과율 변화 ${(result.passRateDelta*100).toFixed(1)}%p\n`+result.changes.map(c=>`${c.caseId} / ${c.ruleId}: ${c.before} → ${c.after}`).join('\n');
  }catch(e){if(current())$('comparison-result').textContent=e.message;}
});

async function ciHistory(append=false){
  if(actor?.role!=='admin')return;
  if(append&&!keyCursor)return;
  const sequence=++keyHistorySequence;
  const page=await api('/v1/ci-credentials?limit=25'+(append?'&cursor='+encodeURIComponent(keyCursor):''));if(sequence!==keyHistorySequence)return;keyCursor=page.nextCursor;$('ci-more').disabled=!keyCursor;
  if(!append)$('ci-key-list').replaceChildren();
  $('ci-key-list').append(...page.items.map(key=>{
    const row=node('div',undefined,'audit-entry');const expired=Date.parse(key.expires_at)<=Date.now();
    row.append(node('strong',key.name+' '),node('span',`${key.project_id.slice(0,8)} · ${key.revoked_at?'철회됨':expired?'만료됨':'활성'} · 만료 ${new Date(key.expires_at).toLocaleString('ko-KR')}`));
    if(!key.revoked_at&&!expired){const button=node('button','철회','secondary');button.addEventListener('click',async()=>{const epoch=scopeEpoch;button.disabled=true;try{await api(`/v1/ci-credentials/${key.id}/revoke`,{method:'POST',body:'{}'});if(epoch!==scopeEpoch)return;await ciHistory();if(epoch===scopeEpoch)$('ci-status').textContent='키를 철회했습니다.';}catch(e){if(epoch===scopeEpoch){$('ci-status').textContent=e.message;button.disabled=false;}}});row.append(button);}return row;
  }));
}
async function receiptHistory(append=false){
  if(!actor)return;
  if(append&&!receiptCursor)return;
  const sequence=++receiptHistorySequence,params=new URLSearchParams({limit:'25'});
  for(const [key,value] of Object.entries(receiptFilters))if(value)params.set(key,value);
  if(append)params.set('cursor',receiptCursor);
  $('receipt-filter-status').textContent='적용한 조건의 검증 기록을 불러오고 있습니다.';
  let page;try{page=await api('/v1/release-receipts?'+params.toString());}catch(error){if(sequence===receiptHistorySequence)$('receipt-filter-status').textContent='검증 기록을 불러오지 못했습니다. 다시 시도하세요.';throw error;}
  if(sequence!==receiptHistorySequence)return;receiptCursor=page.nextCursor;$('receipts-more').disabled=!receiptCursor;
  receiptShown=(append?receiptShown:0)+page.items.length;
  $('receipt-filter-status').textContent=`조회 조건: ${decisionLabels[receiptFilters.decision]||'모든 판정'} · ${receiptFilters.candidateRunId?'후보 '+receiptFilters.candidateRunId:'모든 후보 실행'} · ${receiptShown}개 표시${receiptShown?'':' (일치하는 검증 기록이 없습니다.)'}`;
  if(!append)$('receipt-list').replaceChildren();
  $('receipt-list').append(...page.items.map(receipt=>{
    const epoch=scopeEpoch;
    const row=node('div',undefined,'audit-entry receipt-entry'),metadata=node('div',undefined,'receipt-metadata');
    metadata.append(node('strong',decisionLabels[receipt.decision]),node('span',`${new Date(receipt.created_at).toLocaleString('ko-KR')} · 실행 ${receipt.candidate_run_id.slice(0,8)} · ${receipt.signing_key_id?'서명 포함':'기존 서명 없음'}`),node('code','검증 기록 '+receipt.id));row.append(metadata);
    for(const [label,id] of [['후보 평가 근거 보기',receipt.candidate_run_id],...(receipt.baseline_run_id?[['기준 평가 근거 보기',receipt.baseline_run_id]]:[])]){
      const open=node('button',label,'secondary');
      open.addEventListener('click',async()=>{
        if(open.disabled||lookupBusy||epoch!==scopeEpoch)return;
        open.disabled=true;
        try{await lookupRun(id,'receipt-navigation-status',true);}
        finally{if(epoch===scopeEpoch)open.disabled=false;}
      });row.append(open);
    }
    const inspect=node('button','기록 상세 보기','secondary');
    inspect.addEventListener('click',async()=>{
      if(inspect.disabled||epoch!==scopeEpoch)return;
      const sequence=++receiptInspectionSequence,organizationId=actor?.organizationId,projectId=activeProjectId;receiptInspectionTrigger=inspect;
      const isCurrent=()=>epoch===scopeEpoch&&sequence===receiptInspectionSequence;
      inspect.disabled=true;$('receipt-inspection').hidden=false;$('receipt-inspection-output').textContent='과거 검증 기록의 범위와 본문 해시를 확인하고 있습니다…';
      try{
        const data=await api(`/v1/release-receipts/${receipt.id}`);if(!isCurrent())return;
        await verifyHistoricalReceipt(data,receipt,organizationId,projectId);if(!isCurrent())return;
        const text=receiptInspectionText(data);$('receipt-inspection-output').textContent=text;
        const manual=data.artifact.result.manualApproval;
        if(manual?.reviewId||manual?.reviewHash){
          $('receipt-inspection-output').textContent=text+'\n\n연결된 과거 검토 근거를 확인하고 있습니다.';
          try{
            const reference=historicalReviewReference(data.artifact),review=await api('/v1/runs/'+reference.runId+'/reviews/'+reference.reviewId);if(!isCurrent())return;
            const detail=await historicalReviewText(data.artifact,review);if(!isCurrent())return;$('receipt-inspection-output').textContent=text+'\n\n'+detail;
          }catch{if(isCurrent())$('receipt-inspection-output').textContent=text+'\n\n연결된 과거 검토 근거를 확인하지 못했습니다. 검증 기록의 본문 확인과는 별개입니다.';}
        }
        if(isCurrent()){$('receipt-inspection-title').focus?.({preventScroll:true});$('receipt-inspection').scrollIntoView?.({block:'start'});}
      }catch{if(isCurrent())$('receipt-inspection-output').textContent='검증 기록을 확인하지 못했습니다. 연결·접근 권한·기록의 무결성을 확인하고 다시 조회하세요.';}
      finally{if(epoch===scopeEpoch)inspect.disabled=false;}
    });row.append(inspect);
    const button=node('button','기록 JSON 저장','secondary');button.addEventListener('click',async()=>{if(button.disabled)return;const epoch=scopeEpoch,organizationId=actor?.organizationId,projectId=activeProjectId;button.disabled=true;try{const data=await api(`/v1/release-receipts/${receipt.id}`);if(epoch!==scopeEpoch)return;await verifyHistoricalReceipt(data,receipt,organizationId,projectId);if(epoch!==scopeEpoch)return;const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const link=node('a');link.href=url;link.download=`agenttrust-receipt-${receipt.id}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){if(epoch===scopeEpoch)message(e.message,true);}finally{if(epoch===scopeEpoch)button.disabled=false;}});row.append(button);return row;
  }));
  if(!append&&!page.items.length)$('receipt-list').textContent=receiptFilters.decision||receiptFilters.candidateRunId?'적용한 조건에 맞는 검증 기록이 없습니다.':'아직 CI 검증 기록이 없습니다.';
}
$('ci-key-form').addEventListener('submit',async event=>{
  event.preventDefault();if(workspaceMutation||actor?.role!=='admin')return;
  const operation={},epoch=scopeEpoch;workspaceMutation=operation;workspaceControls();$('ci-status').textContent='';clearIssuedKey();
  const isCurrent=()=>epoch===scopeEpoch&&workspaceMutation===operation;
  try{const key=await api('/v1/ci-credentials',{method:'POST',body:JSON.stringify({name:$('ci-name').value,projectId:$('ci-project').value,ttlSeconds:Number($('ci-ttl').value)})});if(!isCurrent())return;
    $('ci-issued-key').value=key.token;$('ci-key-box').hidden=false;await ciHistory();if(isCurrent())$('ci-status').textContent='CI 키를 발급했습니다. 안전하게 보관한 뒤 키 창을 닫으세요.';
  }catch(e){if(isCurrent())$('ci-status').textContent=e.message;}finally{if(isCurrent()){workspaceMutation=null;workspaceControls();}}
});
$('ci-key-hide').addEventListener('click',clearIssuedKey);
$('ci-key-copy').addEventListener('click',async()=>{
  if($('ci-key-copy').disabled||$('ci-key-box').hidden||!$('ci-issued-key').value||actor?.role!=='admin')return;
  const operation={},epoch=scopeEpoch,sequence=issuedKeySequence;clipboardOperation=operation;$('ci-key-copy').disabled=true;
  const isCurrent=()=>clipboardOperation===operation&&epoch===scopeEpoch&&sequence===issuedKeySequence;
  try{await navigator.clipboard.writeText($('ci-issued-key').value);if(isCurrent())$('ci-status').textContent='키를 복사했습니다. CI 비밀 저장소에 보관하세요.';}
  catch{if(isCurrent())$('ci-status').textContent='클립보드에 접근할 수 없습니다.';}
  finally{if(isCurrent()){clipboardOperation=null;$('ci-key-copy').disabled=false;}}
});
$('ci-refresh').addEventListener('click',()=>listAction(()=>ciHistory(),()=>keyHistorySequence,e=>{$('ci-status').textContent=e.message;}));
$('receipt-inspection-close').addEventListener('click',()=>clearReceiptInspection(true));
$('receipts-refresh').addEventListener('click',()=>listAction(()=>receiptHistory(),()=>receiptHistorySequence));
function applyReceiptFilters(filters){
  receiptHistorySequence++;receiptCursor=null;receiptFilters=filters;receiptShown=0;$('receipts-more').disabled=true;$('receipt-list').replaceChildren();clearReceiptInspection();
  return listAction(()=>receiptHistory(),()=>receiptHistorySequence);
}
$('receipt-filter-form').addEventListener('submit',event=>{
  event.preventDefault();if(!actor)return;
  const candidateRunId=$('receipt-candidate-id').value.trim().toLowerCase(),decision=$('receipt-decision').value;
  if(candidateRunId&&!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(candidateRunId)||!['','pass','block'].includes(decision)){$('receipt-filter-status').textContent='유효한 후보 실행 UUID와 판정을 선택하세요. 기존 조회 조건을 유지합니다.';return;}
  $('receipt-candidate-id').value=candidateRunId;return applyReceiptFilters({decision,candidateRunId});
});
$('receipt-filter-reset').addEventListener('click',()=>{if(!actor)return;$('receipt-candidate-id').value='';$('receipt-decision').value='';return applyReceiptFilters({decision:'',candidateRunId:''});});


$('workspace-project').addEventListener('change',async()=>{
  const previous=activeProjectId;let epoch=++scopeEpoch;activeProjectId=$('workspace-project').value;clearProjectData();$('workspace-project').disabled=true;
  try{await initialize();if(epoch===scopeEpoch)message('프로젝트를 전환했습니다.');}
  catch(e){
    if(epoch!==scopeEpoch)return;
    if(actor){epoch=++scopeEpoch;activeProjectId=previous;try{await initialize();}catch{if(epoch===scopeEpoch)showLogin();}}
    if(epoch===scopeEpoch)message(e.message,true);
  }
  finally{if(epoch===scopeEpoch)$('workspace-project').disabled=false;}
});

$('project-form').addEventListener('submit',async event=>{
  event.preventDefault();if(workspaceMutation||$('project-create').disabled)return;
  const operation={};let epoch=scopeEpoch;workspaceMutation=operation;workspaceControls();const isCurrent=()=>epoch===scopeEpoch&&workspaceMutation===operation;
  try{const project=await api('/v1/projects',{method:'POST',headers:{'Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({name:$('project-name').value})});
    if(!isCurrent())return;scopeEpoch++;epoch=scopeEpoch;activeProjectId=project.id;clearProjectData();workspaceMutation=operation;workspaceControls();await initialize();if(!isCurrent())return;
    $('project-name').value='';message('새 프로젝트를 만들었습니다. 평가에 사용할 세 가지 버전을 등록하세요.');
  }catch(e){if(isCurrent())message(e.message,true);}finally{if(isCurrent()){workspaceMutation=null;workspaceControls();}}
});
for(const kind of ['agent','policy'])$(kind+'-form').addEventListener('submit',async event=>{
  event.preventDefault();if(versionBusy||$(kind+'-create').disabled)return;const epoch=scopeEpoch;versionBusy=true;updateButtons();
  try{const input=kind==='agent'?{name:$('agent-name').value,mode:$('agent-mode').value}:{name:$('policy-name').value,minimumPassRate:Number($('policy-rate').value)/100,...($('policy-manual').checked?{requiresManualApproval:true,manualApprovalTtlSeconds:Number($('policy-review-ttl').value)}:{})};
    const version=await api('/v1/'+kind+'-versions',{method:'POST',body:JSON.stringify(input)});if(epoch!==scopeEpoch)return;
    await catalog({[kind]:version.id});if(epoch!==scopeEpoch)return;await auditHistory();if(epoch===scopeEpoch)message((kind==='agent'?'에이전트':'정책')+' 새 버전을 등록했습니다: '+version.name);
  }catch(e){if(epoch===scopeEpoch)message(e.message,true);}finally{if(epoch===scopeEpoch){versionBusy=false;updateButtons();}}
});

$('ci-more').addEventListener('click',()=>{if($('ci-more').disabled)return;$('ci-more').disabled=true;return listAction(()=>ciHistory(true),()=>keyHistorySequence,e=>{$('ci-status').textContent=e.message;},()=>{$('ci-more').disabled=!keyCursor;});});
$('receipts-more').addEventListener('click',()=>{if($('receipts-more').disabled)return;$('receipts-more').disabled=true;return listAction(()=>receiptHistory(true),()=>receiptHistorySequence,undefined,()=>{$('receipts-more').disabled=!receiptCursor;});});

function renderOperations(data){
  $('worker-signal').textContent={recent:'신호 있음',stale:'지연됨',missing:'미확인'}[data.worker.state];
  $('queue-waiting').textContent=data.queue.queued;$('queue-running').textContent=data.queue.running;$('queue-overdue').textContent=data.queue.overdue;
  $('operations-detail').textContent='선택한 프로젝트 · 최근 24시간 완료 '+data.recent.completed24h+'개 · 실행 오류/시간 초과 '+data.recent.errors24h+'개 · 워커 신호 '+(data.worker.lastSeen?new Date(data.worker.lastSeen).toLocaleString('ko-KR'):'없음')+' · 조회 '+new Date(data.observedAt).toLocaleTimeString('ko-KR');
  $('operations-alert').textContent=(data.worker.state!=='recent'?'최근 워커 신호가 없습니다. Docker 워커와 DB 연결을 확인하세요. ':'')+(data.queue.overdue||data.queue.expiredLeases?'처리가 지연된 실행이 있습니다. 실행 기록의 상태와 워커 복구를 확인하세요.':'');
}
$('operations-refresh').addEventListener('click',async()=>{
  if($('operations-refresh').disabled)return;const epoch=scopeEpoch;
  $('operations-refresh').disabled=true;try{const data=await api('/v1/operations');if(epoch===scopeEpoch)renderOperations(data);}catch(e){if(epoch===scopeEpoch)message(e.message,true);}finally{if(epoch===scopeEpoch)$('operations-refresh').disabled=false;}
});

async function lookupRun(id,statusId='run-lookup-status',fromReceipt=false){
  if(lookupBusy)return;
  id=typeof id==='string'?id.trim().toLowerCase():'';
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)){$(statusId).textContent='유효한 실행 UUID를 입력하세요.';return;}
  const sequence=++lookupSequence,epoch=scopeEpoch;let selection=selectedRunSequence,loaded=false;
  const isCurrent=()=>sequence===lookupSequence&&epoch===scopeEpoch&&selection===selectedRunSequence;
  lookupBusy=true;$('run-lookup-button').disabled=true;$(statusId).textContent='현재 프로젝트에서 실행을 확인하고 있습니다…';
  try{
    const run=await api('/v1/runs/'+id);if(!isCurrent())return;
    if(run?.id!==id)throw Error('Execution response mismatch');
    loaded=true;selection=selectedRunSequence+1;await selectRun(id,run);
    if(isCurrent()){
      $(statusId).textContent=fromReceipt?'과거 검증에 연결된 실행 '+id+'의 평가 근거를 불러왔습니다. 현재 릴리스 허용 여부는 최종 게이트에서 새로 확인하세요.':'실행 '+id+'의 근거를 불러왔습니다. 사례별 근거와 최종 게이트를 확인하세요.';
      if(fromReceipt)$('evidence').scrollIntoView?.({block:'start'});
    }
  }catch{if(isCurrent())$(statusId).textContent=loaded?'실행 조회 후 관련 기록을 모두 불러오지 못했습니다. 실행 상태와 연결을 확인하고 다시 조회하세요.':'실행을 조회할 수 없습니다. ID와 현재 프로젝트·접근 권한을 확인하세요. 기존 선택은 유지됩니다.';}
  finally{if(sequence===lookupSequence){lookupBusy=false;$('run-lookup-button').disabled=false;if(!isCurrent())$(statusId).textContent='다른 실행을 선택하여 이전 ID 조회 결과를 표시하지 않습니다.';}}
}
$('run-lookup-form').addEventListener('submit',event=>{event.preventDefault();return lookupRun($('run-lookup-id').value);});
$('history-filter-form').addEventListener('submit',event=>{event.preventDefault();runCursor=null;return listAction(()=>history(),()=>historySequence);});
$('history-more').addEventListener('click',()=>{if($('history-more').disabled)return;$('history-more').disabled=true;return listAction(()=>history(true),()=>historySequence,undefined,()=>{$('history-more').disabled=!runCursor;});});

$('policy-manual').addEventListener('change',()=>{$('policy-review-ttl').disabled=!$('policy-manual').checked;});
async function reviewHistory(run=currentRun,append=false){
  if(append&&!reviewCursor)return;
  const sequence=++reviewSequence;
  if(!run||run.id!==selectedRunId||!run.snapshot.policy.requiresManualApproval){$('review-panel').hidden=true;updateRunNavigation();return;}
  const params=new URLSearchParams({limit:'25'});if(append)params.set('cursor',reviewCursor);
  const page=await api('/v1/runs/'+run.id+'/reviews?'+params);if(sequence!==reviewSequence||selectedRunId!==run.id)return;
  reviewCursor=page.nextCursor;$('review-more').disabled=reviewBusy||!reviewCursor;const reviews=page.items;
  if(!append)reviewShown=0;reviewShown+=reviews.length;$('review-history-status').textContent=`검토 기록 ${reviewShown}개 표시 · ${reviewCursor?'이전 기록이 있습니다.':'마지막 기록입니다.'}`;
  $('review-panel').hidden=false;$('review-form').hidden=actor?.role!=='admin';
  updateRunNavigation();
  $('review-approve').disabled=reviewBusy||actor?.role!=='admin'||run.state!=='succeeded'||run.gate.evaluationPassed!==true;
  $('review-reject').disabled=reviewBusy||actor?.role!=='admin'||!terminal.has(run.state);
  $('manual-status').textContent='정책에서 관리자 검토를 요구합니다. 승인 유효 시간 '+(run.snapshot.policy.manualApprovalTtlSeconds??3600)+'초. 최종 배포 판단은 현재 CI 게이트를 확인하세요.';
  if(!append)$('review-list').replaceChildren();
  $('review-list').append(...reviews.map(review=>{const row=node('div',undefined,'audit-entry');row.append(node('strong',review.decision==='approved'?'승인 ':'반려 '),node('span',new Date(review.createdAt).toLocaleString('ko-KR')+' · 검토자 '+review.actorId.slice(0,8)),node('p',review.comment||'(의견 없음)'));return row;}));
  if(!append&&!reviews.length)$('review-list').textContent='아직 관리자 검토 기록이 없습니다.';
}
$('review-form').addEventListener('submit',async event=>{
  event.preventDefault();if(reviewBusy||!currentRun||currentRun.id!==selectedRunId||!['approved','rejected'].includes(event.submitter?.value))return;
  const run=currentRun,epoch=scopeEpoch,selection=selectedRunSequence,decision=event.submitter.value;
  const isCurrent=()=>epoch===scopeEpoch&&selection===selectedRunSequence&&selectedRunId===run.id;reviewBusy=true;invalidateFinalGate('검토 상태 변경을 요청했습니다. 최종 게이트를 다시 확인하세요.');$('review-approve').disabled=true;$('review-reject').disabled=true;$('review-more').disabled=true;
  try{await api('/v1/runs/'+run.id+'/reviews',{method:'POST',headers:{'Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({decision,comment:$('review-comment').value})});
    if(!isCurrent())return;$('review-comment').value='';$('manual-gate-output').textContent='검토 상태가 변경되었습니다. 최종 게이트를 다시 확인하세요.';await reviewHistory(run);if(!isCurrent())return;await auditHistory();if(isCurrent())message(decision==='approved'?'관리자 승인 기록을 저장했습니다.':'반려 기록을 저장했습니다.');
  }catch(e){if(isCurrent())message(e.message,true);}
  finally{if(epoch===scopeEpoch){reviewBusy=false;invalidateFinalGate('검토 요청이 종료됐습니다. 최종 게이트를 다시 확인하세요.');await reviewHistory().catch(()=>{});}}
});
$('review-refresh').addEventListener('click',()=>{invalidateFinalGate('검토 기록을 새로고침했습니다. 최종 게이트를 다시 확인하세요.');return listAction(()=>reviewHistory(),()=>reviewSequence+':'+selectedRunSequence);});
$('review-more').addEventListener('click',()=>{const run=currentRun;if(!run||$('review-more').disabled)return;$('review-more').disabled=true;return listAction(()=>reviewHistory(run,true),()=>reviewSequence+':'+selectedRunSequence,undefined,()=>{$('review-more').disabled=reviewBusy||!reviewCursor;});});
$('gate-baseline-enabled').addEventListener('change',()=>{
  $('gate-baseline-id').disabled=!$('gate-baseline-enabled').checked;
  invalidateFinalGate('비교 포함 여부가 변경됐습니다. 최종 게이트를 다시 확인하세요.');
});
$('gate-baseline-recent').addEventListener('change',()=>{
  if(!$('gate-baseline-enabled').checked||!$('gate-baseline-recent').value)return;
  const id=$('gate-baseline-recent').value;
  if(!recentBaselineRuns.some(r=>r.id===id&&r.state==='succeeded'&&r.id!==selectedRunId))return;
  $('gate-baseline-id').value=id;invalidateFinalGate('기준 실행이 변경됐습니다. 최종 게이트를 다시 확인하세요.');
});
$('gate-baseline-id').addEventListener('input',()=>invalidateFinalGate('기준 실행이 변경됐습니다. 최종 게이트를 다시 확인하세요.'));
$('manual-gate-check').addEventListener('click',async()=>{
  if(!currentRun||currentRun.id!==selectedRunId||!terminal.has(currentRun.state)||reviewBusy||finalGateBusy)return;
  const baselineRunId=$('gate-baseline-enabled').checked?$('gate-baseline-id').value.trim().toLowerCase():null;
  if(baselineRunId!==null&&(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(baselineRunId)||baselineRunId===currentRun.id)){
    invalidateFinalGate('후보와 다른 유효한 기준 실행 UUID를 입력하세요.');return;
  }
  const run=currentRun,selection=selectedRunSequence,epoch=scopeEpoch,sequence=++finalGateSequence;
  const request={candidateRunId:run.id,agentVersionId:run.agentVersionId,datasetVersionId:run.datasetVersionId,policyVersionId:run.policyVersionId,...(baselineRunId?{baselineRunId}:{})};
  const projectId=activeProjectId,organizationId=actor?.organizationId;
  const isCurrent=()=>sequence===finalGateSequence&&selection===selectedRunSequence&&epoch===scopeEpoch&&selectedRunId===run.id;
  currentReceipt=null;$('gate-regression-links').replaceChildren();$('current-receipt-download').disabled=true;finalGateBusy=true;$('manual-gate-check').disabled=true;$('manual-gate-output').textContent='최종 게이트를 확인하고 있습니다…';
  try{
    const result=await api('/v1/release-gate',{method:'POST',headers:{'Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(request)});
    if(!isCurrent())return;
    if(typeof result?.deploymentAllowed!=='boolean'||!['pass','block'].includes(result.decision)||result.deploymentAllowed!==(result.decision==='pass')||!Array.isArray(result.reasons)||!result.reasons.every(reason=>typeof reason==='string')||(result.deploymentAllowed&&result.reasons.length))throw new Error('최종 게이트 응답의 판정과 허용 여부가 일치하지 않습니다.');
    if(result.deploymentAllowed&&(run.state!=='succeeded'||run.gate.decision!=='pass'||(run.snapshot.policy.requiresManualApproval===true?run.gate.evaluationPassed:run.gate.deploymentAllowed)!==true))throw new Error('최종 게이트 통과 응답이 선택한 평가의 통과 상태와 일치하지 않습니다.');
    if(result.deploymentAllowed&&baselineRunId&&(!result.comparison||result.comparison.baselineRunId!==baselineRunId||result.comparison.candidateRunId!==run.id||result.comparison.comparable!==true||(result.comparison.requiresManualApproval===true)!==(run.snapshot.policy.requiresManualApproval===true)||(result.comparison.evaluationPassed??result.comparison.deploymentAllowed)!==true||(run.snapshot.policy.requiresManualApproval===true?result.comparison.evaluationPassed:result.comparison.deploymentAllowed)!==true||!Array.isArray(result.comparison.regressions)||result.comparison.regressions.length))throw new Error('최종 게이트 통과 응답에 완전하고 회귀 없는 기준 비교가 없습니다.');
    if(run.snapshot.policy.requiresManualApproval===true&&(!result.manualApproval||result.manualApproval.required!==true||!['approved','rejected','missing','expired','invalid'].includes(result.manualApproval.status)||result.deploymentAllowed&&result.manualApproval.status!=='approved'))throw new Error('최종 게이트 응답의 관리자 승인 상태가 선택한 정책과 허용 여부에 일치하지 않습니다.');
    if(result.runId!==run.id||result.artifact?.request?.candidateRunId!==run.id||result.artifact?.evidence?.candidate?.runId!==run.id||(result.artifact?.request?.baselineRunId??null)!==baselineRunId||(baselineRunId&&result.artifact?.evidence?.baseline?.runId!==baselineRunId))throw new Error('최종 게이트 응답이 선택한 실행과 기준 근거에 연결되지 않습니다.');
    if(!sameReleaseJson(request,result.artifact.request)||result.artifact.projectId!==projectId||result.artifact.organizationId!==organizationId||!organizationId)throw new Error('최종 게이트 검증 기록의 고정 버전과 조직·프로젝트 범위가 요청과 일치하지 않습니다.');
    if(result.artifact.evidence.candidate.snapshotHash!==run.snapshotHash||result.artifact.evidence.candidate.resultHash!==run.resultHash)throw new Error('최종 게이트 검증 기록이 조회한 평가 근거의 해시와 일치하지 않습니다.');
    const displayed=Object.fromEntries(Object.entries(result).filter(([key])=>!['artifact','artifactHash','signature'].includes(key)));
    if(!sameReleaseJson(displayed,result.artifact.result))throw new Error('최종 게이트 판정과 저장된 검증 기록의 내용이 일치하지 않습니다.');
    await verifyArtifactBody(result.artifact,result.artifactHash);if(!isCurrent())return;
    const approval={approved:'승인 유효',rejected:'반려',missing:'승인 대기',expired:'승인 만료',invalid:'승인 무효'}[result.manualApproval?.status]||'불필요';
    $('manual-gate-output').textContent='확인 시점의 최종 게이트: '+(result.deploymentAllowed?'통과':'차단')+' · 관리자 검토 '+approval+'\n실행 '+run.id+'\n'+(baselineRunId?'기준 실행 '+baselineRunId+'\n'+finalComparisonText(result.comparison):'회귀 비교: 제외\n')+(result.artifact?.checkedAt?'확인 시각 '+new Date(result.artifact.checkedAt).toLocaleString('ko-KR')+'\n':'')+(result.artifact?.receiptId?'검증 기록 '+result.artifact.receiptId+'\n':'')+result.reasons.map(releaseReason).join('\n');
    renderNextAction(result);renderRegressionLinks(result.comparison);
    if((result.artifact?.request?.baselineRunId??null)===baselineRunId&&(!baselineRunId||result.artifact?.evidence?.baseline?.runId===baselineRunId)&&result.artifact?.request?.candidateRunId===run.id&&result.artifact?.evidence?.candidate?.runId===run.id&&typeof result.artifact.receiptId==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(result.artifact.receiptId)&&/^[a-f0-9]{64}$/.test(result.artifactHash||'')){
      currentReceipt={runId:run.id,selection,epoch,sequence,data:{artifact:result.artifact,artifactHash:result.artifactHash,...(result.signature?{signature:result.signature}:{})}};
      $('current-receipt-download').disabled=false;
    }
    await receiptHistory().catch(()=>{if(isCurrent())message('최종 게이트 기록은 저장됐지만 기록 목록을 새로고침하지 못했습니다.',true);});
  }catch(e){if(isCurrent()){$('manual-gate-output').textContent='최종 게이트 확인 실패: '+e.message;renderNextAction();$('next-action-title').textContent='최종 게이트 확인을 다시 요청하세요';$('next-action-detail').textContent='확인을 완료하지 못했습니다. 성공 판정으로 사용할 수 없습니다.';$('next-action-link').href='#release-check-panel';$('next-action-link').textContent='최종 게이트 보기';}}
  finally{if(isCurrent()){finalGateBusy=false;$('manual-gate-check').disabled=reviewBusy;}}
});

$('current-receipt-download').addEventListener('click',()=>{
  const receipt=currentReceipt;
  if(!receipt||receipt.runId!==selectedRunId||receipt.selection!==selectedRunSequence||receipt.epoch!==scopeEpoch||receipt.sequence!==finalGateSequence||finalGateBusy)return;
  const url=URL.createObjectURL(new Blob([JSON.stringify(receipt.data,null,2)],{type:'application/json'}));
  const link=node('a');link.href=url;link.download='agenttrust-receipt-'+receipt.data.artifact.receiptId+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});

for(const [kind,selector] of [['agent','agent'],['dataset','dataset-select'],['policy','policy']]){
  $(selector).addEventListener('change',()=>{inspectionSequence++;$('version-inspection-output').textContent='';$('version-inspection-meta').textContent='선택한 버전이 변경됐습니다. 내용을 다시 조회하세요.';});
  $('inspect-'+kind).addEventListener('click',async()=>{
    const sequence=++inspectionSequence,id=$(selector).value;
    try{const version=await api('/v1/versions/'+id);if(sequence!==inspectionSequence||$(selector).value!==id)return;
      $('version-inspection-meta').textContent=`${version.data.name} · ${new Date(version.createdAt).toLocaleString('ko-KR')} · SHA-256 ${version.contentHash}`;
      $('version-inspection-output').textContent=JSON.stringify(version.data,null,2);
    }catch(error){if(sequence===inspectionSequence)message(error.message,true);}
  });
}
$('dataset-copy').addEventListener('click',async()=>{
  if($('dataset-copy').disabled)return;const id=$('dataset-select').value,draft=$('dataset-json').value,epoch=scopeEpoch;$('dataset-copy').disabled=true;
  try{const version=await api('/v1/versions/'+id);if(epoch!==scopeEpoch||$('dataset-select').value!==id)return;
    if($('dataset-json').value!==draft){message('초안이 수정되어 불러온 내용으로 덮어쓰지 않았습니다.');return;}
    $('dataset-json').value=JSON.stringify({...version.data,name:version.data.name.slice(0,95)+' 복사'},null,2);
    message('선택한 데이터셋을 새 버전 초안으로 불러왔습니다. 수정 후 등록하면 새로운 버전이 생성됩니다.');
  }catch(error){if(epoch===scopeEpoch)message(error.message,true);}finally{if(epoch===scopeEpoch)updateButtons();}
});

function sessionControls(){
  $('sessions-refresh').disabled=sessionBusy;$('sessions-more').disabled=sessionBusy||!sessionCursor;
  for(const button of sessionButtons)button.disabled=sessionBusy;
}
async function sessionHistory(append=false){
  if(!actor||append&&!sessionCursor)return;
  const sequence=++sessionSequence,params=new URLSearchParams({limit:'25'});if(append)params.set('cursor',sessionCursor);
  const page=await api('/v1/sessions?'+params);if(sequence!==sessionSequence)return;
  sessionCursor=page.nextCursor;if(!append){$('session-list').replaceChildren();sessionButtons=[];}
  $('sessions-scope').textContent=page.scope==='organization'?'관리자: 현재 조직의 활성 세션을 확인하고 종료할 수 있습니다. 접근 키 자체는 철회하지 않습니다.':'현재 계정의 활성 세션만 표시합니다. 이 세션을 종료하면 로그인 화면으로 돌아갑니다.';
  for(const session of page.items){
    const row=node('div',undefined,'audit-entry');row.append(node('strong',session.name+' '),node('span',`${session.role} · ${session.current?'현재 브라우저 · ':''}${session.id.slice(0,8)} · 시작 ${new Date(session.createdAt).toLocaleString('ko-KR')} · 만료 ${new Date(session.expiresAt).toLocaleString('ko-KR')}`));
    const button=node('button',session.current?'현재 세션 종료':'세션 종료','secondary');sessionButtons.push(button);
    button.addEventListener('click',async()=>{
      if(sessionBusy)return;sessionBusy=true;sessionControls();const epoch=scopeEpoch;
      try{const result=await api(`/v1/sessions/${session.id}/revoke`,{method:'POST',body:'{}'});
        if(epoch!==scopeEpoch)return;
        if(result.current){showLogin();$('login-status').textContent='현재 세션을 종료했습니다. 접근 키로 다시 로그인할 수 있습니다.';}
        else{$('sessions-status').textContent='선택한 세션을 종료했습니다.';await sessionHistory();if(epoch!==scopeEpoch)return;await auditHistory();}
      }catch(error){if(epoch===scopeEpoch)$('sessions-status').textContent=error.message;}
      finally{if(epoch===scopeEpoch){sessionBusy=false;sessionControls();if(actor)try{await sessionHistory();}catch(error){if(epoch===scopeEpoch)$('sessions-status').textContent=error.message;}}}
    });row.append(button);$('session-list').append(row);
  }
  if(!append&&!page.items.length)$('session-list').textContent='활성 세션이 없습니다.';sessionControls();
}
$('sessions-refresh').addEventListener('click',()=>listAction(()=>sessionHistory(),()=>sessionSequence,e=>{$('sessions-status').textContent=e.message;}));
$('sessions-more').addEventListener('click',()=>listAction(()=>sessionHistory(true),()=>sessionSequence,e=>{$('sessions-status').textContent=e.message;}));


$('login-button').disabled=true;
const initialAuthentication=authenticationSequence,initialEpoch=scopeEpoch;
try{await initialize();}catch(e){if(currentAuthentication(initialAuthentication,initialEpoch,e)){showLogin();$('login-status').textContent=e.message==='Authentication required.'?'접근 키를 입력해 주세요.':e.message;}}
finally{if(currentAuthentication(initialAuthentication,initialEpoch))$('login-button').disabled=false;}
