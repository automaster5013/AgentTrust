const $ = id => document.getElementById(id);
let currentRun = null;
let loading = false;
let selectedRunId = null;
const terminal = new Set(['succeeded', 'failed', 'cancelled', 'timed_out']);
const decisionLabels = { pass: '통과', block: '차단', inconclusive: '판정 불가' };
const stateLabels = { queued: '대기 중', running: '실행 중', succeeded: '평가 완료', failed: '실행 실패' };
function message(text, error = false) { $('status').textContent = text; $('status').className = error ? 'error' : ''; }
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', 'X-AgentTrust-Request': 'local-ui', ...options.headers } });
  const data = await response.json();
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
    const select = $(id); const previous = kind === 'dataset' && selectedDataset ? selectedDataset : select.value;
    select.replaceChildren(...data[kind].map(v => {
      const option = node('option', `${v.name}${v.cases ? ` · ${v.cases}개 사례` : ''}`);
      option.value = v.id; return option;
    }));
    if (data[kind].some(v => v.id === previous)) select.value = previous;
  }
}
function render(run) {
  currentRun = run;
  const decision = run.gate.decision;
  $('gate-badge').textContent = decision.toUpperCase(); $('gate-badge').className = `gate ${decision}`;
  $('gate-title').textContent = { pass: '정의된 배포 기준을 통과했습니다', block: '배포를 차단해야 합니다', inconclusive: '추가 검증이 필요합니다' }[decision];
  const reasons = { 'A required rule failed.': '필수 규칙이 실패했습니다. 사례별 근거를 확인하고 변경을 수정하세요.', 'Required evaluation evidence is incomplete.': '실행 오류 또는 필수 증거 누락으로 안전하게 판단할 수 없습니다.', 'The policy pass rate threshold was not met.': '정책에서 요구하는 규칙 통과율을 충족하지 못했습니다.', 'All required rules passed and the policy threshold was met.': '모든 필수 규칙과 통과율 조건을 충족했습니다. 판정은 해당 테스트 범위에 한정됩니다.', 'Evaluation has not completed.': '평가가 완료될 때까지 배포를 허용하지 않습니다.' };
  $('gate-reason').textContent = reasons[run.gate.reason] || run.gate.reason;
  $('allowed').textContent = run.gate.deploymentAllowed ? '허용' : '허용 안 함';
  $('run-state').textContent = stateLabels[run.state] || run.state;
  for (const [key, id] of [['cases', 'case-count'], ['pass', 'pass-count'], ['fail', 'fail-count'], ['inconclusive', 'unknown-count']]) $(id).textContent = run.summary?.[key] ?? '—';
  $('snapshot').textContent = `실행 ${run.id}\n에이전트 ${run.snapshot.agent.name} · 데이터셋 ${run.snapshot.dataset.name} · 정책 ${run.snapshot.policy.name}\n스냅샷 SHA-256 ${run.snapshotHash}`;
  $('download').disabled = !terminal.has(run.state);
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
  $('results').replaceChildren(...(cards.length ? cards : [node('div', '평가 결과를 기다리고 있습니다.', 'empty')]));
}
async function history() {
  const runs = await api('/v1/runs');
  $('history-body').replaceChildren(...runs.map(r => {
    const row = node('tr');
    row.append(node('td', r.agentName), node('td', r.datasetName), node('td', stateLabels[r.state] || r.state));
    const gate = node('td'); gate.append(node('span', decisionLabels[r.gate.decision], `chip ${r.gate.decision}`));
    const action = node('td'); const button = node('button', '조회', 'secondary');
    button.addEventListener('click', () => selectRun(r.id).catch(e => message(e.message, true))); action.append(button);
    row.append(gate, node('td', new Date(r.createdAt).toLocaleTimeString('ko-KR')), action); return row;
  }));
}
async function selectRun(id) {
  selectedRunId = id;
  for (let attempt = 0; attempt < 30; attempt++) {
    const run = await api(`/v1/runs/${id}`);
    if (selectedRunId !== id) return;
    render(run);
    if (terminal.has(run.state)) { await history(); return; }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error('평가가 아직 완료되지 않았습니다. 실행 기록에서 다시 조회하세요.');
}
$('run-form').addEventListener('submit', async event => {
  event.preventDefault(); if (loading) return;
  loading = true; $('run-button').disabled = true; message('평가 실행을 요청했습니다…');
  try {
    const run = await api('/v1/runs', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ agentVersionId: $('agent').value, datasetVersionId: $('dataset-select').value, policyVersionId: $('policy').value }) });
    await selectRun(run.id); message('평가가 종료되었습니다. 게이트 판정과 근거를 확인하세요.');
  } catch (e) { message(e.message, true); }
  finally { loading = false; $('run-button').disabled = false; }
});
$('dataset-form').addEventListener('submit', async event => {
  event.preventDefault(); $('dataset-button').disabled = true;
  try {
    const value = JSON.parse($('dataset-json').value);
    const version = await api('/v1/dataset-versions', { method: 'POST', body: JSON.stringify(value) });
    await catalog(version.id); message(`데이터셋 새 버전을 등록했습니다: ${version.name}`);
  } catch (e) { message(e.message, true); }
  finally { $('dataset-button').disabled = false; }
});
$('download').addEventListener('click', () => {
  if (!currentRun) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(currentRun, null, 2)], { type: 'application/json' }));
  const link = node('a'); link.href = url; link.download = `agenttrust-${currentRun.id}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('run-button').disabled = true;
try {
  await catalog(); $('dataset-json').value = JSON.stringify(await api('/v1/sample-dataset'), null, 2); await history(); $('run-button').disabled = false;
} catch (e) { message(`초기화 실패: ${e.message}`, true); }
