const $ = id => document.getElementById(id);
let currentRun = null;
let actor = null;
let activeProjectId = null;
let scopeEpoch = 0;
let loading = false;
let selectedRunId = null;
let keyCursor=null,receiptCursor=null,runCursor=null;
let historySequence=0;
let auditCursor=null,auditSequence=0;
const terminal = new Set(['succeeded', 'failed', 'cancelled', 'timed_out']);
const decisionLabels = { pass: '통과', block: '차단', inconclusive: '판정 불가' };
const stateLabels = { queued: '대기 중', running: '실행 중', succeeded: '평가 완료', failed: '실행 실패', cancelled: '취소됨', timed_out: '시간 초과' };
function message(text, error = false) { $('status').textContent = text; $('status').className = error ? 'error' : ''; }
async function api(path, options = {}) {
  const epoch=scopeEpoch;
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', 'X-AgentTrust-Request': 'local-ui', ...(activeProjectId?{'X-AgentTrust-Project':activeProjectId}:{}), ...options.headers } });
  const data = await response.json();
  if(epoch!==scopeEpoch)throw new Error('워크스페이스가 변경되어 이전 요청의 결과를 표시하지 않습니다.');
  if (response.status === 401) showLogin();
  if (!response.ok) throw new Error(data.error || '요청을 완료하지 못했습니다.');
  return data;
}
function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
async function catalog(selectedDataset) {
  const data = await api('/v1/catalog');
  for (const [kind, id] of [['agent', 'agent'], ['dataset', 'dataset-select'], ['policy', 'policy']]) {
    const select = $(id); const previous = typeof selectedDataset==='object' && selectedDataset?.[kind] ? selectedDataset[kind] : kind === 'dataset' && typeof selectedDataset==='string' ? selectedDataset : select.value;
    select.replaceChildren(...data[kind].map(v => {
      const option = node('option', `${v.name}${v.cases ? ` · ${v.cases}개 사례` : ''}`);
      option.value = v.id; return option;
    }));
    if (data[kind].some(v => v.id === previous)) select.value = previous;
    else if(kind==='agent') select.value=data.agent.find(v=>v.mode==='compliant')?.id || select.value;
  }
  updateButtons();
}
function updateButtons(){
  const writer=actor&&actor.role!=='viewer';
  $('run-button').disabled=!writer||loading||!$('agent').value||!$('dataset-select').value||!$('policy').value;
  $('dataset-button').disabled=!writer;$('agent-create').disabled=!writer;$('policy-create').disabled=actor?.role!=='admin';
}
function render(run) {
  if(currentRun?.id!==run.id){$('review-comment').value='';$('manual-gate-output').textContent='';}
  currentRun = run;
  $('comparison-result').textContent='후보 실행을 조회한 뒤 기준 실행을 선택하세요.';
  const decision = run.gate.decision;
  $('gate-badge').textContent = decision.toUpperCase(); $('gate-badge').className = `gate ${decision}`;
  $('gate-title').textContent = { pass: '정의된 배포 기준을 통과했습니다', block: '배포를 차단해야 합니다', inconclusive: '추가 검증이 필요합니다' }[decision];
  const reasons = { 'A required rule failed.': '필수 규칙이 실패했습니다. 사례별 근거를 확인하고 변경을 수정하세요.', 'Required evaluation evidence is incomplete.': '실행 오류 또는 필수 증거 누락으로 안전하게 판단할 수 없습니다.', 'The policy pass rate threshold was not met.': '정책에서 요구하는 규칙 통과율을 충족하지 못했습니다.', 'All required rules passed and the policy threshold was met.': '모든 필수 규칙과 통과율 조건을 충족했습니다. 판정은 해당 테스트 범위에 한정됩니다.', 'Evaluation has not completed.': '평가가 완료될 때까지 배포를 허용하지 않습니다.', 'Evaluation was cancelled.': '실행을 취소했습니다. 완료되지 않은 평가는 배포를 허용하지 않습니다.', 'Evaluation exceeded its time budget.': '설정한 시간 예산을 초과했습니다. 배포를 허용하지 않습니다.', 'Evaluation exceeded its case budget.': '설정한 사례 예산을 초과했습니다. 배포를 허용하지 않습니다.' };
  $('gate-reason').textContent = reasons[run.gate.reason] || run.gate.reason;
  $('allowed').textContent = run.gate.requiresManualApproval&&run.gate.evaluationPassed?'관리자 승인 필요':run.gate.deploymentAllowed ? '허용' : '허용 안 함';
  if(run.gate.requiresManualApproval&&run.gate.evaluationPassed)$('gate-title').textContent='평가 통과 · 관리자 검토가 필요합니다';
  $('run-state').textContent = stateLabels[run.state] || run.state;
  for (const [key, id] of [['cases', 'case-count'], ['pass', 'pass-count'], ['fail', 'fail-count'], ['inconclusive', 'unknown-count']]) $(id).textContent = run.summary?.[key] ?? '—';
  $('snapshot').textContent = `실행 ${run.id}\n에이전트 ${run.snapshot.agent.name} · 데이터셋 ${run.snapshot.dataset.name} · 정책 ${run.snapshot.policy.name}\n스냅샷 SHA-256 ${run.snapshotHash}`;
  $('download').disabled = !terminal.has(run.state);
  $('cancel-button').disabled = terminal.has(run.state) || actor?.role === 'viewer';
  const cards = run.results.map(c => {
    const card = node('article', undefined, 'case');
    card.append(node('h3', c.caseId), node('div', '입력', 'case-label'), node('pre', c.input), node('div', '에이전트 출력', 'case-label'), node('pre', c.error || c.evidence.output || '(출력 증거 없음)'));
    card.append(node('div', '모의 도구 이벤트', 'case-label'), node('pre', JSON.stringify(c.evidence.toolEvents ?? '(증거 없음)', null, 2)));
    for (const r of c.rules) {
      const row = node('div', undefined, 'rule-row');
      const detail = node('div', undefined, 'rule-info'); detail.append(node('strong', `${r.ruleId} · ${r.required ? '필수' : '선택'}`), node('span', r.reason));
      row.append(node('span', { pass: 'PASS', fail: 'FAIL', inconclusive: 'INCONCLUSIVE' }[r.status], `chip ${r.status}`), detail); card.append(row);
    }
    return card;
  });
  $('results').replaceChildren(...(cards.length ? cards : [node('div', terminal.has(run.state) ? '실행이 종료됐습니다. 확정된 사례 결과가 없습니다.' : '평가 결과를 기다리고 있습니다.', 'empty')]));
}
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
  const runs=baselines.items;
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
    button.addEventListener('click', () => selectRun(r.id).catch(e => message(e.message, true))); action.append(button);
    row.append(gate, node('td', new Date(r.createdAt).toLocaleString('ko-KR')), action); return row;
  }));
}
async function selectRun(id) {
  selectedRunId = id;
  for (let attempt = 0; attempt < 800; attempt++) {
    const run = await api(`/v1/runs/${id}`);
    if (selectedRunId !== id) return;
    render(run);await reviewHistory(run);
    if (terminal.has(run.state)) { await history(); await auditHistory(); return; }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error('평가가 아직 완료되지 않았습니다. 실행 기록에서 다시 조회하세요.');
}
$('run-form').addEventListener('submit', async event => {
  event.preventDefault(); if (loading) return;
  loading = true; $('run-button').disabled = true; message('평가 실행을 요청했습니다…');
  try {
    const run = await api('/v1/runs', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ agentVersionId: $('agent').value, datasetVersionId: $('dataset-select').value, policyVersionId: $('policy').value, timeoutMs: Number($('timeout-ms').value), caseBudget: Number($('case-budget').value) }) });
    await selectRun(run.id); message('평가가 종료되었습니다. 게이트 판정과 근거를 확인하세요.');
  } catch (e) { message(e.message, true); }
  finally { loading = false; updateButtons(); }
});
$('dataset-form').addEventListener('submit', async event => {
  event.preventDefault(); $('dataset-button').disabled = true;
  try {
    const value = JSON.parse($('dataset-json').value);
    const version = await api('/v1/dataset-versions', { method: 'POST', body: JSON.stringify(value) });
    await catalog(version.id); message(`데이터셋 새 버전을 등록했습니다: ${version.name}`);
  } catch (e) { message(e.message, true); }
  finally { updateButtons(); }
});
$('download').addEventListener('click', () => {
  if (!currentRun) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(currentRun, null, 2)], { type: 'application/json' }));
  const link = node('a'); link.href = url; link.download = `agenttrust-${currentRun.id}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
function clearProjectData(){
  auditSequence++;auditCursor=null;$('audit-more').disabled=true;$('audit-action').value='';
  currentRun=null;selectedRunId=null;historySequence++;runCursor=null;$('history-more').disabled=true;$('history-state').value='';$('history-decision').value='';message('');$('run-button').disabled=true;$('dataset-button').disabled=true;
  for(const id of ['agent-name','policy-name','project-name'])$(id).value='';
  for(const id of ['agent','dataset-select','policy'])$(id).replaceChildren();
  keyCursor=null;receiptCursor=null;$('ci-more').disabled=true;$('receipts-more').disabled=true;
  $('ci-issued-key').value='';$('ci-key-box').hidden=true;$('ci-key-list').replaceChildren();$('receipt-list').replaceChildren();$('ci-project').replaceChildren();$('ci-name').value='';$('ci-status').textContent='';
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
  scopeEpoch++;activeProjectId=null;actor=null;clearProjectData();
  $('workspace-project').replaceChildren();$('access-key').value='';$('workspace-ui').hidden=true;$('login-panel').hidden=false;
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
  actor=await api('/v1/me');activeProjectId=actor.projectId;
  $('workspace-project').replaceChildren(...actor.projects.map(p=>{const option=node('option',p.name);option.value=p.id;return option;}));$('workspace-project').value=activeProjectId;
  $('identity-label').textContent=`${actor.organizationName} · ${actor.name} · ${actor.role}`;
  $('workspace-ui').hidden=false;$('login-panel').hidden=true;$('audit-panel').hidden=actor.role!=='admin';
  $('ci-panel').hidden=actor.role!=='admin';$('projects').hidden=actor.role!=='admin';$('operations-panel').hidden=actor.role!=='admin';
  $('ci-project').replaceChildren(...actor.projects.map(p=>{const option=node('option',p.name);option.value=p.id;return option;}));
  $('ci-project').value=activeProjectId;
  await ciHistory();await receiptHistory();
  await catalog();$('dataset-json').value=JSON.stringify(await api('/v1/sample-dataset'),null,2);await history();await auditHistory();
  updateButtons();
}
$('login-form').addEventListener('submit',async event=>{
  event.preventDefault();$('login-button').disabled=true;$('login-status').textContent='';
  try{const accessKey=$('access-key').value;await api('/v1/auth/login',{method:'POST',body:JSON.stringify({accessKey})});$('access-key').value='';await initialize();}
  catch(e){$('login-status').textContent=e.message;}
  finally{$('login-button').disabled=false;}
});
$('logout-button').addEventListener('click',async()=>{
  try{await api('/v1/auth/logout',{method:'POST',body:'{}'});showLogin();}catch(e){message(e.message,true);}
});
$('cancel-button').addEventListener('click',async()=>{
  if(!currentRun)return;$('cancel-button').disabled=true;
  try{const run=await api(`/v1/runs/${currentRun.id}/cancel`,{method:'POST',body:'{}'});render(run);await reviewHistory(run);await history();await auditHistory();message('실행을 취소했습니다. 늦은 응답은 판정에 반영되지 않습니다.');}
  catch(e){message(e.message,true);}
});
$('audit-action').addEventListener('change',()=>auditHistory().catch(e=>message(e.message,true)));
$('audit-more').addEventListener('click',()=>auditHistory(true).catch(e=>message(e.message,true)));
$('audit-refresh').addEventListener('click',()=>auditHistory().catch(e=>message(e.message,true)));
try{await initialize();}catch(e){showLogin();$('login-status').textContent=e.message==='Authentication required.'?'접근 키를 입력해 주세요.':e.message;}

$('compare-form').addEventListener('submit',async event=>{
  event.preventDefault();if(!currentRun){message('먼저 후보 실행을 조회하세요.',true);return;}
  try{const result=await api('/v1/compare',{method:'POST',body:JSON.stringify({candidateRunId:currentRun.id,baselineRunId:$('baseline-run').value})});
    $('comparison-result').textContent=`${result.comparable?'비교 완료':'비교 불가: 불완전한 평가'} · 회귀 ${result.regressions.length}개 · 배포 ${result.deploymentAllowed?'허용':'차단'}\n통과율 변화 ${(result.passRateDelta*100).toFixed(1)}%p\n`+result.changes.map(c=>`${c.caseId} / ${c.ruleId}: ${c.before} → ${c.after}`).join('\n');
  }catch(e){$('comparison-result').textContent=e.message;}
});

async function ciHistory(append=false){
  if(actor?.role!=='admin')return;
  if(append&&!keyCursor)return;
  const page=await api('/v1/ci-credentials?limit=25'+(append?'&cursor='+encodeURIComponent(keyCursor):''));keyCursor=page.nextCursor;$('ci-more').disabled=!keyCursor;
  if(!append)$('ci-key-list').replaceChildren();
  $('ci-key-list').append(...page.items.map(key=>{
    const row=node('div',undefined,'audit-entry');const expired=Date.parse(key.expires_at)<=Date.now();
    row.append(node('strong',key.name+' '),node('span',`${key.project_id.slice(0,8)} · ${key.revoked_at?'철회됨':expired?'만료됨':'활성'} · 만료 ${new Date(key.expires_at).toLocaleString('ko-KR')}`));
    if(!key.revoked_at&&!expired){const button=node('button','철회','secondary');button.addEventListener('click',async()=>{button.disabled=true;try{await api(`/v1/ci-credentials/${key.id}/revoke`,{method:'POST',body:'{}'});await ciHistory();$('ci-status').textContent='키를 철회했습니다.';}catch(e){$('ci-status').textContent=e.message;button.disabled=false;}});row.append(button);}return row;
  }));
}
async function receiptHistory(append=false){
  if(!actor)return;
  if(append&&!receiptCursor)return;
  const page=await api('/v1/release-receipts?limit=25'+(append?'&cursor='+encodeURIComponent(receiptCursor):''));receiptCursor=page.nextCursor;$('receipts-more').disabled=!receiptCursor;
  if(!append)$('receipt-list').replaceChildren();
  $('receipt-list').append(...page.items.map(receipt=>{
    const row=node('div',undefined,'audit-entry');row.append(node('strong',`${decisionLabels[receipt.decision]} `),node('span',`${new Date(receipt.created_at).toLocaleString('ko-KR')} · 실행 ${receipt.candidate_run_id.slice(0,8)} · ${receipt.signing_key_id?'서명 포함':'기존 서명 없음'} `));
    const button=node('button','기록 JSON 저장','secondary');button.addEventListener('click',async()=>{try{const data=await api(`/v1/release-receipts/${receipt.id}`);const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const link=node('a');link.href=url;link.download=`agenttrust-receipt-${receipt.id}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){message(e.message,true);}});row.append(button);return row;
  }));
  if(!append&&!page.items.length)$('receipt-list').textContent='아직 CI 검증 기록이 없습니다.';
}
$('ci-key-form').addEventListener('submit',async event=>{
  event.preventDefault();$('workspace-project').disabled=true;$('logout-button').disabled=true;$('ci-create').disabled=true;$('ci-status').textContent='';$('ci-issued-key').value='';$('ci-key-box').hidden=true;
  try{const key=await api('/v1/ci-credentials',{method:'POST',body:JSON.stringify({name:$('ci-name').value,projectId:$('ci-project').value,ttlSeconds:Number($('ci-ttl').value)})});$('ci-issued-key').value=key.token;$('ci-key-box').hidden=false;await ciHistory();$('ci-status').textContent='CI 키를 발급했습니다. 안전하게 보관한 뒤 키 창을 닫으세요.';}catch(e){$('ci-status').textContent=e.message;}finally{$('ci-create').disabled=false;$('workspace-project').disabled=false;$('logout-button').disabled=false;}
});
$('ci-key-hide').addEventListener('click',()=>{$('ci-issued-key').value='';$('ci-key-box').hidden=true;});
$('ci-key-copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('ci-issued-key').value);$('ci-status').textContent='키를 복사했습니다. CI 비밀 저장소에 보관하세요.';}catch{$('ci-status').textContent='클립보드에 접근할 수 없습니다.';}});
$('ci-refresh').addEventListener('click',()=>ciHistory().catch(e=>{$('ci-status').textContent=e.message;}));
$('receipts-refresh').addEventListener('click',()=>receiptHistory().catch(e=>message(e.message,true)));

$('workspace-project').addEventListener('change',async()=>{
  const previous=activeProjectId;scopeEpoch++;activeProjectId=$('workspace-project').value;clearProjectData();$('workspace-project').disabled=true;
  try{await initialize();message('프로젝트를 전환했습니다.');}
  catch(e){if(actor){scopeEpoch++;activeProjectId=previous;try{await initialize();}catch{showLogin();}}message(e.message,true);}
  finally{$('workspace-project').disabled=false;}
});

$('project-form').addEventListener('submit',async event=>{
  event.preventDefault();if($('project-create').disabled)return;$('project-create').disabled=true;$('workspace-project').disabled=true;$('logout-button').disabled=true;
  try{const project=await api('/v1/projects',{method:'POST',headers:{'Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({name:$('project-name').value})});
    scopeEpoch++;activeProjectId=project.id;clearProjectData();await initialize();$('project-name').value='';message('새 프로젝트를 만들었습니다. 평가에 사용할 세 가지 버전을 등록하세요.');
  }catch(e){message(e.message,true);}finally{$('project-create').disabled=false;$('workspace-project').disabled=false;$('logout-button').disabled=false;}
});
for(const kind of ['agent','policy'])$(kind+'-form').addEventListener('submit',async event=>{
  event.preventDefault();if($(kind+'-create').disabled)return;$(kind+'-create').disabled=true;
  try{const input=kind==='agent'?{name:$('agent-name').value,mode:$('agent-mode').value}:{name:$('policy-name').value,minimumPassRate:Number($('policy-rate').value)/100,...($('policy-manual').checked?{requiresManualApproval:true,manualApprovalTtlSeconds:Number($('policy-review-ttl').value)}:{})};
    const version=await api('/v1/'+kind+'-versions',{method:'POST',body:JSON.stringify(input)});await catalog({[kind]:version.id});await auditHistory();message((kind==='agent'?'에이전트':'정책')+' 새 버전을 등록했습니다: '+version.name);
  }catch(e){message(e.message,true);}finally{updateButtons();}
});

$('ci-more').addEventListener('click',async()=>{$('ci-more').disabled=true;try{await ciHistory(true);}catch(e){$('ci-status').textContent=e.message;$('ci-more').disabled=!keyCursor;}});
$('receipts-more').addEventListener('click',async()=>{$('receipts-more').disabled=true;try{await receiptHistory(true);}catch(e){message(e.message,true);$('receipts-more').disabled=!receiptCursor;}});

function renderOperations(data){
  $('worker-signal').textContent={recent:'신호 있음',stale:'지연됨',missing:'미확인'}[data.worker.state];
  $('queue-waiting').textContent=data.queue.queued;$('queue-running').textContent=data.queue.running;$('queue-overdue').textContent=data.queue.overdue;
  $('operations-detail').textContent='선택한 프로젝트 · 최근 24시간 완료 '+data.recent.completed24h+'개 · 실행 오류/시간 초과 '+data.recent.errors24h+'개 · 워커 신호 '+(data.worker.lastSeen?new Date(data.worker.lastSeen).toLocaleString('ko-KR'):'없음')+' · 조회 '+new Date(data.observedAt).toLocaleTimeString('ko-KR');
  $('operations-alert').textContent=(data.worker.state!=='recent'?'최근 워커 신호가 없습니다. Docker 워커와 DB 연결을 확인하세요. ':'')+(data.queue.overdue||data.queue.expiredLeases?'처리가 지연된 실행이 있습니다. 실행 기록의 상태와 워커 복구를 확인하세요.':'');
}
$('operations-refresh').addEventListener('click',async()=>{
  $('operations-refresh').disabled=true;try{renderOperations(await api('/v1/operations'));}catch(e){message(e.message,true);}finally{$('operations-refresh').disabled=false;}
});

$('history-filter-form').addEventListener('submit',async event=>{event.preventDefault();runCursor=null;try{await history();}catch(e){message(e.message,true);}});
$('history-more').addEventListener('click',async()=>{$('history-more').disabled=true;try{await history(true);}catch(e){message(e.message,true);$('history-more').disabled=!runCursor;}});

$('policy-manual').addEventListener('change',()=>{$('policy-review-ttl').disabled=!$('policy-manual').checked;});
async function reviewHistory(run=currentRun){
  if(!run||!run.snapshot.policy.requiresManualApproval){$('review-panel').hidden=true;return;}
  const reviews=await api('/v1/runs/'+run.id+'/reviews');if(selectedRunId!==run.id)return;
  $('review-panel').hidden=false;$('review-form').hidden=actor?.role!=='admin';
  $('review-approve').disabled=actor?.role!=='admin'||run.state!=='succeeded'||run.gate.evaluationPassed!==true;
  $('review-reject').disabled=actor?.role!=='admin'||!terminal.has(run.state);
  $('manual-status').textContent='정책에서 관리자 검토를 요구합니다. 승인 유효 시간 '+(run.snapshot.policy.manualApprovalTtlSeconds??3600)+'초. 최종 배포 판단은 현재 CI 게이트를 확인하세요.';
  $('review-list').replaceChildren(...reviews.map(review=>{const row=node('div',undefined,'audit-entry');row.append(node('strong',review.decision==='approved'?'승인 ':'반려 '),node('span',new Date(review.createdAt).toLocaleString('ko-KR')+' · 검토자 '+review.actorId.slice(0,8)),node('p',review.comment||'(의견 없음)'));return row;}));
  if(!reviews.length)$('review-list').textContent='아직 관리자 검토 기록이 없습니다.';
}
$('review-form').addEventListener('submit',async event=>{
  event.preventDefault();if(!currentRun||!['approved','rejected'].includes(event.submitter?.value))return;
  const run=currentRun,decision=event.submitter.value;$('review-approve').disabled=true;$('review-reject').disabled=true;
  try{await api('/v1/runs/'+run.id+'/reviews',{method:'POST',headers:{'Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({decision,comment:$('review-comment').value})});
    if(selectedRunId!==run.id)return;$('review-comment').value='';$('manual-gate-output').textContent='검토 상태가 변경되었습니다. 최종 게이트를 다시 확인하세요.';await reviewHistory(run);await auditHistory();message(decision==='approved'?'관리자 승인 기록을 저장했습니다.':'반려 기록을 저장했습니다.');
  }catch(e){message(e.message,true);await reviewHistory().catch(()=>{});}
});
$('review-refresh').addEventListener('click',()=>reviewHistory().catch(e=>message(e.message,true)));
$('manual-gate-check').addEventListener('click',async()=>{
  if(!currentRun)return;const run=currentRun;$('manual-gate-check').disabled=true;
  try{const result=await api('/v1/release-gate',{method:'POST',headers:{'Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({candidateRunId:run.id,agentVersionId:run.agentVersionId,datasetVersionId:run.datasetVersionId,policyVersionId:run.policyVersionId})});
    if(selectedRunId!==run.id)return;$('manual-gate-output').textContent='현재 CI 게이트: '+(result.deploymentAllowed?'통과':'차단')+' · 검토 상태 '+({approved:'승인 유효',rejected:'반려',missing:'승인 대기',expired:'승인 만료',invalid:'승인 무효'}[result.manualApproval?.status]||'불필요')+'\n'+result.reasons.map(reason=>reason.startsWith('A current administrator approval')?'유효한 관리자 승인이 필요합니다.':reason).join('\n');await receiptHistory();
  }catch(e){if(selectedRunId===run.id)$('manual-gate-output').textContent=e.message;}finally{$('manual-gate-check').disabled=false;}
});
