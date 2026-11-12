import {test,expect,type Page} from '@playwright/test';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync,statSync} from 'node:fs';import {resolve} from 'node:path';
import {openWorkspace} from './console-entry';
import {auditFilters} from '../src/lib/audit-search';
import {detail} from '../src/lib/contracts';
import type {Campaign} from '../src/lib/campaign-contracts';
import {receiptHistoryPage} from '../src/lib/receipt-history';
import {selectedObservationTrustPath,verifiedSelectedObservation} from '../src/lib/receipt-inspection';
import {uncertainCampaignWrite} from '../src/lib/campaign-write-error';
import {uncertainEvaluationWrite} from '../src/lib/evaluation-request';
import {diagnosticRequestKind,diagnosticFailure,sanitizedNetworkDiagnostic} from './network-diagnostics';
async function existingSyntheticEvaluation(page:Page,passOnly=false){
 const response=await page.request.get('/backend/runs');expect(response.status()).toBe(200);const rows=await response.json() as {id:string;provider:string;scenario:string;state:string;decision:string}[];
 const row=rows.find(r=>r.provider==='synthetic'&&r.scenario!=='quality'&&r.state!=='queued'&&(!passOnly||r.decision==='pass'));expect(row).toBeTruthy();
 const record=await (await page.request.get('/backend/runs/'+row!.id)).json(),me=await (await page.request.get('/backend/me')).json(),gate=await (await page.request.get('/backend/runs/'+row!.id+'/gate')).json();return {record,me,gate};
}
async function existingSyntheticNonPassEvaluations(page:Page){
 const response=await page.request.get('/backend/runs');expect(response.status()).toBe(200);const rows=await response.json() as {id:string;provider:string;scenario:string;state:string;decision:string}[];
 const frames=[];
 for(const decision of ['block','inconclusive'] as const){
  const candidates=rows.filter(row=>row.provider==='synthetic'&&row.scenario!=='quality'&&row.state!=='queued'&&row.decision===decision).sort((a,b)=>a.id.localeCompare(b.id));
  const row=decision==='inconclusive'?(candidates.find(row=>row.scenario==='missing_evidence')??candidates[0]):candidates[0];expect(row).toBeTruthy();
  const detailResponse=await page.request.get('/backend/runs/'+row!.id),gateResponse=await page.request.get('/backend/runs/'+row!.id+'/gate');expect(detailResponse.status()).toBe(200);expect(gateResponse.status()).toBe(200);
  const record=await detailResponse.json(),gate=await gateResponse.json();expect(record.id).toBe(row!.id);expect(record.provider).toBe('synthetic');expect(record.decision).toBe(decision);expect(gate.deploymentAllowed).toBe(false);frames.push({record,gate});
 }
 return frames;
}
async function prepareSyntheticEvaluationForm(page:Page,record:{scenario:string;provider:string;requires_approval:boolean}){
 await page.getByLabel('합성 시나리오',{exact:true}).selectOption(record.scenario);await page.getByLabel('실행 공급자',{exact:true}).selectOption(record.provider);await page.getByLabel('관리자 승인 필요',{exact:true}).setChecked(record.requires_approval);
}
async function existingRecoverableCampaign(page:Page){
 const agents=await page.getByLabel('캠페인 에이전트 버전',{exact:true}).locator('option').evaluateAll(rows=>rows.map(row=>(row as HTMLOptionElement).value)),datasets=await page.getByLabel('캠페인 데이터셋 버전',{exact:true}).locator('option').evaluateAll(rows=>rows.map(row=>(row as HTMLOptionElement).value));
 const rows=await (await page.request.get('/backend/campaigns')).json();
 for(const row of rows){if(!agents.includes(row.agent_version_id)||!datasets.includes(row.dataset_version_id))continue;const record=await (await page.request.get('/backend/campaigns/'+row.id)).json(),requirements=await (await page.request.get('/backend/campaigns/'+row.id+'/release-requirements')).json(),lifecycle=await (await page.request.get('/backend/campaigns/'+row.id+'/version-lifecycle')).json();if(record.state!=='queued'&&record.agentVersion.definition.provider==='synthetic'&&!requirements.enabled&&lifecycle.versions.every((v:{state:string})=>v.state==='active')){await page.getByLabel('캠페인 에이전트 버전',{exact:true}).selectOption(record.agent_version_id);await page.getByLabel('캠페인 데이터셋 버전',{exact:true}).selectOption(record.dataset_version_id);await page.getByLabel('캠페인 관리자 승인 필요',{exact:true}).setChecked(record.requires_approval);return {record,requirements,me:await (await page.request.get('/backend/me')).json()}}}
 throw Error('Existing recoverable synthetic campaign unavailable');
}

if(process.env.STACK_E2E_VISUAL_CAPTURE==='true')test('workspace controlled visual capture uses actual viewer and stable evaluation data',async({page})=>{
 await login(page,'demo-viewer');await expect(page.getByRole('heading',{name:/최근 평가/})).toBeVisible();
 const response=await page.request.get('/backend/runs');expect(response.status()).toBe(200);const records=await response.json();
 const cohort=createHash('sha256').update(JSON.stringify(records)).digest('hex');
 const label=process.env.STACK_E2E_VISUAL_LABEL;expect(['before','after']).toContain(label);
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:960});await page.evaluate(()=>document.fonts.ready);await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:resolve('../../.local/ui-visual',label+'-'+width+'.png'),fullPage:false,animations:'disabled',maskColor:'#DCE3EA',mask:[page.locator('.account'),page.locator('.scope'),page.locator('.runs button > span'),page.locator('.mono')]});
 }
 phase('controlled-visual-cohort-sha256 '+cohort);phase('actual demo-viewer,1440x960 and390x960,account scope run identifiers and hashes masked,no business writes');
});

if(process.env.STACK_E2E_ADMIN_VISUAL==='true')test('administrator controlled visual capture uses the same actual evaluation and review basis',async({page})=>{
 await login(page,'demo-admin');const {record,gate}=await existingSyntheticEvaluation(page,true);
 const basis=await (await page.request.get('/backend/runs/'+record.id+'/reviews/page')).json();
 const nonPass=await existingSyntheticNonPassEvaluations(page),cohort=createHash('sha256').update(JSON.stringify({record,gate,basis,nonPass})).digest('hex');
 const label=process.env.STACK_E2E_VISUAL_LABEL;expect(['before','after']).toContain(label);
 let writes=0;page.on('request',r=>{const path=new URL(r.url()).pathname;if(path.startsWith('/backend/')&&r.method()!=='GET'&&!['/backend/login','/backend/logout'].includes(path))writes++});
 await page.locator('.runs li button').filter({hasText:record.id.slice(0,8)}).click();
 const evidence=page.locator('.evidence'),form=evidence.locator('form').filter({has:page.getByRole('heading',{name:'관리자 검토',exact:true})});await expect(form.getByRole('button',{name:'검토 저장·게이트 확인',exact:true})).toBeEnabled();
 const masks=[page.locator('.account'),page.locator('.scope'),page.locator('.mono'),page.locator('.runs button > span'),page.locator('.review-history p')];
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:960});await page.evaluate(()=>document.fonts.ready);
  for(const [name,region] of [['review',form],['detail',evidence]] as const){if(name==='detail')await region.evaluate(node=>node.scrollIntoView({block:'start'}));else await region.scrollIntoViewIfNeeded();await page.screenshot({path:resolve('../../.local/ui-visual/admin-'+label+'-'+name+'-'+width+'.png'),animations:'disabled',maskColor:'#DCE3EA',mask:masks})}
 }
 for(const frame of nonPass){
  await page.locator('.runs li button').filter({hasText:frame.record.id.slice(0,8)}).click();await expect(evidence.locator(':scope > p.mono')).toContainText(frame.record.id);
  await expect(evidence.locator('.decision-summary .badge.'+frame.record.decision)).toHaveText(frame.record.decision==='block'?'차단':'판정 보류');await expect(evidence.getByRole('heading',{name:'관리자 검토',exact:true})).toHaveCount(0);await expect(evidence.locator('.gate > strong')).toHaveText('릴리스 허용 안 됨');
  for(const width of [1440,390]){await page.setViewportSize({width,height:960});await page.evaluate(()=>document.fonts.ready);await evidence.evaluate(node=>node.scrollIntoView({block:'start'}));await page.screenshot({path:resolve('../../.local/ui-visual/admin-'+label+'-'+frame.record.decision+'-'+width+'.png'),animations:'disabled',maskColor:'#DCE3EA',mask:masks})}
 }
 expect(writes).toBe(0);phase('controlled-visual-cohort-sha256 '+cohort);phase('actual administrator identical pass block and inconclusive evaluation states and gates,pass review basis;1440x960 and390x960;neutral privacy masks preserved;zero business writes');
});

if(process.env.STACK_E2E_ADMIN_CAPTURE==='true')test('administrator actual review form and mobile evidence remain scoped without writes',async({page})=>{
 await login(page,'demo-admin');const {record}=await existingSyntheticEvaluation(page,true);
 let writes=0;page.on('request',request=>{const path=new URL(request.url()).pathname;if(path.startsWith('/backend/')&&request.method()!=='GET'&&!['/backend/login','/backend/logout'].includes(path))writes++});
 await page.locator('.runs li button').filter({hasText:record.id.slice(0,8)}).click();
 const evidence=page.locator('.evidence'),form=evidence.locator('form').filter({has:page.getByRole('heading',{name:'관리자 검토',exact:true})}),save=form.getByRole('button',{name:'검토 저장·게이트 확인',exact:true});await expect(save).toBeEnabled();await expect(form.getByLabel('검토 사유',{exact:true})).toHaveAttribute('aria-describedby','run-review-reason-help');
 const masks=[page.locator('.account'),page.locator('.scope'),page.locator('.mono'),page.locator('.runs button > span'),page.locator('.review-history p')];
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:960});const tasks=evidence.getByRole('navigation',{name:'선택한 평가 작업 이동',exact:true});await tasks.getByRole('link',{name:'현재 게이트로 이동',exact:true}).focus();await page.keyboard.press('Enter');await expect(evidence.locator('#run-current-gate')).toBeFocused();await expect(evidence.locator('#run-current-gate')).toBeInViewport();await tasks.getByRole('link',{name:'관리자 검토로 이동',exact:true}).focus();await page.keyboard.press('Enter');await expect(form).toBeFocused();await expect(form).toBeInViewport();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await form.getByLabel('결정',{exact:true}).focus();await page.keyboard.press('Tab');await expect(form.getByLabel('검토 사유',{exact:true})).toBeFocused();await page.keyboard.press('Tab');await expect(save).toBeFocused();
  await page.screenshot({path:test.info().outputPath('workspace-admin-review-'+width+'.png'),animations:'disabled',maskColor:'#DCE3EA',mask:masks});
  const reason=form.getByLabel('검토 사유',{exact:true});await reason.fill('');await save.click();await expect(reason).toBeFocused();expect(await reason.evaluate(node=>(node as HTMLTextAreaElement).validity.valueMissing)).toBe(true);expect(writes).toBe(0);await expect(save).toBeEnabled();await page.screenshot({path:test.info().outputPath('workspace-admin-review-required-'+width+'.png'),animations:'disabled',maskColor:'#DCE3EA',mask:masks});
  await tasks.getByRole('link',{name:'평가 규칙으로 이동',exact:true}).focus();await page.keyboard.press('Enter');await expect(evidence.locator('#run-evidence-rules')).toBeFocused();await expect(evidence.locator('table')).toBeInViewport();expect(await evidence.locator('table').evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
  const rules=evidence.getByRole('table',{name:'평가 규칙별 결과 · 필수 여부와 근거',exact:true});for(const rule of record.result.rules){const row=rules.getByRole('row').filter({has:page.getByText(rule.id,{exact:true})});await expect(row).toContainText(({pass:'통과',fail:'실패',inconclusive:'판정 보류'} as Record<string,string>)[rule.status]);}
  await page.screenshot({path:test.info().outputPath('workspace-admin-detail-'+width+'.png'),animations:'disabled',maskColor:'#DCE3EA',mask:masks});
 }
 const basisPath='**/backend/runs/'+record.id+'/reviews/page';await page.route(basisPath,route=>route.fulfill({status:503,contentType:'application/json',body:'{}'}));
 try{await form.getByRole('button',{name:'검토 기준 다시 조회',exact:true}).click();await expect(save).toBeDisabled();await expect(form.locator('[aria-live="polite"]')).toHaveText('최신 검토 기준을 확인하지 못해 저장할 수 없습니다.');await form.scrollIntoViewIfNeeded();await page.screenshot({path:test.info().outputPath('workspace-admin-review-unavailable-390.png'),animations:'disabled',maskColor:'#DCE3EA',mask:masks})}finally{await page.unroute(basisPath)}
 await form.getByRole('button',{name:'검토 기준 다시 조회',exact:true}).click();await expect(save).toBeEnabled();
 for(const frame of await existingSyntheticNonPassEvaluations(page)){
  await page.locator('.runs li button').filter({hasText:frame.record.id.slice(0,8)}).click();await expect(evidence.locator(':scope > p.mono')).toContainText(frame.record.id);await expect(evidence.getByRole('heading',{name:'관리자 검토',exact:true})).toHaveCount(0);await expect(evidence.getByRole('link',{name:'관리자 검토로 이동',exact:true})).toHaveCount(0);
  await expect(evidence.locator('.decision-summary .badge.'+frame.record.decision)).toHaveText(frame.record.decision==='block'?'차단':'판정 보류');await expect(evidence.locator('.evidence-rules').getByText(frame.record.decision==='block'?'실패':'판정 보류',{exact:true}).first()).toBeVisible();await expect(evidence.locator('.gate > strong')).toHaveText('릴리스 허용 안 됨');
  for(const width of [1440,390]){await page.setViewportSize({width,height:960});await evidence.getByRole('link',{name:'현재 게이트로 이동',exact:true}).focus();await page.keyboard.press('Enter');await expect(evidence.locator('#run-current-gate')).toBeFocused();await evidence.evaluate(node=>node.scrollIntoView({block:'start'}));expect(await evidence.locator('table').evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
   for(const badge of await evidence.locator('.evidence-rules .badge').all())expect(await badge.evaluate(node=>{const bounds=node.getBoundingClientRect(),cell=node.closest('td')!.getBoundingClientRect();return bounds.left>=cell.left&&bounds.right<=cell.right})).toBe(true);
   if(frame.record.decision==='inconclusive')expect(await evidence.locator('.evidence-rules .badge').filter({hasText:'판정 보류'}).first().evaluate(node=>{const text=node.firstChild!;return ['판정','보류'].every(word=>{const start=text.textContent!.indexOf(word),range=document.createRange();range.setStart(text,start);range.setEnd(text,start+word.length);return range.getClientRects().length===1})})).toBe(true);
   await page.screenshot({path:test.info().outputPath('workspace-admin-'+frame.record.decision+'-'+width+'.png'),animations:'disabled',maskColor:'#DCE3EA',mask:masks})}
 }
 expect(writes).toBe(0);
 phase('actual demo-admin pass form,1440x960 and390x960,keyboard Enter gate/review navigation and focused targets,keyboard decision-reason-save order,empty required reason blocks submission and focuses reason without writes,no horizontal overflow,read-only503 basis disables save then actual recovery,block and inconclusive have no approval form or review link and never allow release; zero business writes; masked areas not visually assessed');
});

test('workspace management saves scoped settings and issues and revokes a one-time metadata key',async({page})=>{
 test.skip(process.env.STACK_E2E_READ_ONLY==='true','Management writes run only in disposable integration fixtures');
 await login(page,'demo-admin');let issuedId:string|null=null;
 try{
  const management=page.locator('#management');await page.getByRole('navigation',{name:'워크스페이스 탐색',exact:true}).getByRole('link',{name:'프로젝트·계정 관리',exact:true}).click();
  phase('management project read requested');const loadedProject=page.waitForResponse(r=>new URL(r.url()).pathname==='/backend/workspace/project'&&r.request().method()==='GET',{timeout:10000});await management.getByRole('button',{name:'프로젝트 설정 조회',exact:true}).click();expect((await loadedProject).status()).toBe(200);phase('management project response received');await expect(management.getByLabel('프로젝트 이름',{exact:true})).toBeVisible({timeout:5000});phase('management project form accepted');const projectName='Browser project '+randomUUID().slice(0,8);await management.getByLabel('프로젝트 이름',{exact:true}).fill(projectName);await management.getByLabel('프로젝트 설명',{exact:true}).fill('Disposable integration management check');phase('management project save requested');const savedProject=page.waitForResponse(r=>new URL(r.url()).pathname==='/backend/workspace/project'&&r.request().method()==='POST',{timeout:10000});await management.getByRole('button',{name:'프로젝트 설정 저장',exact:true}).click();expect((await savedProject).status()).toBe(200);phase('management project save response received');await expect(management.getByRole('status')).toContainText('현재 프로젝트 설정을 저장했습니다.');
  const stored=await (await page.request.get('/backend/workspace/project')).json();expect(stored.name).toBe(projectName);expect(stored.deploymentAuthority).toBe(false);
  phase('management project save accepted');const keyName='Browser metadata '+randomUUID().slice(0,8);await management.getByLabel('키 이름',{exact:true}).fill(keyName);await management.getByLabel('유효 기간(일)',{exact:true}).fill('1');phase('management key issue requested');const issuedKey=page.waitForResponse(r=>new URL(r.url()).pathname==='/backend/workspace/access-keys'&&r.request().method()==='POST',{timeout:10000});await management.getByRole('button',{name:'조회 전용 키 발급',exact:true}).click();expect((await issuedKey).status()).toBe(200);phase('management key issue response received');await expect(management.getByRole('status')).toContainText('조회 전용 키를 발급했습니다.');const secretField=management.getByLabel('한 번만 표시되는 접근 키',{exact:true});expect(/^at1\.[a-f0-9-]{36}\.[a-f0-9-]{36}\.[a-f0-9-]{36}\.[a-f0-9]{64}$/.test(await secretField.inputValue())).toBe(true);
  phase('management key one-time display accepted');await management.getByRole('button',{name:'접근 키 원문 숨기기',exact:true}).click();await expect(secretField).toHaveCount(0);await management.getByRole('button',{name:'접근 키 목록 조회',exact:true}).click();const listed=await (await page.request.get('/backend/workspace/access-keys')).json();issuedId=listed.entries.find((entry:{name:string})=>entry.name===keyName).id;
  phase('management key hidden and metadata listed');await management.getByRole('button',{name:'접근 키 '+issuedId+' 철회',exact:true}).click();await expect(management.getByRole('status')).toContainText('선택한 접근 키의 철회를 확인했습니다.');issuedId=null;phase('management key revocation accepted');
  await management.getByRole('button',{name:'내 앱 세션 조회',exact:true}).click();await expect(management.getByText(/현재 브라우저/)).toBeVisible();await expect(management.getByText('Keycloak SSO 전체 목록은 아닙니다.',{exact:false})).toBeVisible();
 }finally{
  if(issuedId){const token=(await (await page.request.get('/backend/csrf')).json()).token;await page.request.post('/backend/workspace/access-keys/'+issuedId+'/revoke',{headers:{'X-CSRF-TOKEN':token,Origin:'http://127.0.0.1:4320'},data:{}})}await logout(page);
 }
});

test('workspace management terminates another own browser app session without ending the current one',async({page,browser})=>{
 test.skip(process.env.STACK_E2E_READ_ONLY==='true','Session termination runs only in disposable integration fixtures');
 await login(page,'demo-admin');
 const before=await (await page.request.get('/backend/workspace/sessions')).json();
 const handles=new Set(before.entries.map((row:{handle:string})=>row.handle));
 const context=await browser.newContext({baseURL:'http://127.0.0.1:4320'});
 const second=await context.newPage();
 try{
  await login(second,'demo-admin');
  const response=await page.request.get('/backend/workspace/sessions');expect(response.status()).toBe(200);
  const snapshot=await response.json(),added=snapshot.entries.filter((row:{handle:string;current:boolean})=>!handles.has(row.handle)&&!row.current);
  expect(added.length).toBe(1);const handle=added[0].handle;
  const management=page.locator('#management');await page.getByRole('navigation',{name:'워크스페이스 탐색',exact:true}).getByRole('link',{name:'프로젝트·계정 관리',exact:true}).click();
  await management.getByRole('button',{name:'내 앱 세션 조회',exact:true}).click();
  const end=management.getByRole('button',{name:'앱 세션 '+handle+' 종료',exact:true});await expect(end).toBeVisible();await end.click();
  await expect(management.getByRole('status')).toContainText('선택한 앱 세션을 종료했습니다.');await expect(end).toHaveCount(0);
  expect((await second.request.get('/backend/me')).status()).toBe(401);expect((await page.request.get('/backend/me')).status()).toBe(200);
  await expect(management.getByText(/현재 브라우저/)).toBeVisible();
  phase('actual management UI ends only the other owned app session; current browser remains authenticated; SSO-wide revocation not claimed');
 }finally{try{await logout(second)}finally{await context.close()}}
});

if(process.env.STACK_E2E_LEGACY_CORE_RETURN==='true')test('legacy Core return keeps unsupported management unavailable without fabricating success',async({page})=>{
 await login(page,'demo-admin');const management=page.locator('#management');
 await page.getByRole('navigation',{name:'워크스페이스 탐색',exact:true}).getByRole('link',{name:'프로젝트·계정 관리',exact:true}).click();
 const project=page.waitForResponse(r=>new URL(r.url()).pathname==='/backend/workspace/project'&&r.request().method()==='GET');
 await management.getByRole('button',{name:'프로젝트 설정 조회',exact:true}).click();const projectError=await project;expect(projectError.status()).toBe(500);
 // The UI cancels error bodies; verify bytes through a separate scoped read.
 const projectContract=await page.request.get('/backend/workspace/project');expect(projectContract.status()).toBe(500);expect(await projectContract.json()).toEqual({code:'REQUEST_UNAVAILABLE'});
 await expect(management.getByRole('status')).toContainText('현재 프로젝트의 관리 정보를 확인하지 못했습니다. 다시 조회하세요.');await expect(management.getByLabel('프로젝트 이름',{exact:true})).toHaveCount(0);
 const keys=page.waitForResponse(r=>new URL(r.url()).pathname==='/backend/workspace/access-keys'&&r.request().method()==='GET');
 await management.getByRole('button',{name:'접근 키 목록 조회',exact:true}).click();const keysError=await keys;expect(keysError.status()).toBe(500);
 const keysContract=await page.request.get('/backend/workspace/access-keys');expect(keysContract.status()).toBe(500);expect(await keysContract.json()).toEqual({code:'REQUEST_UNAVAILABLE'});
 await expect(management.getByRole('status')).toContainText('현재 프로젝트의 관리 정보를 확인하지 못했습니다. 다시 조회하세요.');await expect(management.getByLabel('한 번만 표시되는 접근 키',{exact:true})).toHaveCount(0);
 expect((await page.request.get('/backend/me')).status()).toBe(200);phase('pinned previous Core returns sanitized500 for missing management routes; UI remains unavailable; no settings or credentials are invented; fresh authenticated browser remains scoped');
});

test('project home keeps failed statistics unknown and binds retry counts to the displayed response',async({page})=>{
 await login(page,'demo-viewer',async()=>{await page.route('**/backend/runs',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'SYNTHETIC_UNAVAILABLE'})}))});
 const home=page.locator('#overview');await expect(home).toContainText('평가 목록을 확인하지 못했습니다.');await expect(home.locator('dd')).toHaveText(['미확인','미확인','미확인','미확인']);
 await page.unroute('**/backend/runs');
 const observed:{rows:{decision:string}[]|null}={rows:null};
 // Observe the same actual retry bytes before forwarding them unchanged. The
 // browser may release its response body after the UI consumes it; a second GET
 // would not prove that the displayed counts bind to this specific response.
 await page.route('**/backend/runs',async route=>{
  const request=route.request(),url=new URL(request.url());expect(request.method()).toBe('GET');expect(url.origin).toBe('http://127.0.0.1:4320');expect(url.pathname).toBe('/backend/runs');
  const upstream=await route.fetch({maxRetries:0,maxRedirects:0,timeout:10000});expect(upstream.status()).toBe(200);
  const bytes=await upstream.body();expect(bytes.byteLength).toBeLessThanOrEqual(1048576);
  const rows=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as {decision:string}[];expect(Array.isArray(rows)).toBe(true);expect(rows.length).toBeLessThanOrEqual(50);expect(rows.every(row=>['pass','block','inconclusive'].includes(row.decision))).toBe(true);
  observed.rows=rows;await route.fulfill({response:upstream});
 });
 try{
  const loaded=page.waitForResponse(response=>new URL(response.url()).pathname==='/backend/runs'&&response.request().method()==='GET');
  await page.getByRole('button',{name:'최근 평가 다시 조회',exact:true}).click();const response=await loaded;expect(response.status()).toBe(200);expect(observed.rows).not.toBeNull();const rows=observed.rows!;
  await expect(home.locator('dd')).toHaveText([rows.length,rows.filter(r=>r.decision==='pass').length,rows.filter(r=>r.decision==='block').length,rows.filter(r=>r.decision==='inconclusive').length].map(String));await expect(home).not.toContainText('새 평가 준비');phase('displayed counts bind to the same scoped retry response forwarded without byte changes; no second GET or retry');await logout(page);
 }finally{await page.unroute('**/backend/runs')}
});

test('workspace navigation and responsive layout keep review tasks reachable without writes',async({page})=>{
 await login(page,'demo-viewer');
 const navigation=page.getByRole('navigation',{name:'워크스페이스 탐색',exact:true});
 await expect(page.getByRole('heading',{name:'프로젝트 홈',exact:true})).toBeVisible();await expect(page.locator('#overview')).toContainText('프로젝트 전체 통계가 아닙니다.');await expect(page.locator('#overview')).not.toContainText('새 평가 준비');
 for(const [name,target] of [['프로젝트 홈','overview'],['평가 실행·조회','evaluations'],['버전·캠페인','campaigns'],['준비 상태·사용량','operations'],['이력·감사','history'],['프로젝트·계정 관리','management'],['플랫폼 지원 범위','platform']]){
  const link=navigation.getByRole('link',{name,exact:true});await expect(link).toHaveAttribute('href','#'+target);await link.click();await expect(page.locator('#'+target)).toBeVisible();await expect(page.locator('.workspace-top-title')).toBeInViewport({ratio:1});await expect(page.getByRole('button',{name:'로그아웃',exact:true})).toBeInViewport({ratio:1});
 }


 const topMenu=page.getByRole('navigation',{name:'상단 주요 메뉴',exact:true});
 for(const width of [1440,390]){await page.setViewportSize({width,height:960});await expect(topMenu.getByRole('link')).toHaveCount(7);const link=topMenu.getByRole('link',{name:'이력·감사로 이동',exact:true});await link.focus();await expect(link).toBeFocused();await link.press('Enter');await expect(page.locator('.workspace-top-title')).toBeInViewport({ratio:1});await expect(topMenu).toBeInViewport({ratio:1});await expect(page).toHaveURL(/#history$/)}
 const originalViewport=page.viewportSize()??{width:1280,height:960};
 for(const width of [640,320]){
  await page.setViewportSize({width,height:960});
  const names=['프로젝트 홈','평가 실행·조회','버전·캠페인','준비 상태·사용량','이력·감사','프로젝트·계정 관리','플랫폼 지원 범위'];
  await navigation.getByRole('link',{name:names[0],exact:true}).focus();
  for(let index=0;index<names.length;index++){
   const link=navigation.getByRole('link',{name:names[index],exact:true});
   await expect(link).toBeFocused();await expect(link).toBeInViewport({ratio:1});
   if(index<names.length-1)await link.press('Tab');
  }
 }
 await page.setViewportSize(originalViewport);await page.getByRole('link',{name:'Top으로 이동 ↑',exact:true}).click();await expect(page.getByRole('heading',{name:'평가 워크스페이스',exact:true})).toBeInViewport({ratio:1});
 await page.locator('.skip-link').focus();await page.keyboard.press('Enter');await expect(page.locator('#workspace-content')).toBeFocused();
 const filters=page.getByRole('group',{name:'최근 평가 판정 필터',exact:true});
 const firstEvaluation=page.locator('.evaluation-list .runs button').first(),firstDecision=await firstEvaluation.locator('.badge').innerText();
 await firstEvaluation.click();await expect(page.getByRole('heading',{name:'평가 근거',exact:true})).toBeVisible();await expect(page.locator('dl[aria-label="평가와 릴리스 구분"]')).toContainText('평가 판정');await expect(page.locator('dl[aria-label="평가와 릴리스 구분"]')).toContainText('현재 릴리스 판정');
 const evidenceJump=page.getByRole('link',{name:'선택한 평가 근거로 이동',exact:true});await expect(evidenceJump).toHaveAttribute('href','#selected-evaluation-evidence');await evidenceJump.click();await expect(page.getByRole('region',{name:'선택한 평가 근거',exact:true})).toBeInViewport();const taskNavigation=page.getByRole('navigation',{name:'선택한 평가 작업 이동',exact:true});await expect(taskNavigation.getByRole('link',{name:'관리자 검토로 이동',exact:true})).toHaveCount(0);await taskNavigation.getByRole('link',{name:'현재 게이트로 이동',exact:true}).click();await expect(page.locator('#run-current-gate')).toBeFocused();
 for(const width of [1440,390]){await page.setViewportSize({width,height:960});await evidenceJump.click();const evidence=page.locator('#selected-evaluation-evidence');await expect(evidence).toBeInViewport();await page.screenshot({path:test.info().outputPath('workspace-selected-evidence-'+width+'.png'),animations:'disabled',maskColor:'#DCE3EA',mask:[page.locator('.account'),page.locator('.scope'),page.locator('.mono'),page.locator('.runs button > span')]})}
 await filters.getByRole('button',{name:firstDecision==='차단'?/^통과 /:/^차단 /}).click();await expect(evidenceJump).toHaveCount(0);await expect(page.getByRole('heading',{name:'평가 근거',exact:true})).toHaveCount(0);await expect(taskNavigation).toHaveCount(0);

 await filters.getByRole('button',{name:/^차단 /}).click();await expect(filters.getByRole('button',{name:/^차단 /})).toHaveAttribute('aria-pressed','true');
 for(const badge of await page.locator('.evaluation-list .runs .badge').all())await expect(badge).toHaveText('차단');
 await filters.getByRole('button',{name:/^전체 /}).click();await expect(filters.getByRole('button',{name:/^전체 /})).toHaveAttribute('aria-pressed','true');

 const search=page.getByRole('searchbox',{name:'최근 평가 검색',exact:true});
 const originalCount=await page.locator('.evaluation-list .runs button').count();
 const firstText=await page.locator('.evaluation-list .runs button > span').first().innerText();
 const identifier=firstText.split(' · ').at(-1)!;
 await search.fill(identifier.toUpperCase());await expect(page.locator('.evaluation-list .runs button')).toHaveCount(1);
 await search.fill('<script>');await expect(page.getByText('검색·필터 조건에 해당하는 평가가 없습니다.',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'검색·필터 초기화',exact:true}).click();await expect(search).toHaveValue('');await expect(page.locator('.evaluation-list .runs button')).toHaveCount(originalCount);
 const processing=page.getByLabel('최근 평가 처리 상태',{exact:true});await processing.selectOption('queued');
 await expect(page.getByText('검색·필터는 현재 불러온 목록에만 적용합니다. 처리 완료는 평가 통과나 릴리스 허용을 뜻하지 않습니다.',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'검색·필터 초기화',exact:true}).click();await expect(processing).toHaveValue('all');
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:960});await page.evaluate(()=>window.scrollTo(0,0));
  await expect(navigation).toBeVisible();await expect(page.getByRole('heading',{name:'평가 워크스페이스',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  if(width===390){const list=await page.locator('.evaluation-list').boundingBox(),create=await page.locator('.evaluation-create').boundingBox();expect(list).not.toBeNull();expect(create).not.toBeNull();expect(list!.y).toBeLessThan(create!.y)}
  const links=await navigation.getByRole('link').all();for(const link of links){const box=await link.boundingBox();expect(box).not.toBeNull();expect(box!.width).toBeGreaterThanOrEqual(44);expect(box!.height).toBeGreaterThanOrEqual(32)}
  await page.screenshot({path:test.info().outputPath('workspace-'+width+'.png'),fullPage:false,maskColor:'#DCE3EA',mask:[page.locator('.account'),page.locator('.scope'),page.locator('.runs button > span'),page.locator('.mono')],animations:'disabled'});
 }
 phase('actual authenticated viewer navigation, keyboard skip link,1440px/390px horizontal-overflow and navigation target checks; screenshots mask account scope run identifiers and hashes; no business writes');
});

test('authenticated viewer preserves identity during evaluation list failure and retries only the read',async({page})=>{
 let mode='unavailable',writes=0;const list='**/backend/runs';
 let releaseFirstList!:()=>void,firstList=true;const initialList=new Promise<void>(resolve=>{releaseFirstList=resolve});
 page.on('request',request=>{const path=new URL(request.url()).pathname;if(path.startsWith('/backend/')&&request.method()==='POST'&&!['/backend/login','/backend/logout'].includes(path))writes++});
 try{
  await login(page,'demo-viewer',()=>page.route(list,async route=>{if(firstList){firstList=false;await initialList}return mode==='actual'?route.continue():route.fulfill({status:mode==='expired'?401:503,contentType:'application/json',body:JSON.stringify({code:mode==='expired'?'AUTHENTICATION_REQUIRED':'SERVICE_UNAVAILABLE'})})}));
  await expect(page.getByText('로그인 상태를 확인하고 있습니다.',{exact:true})).toHaveCount(0);releaseFirstList();
  const failure=page.getByRole('status',{name:'최근 평가 조회 상태',exact:true});await expect(failure).toContainText('평가 목록을 확인하지 못했습니다.');
  await expect(page.getByRole('button',{name:'Keycloak으로 로그인',exact:true})).toHaveCount(0);await expect(page.getByText('저장된 평가가 없습니다.',{exact:true})).toHaveCount(0);
  mode='actual';await page.getByRole('button',{name:'최근 평가 다시 조회',exact:true}).click();await expect(failure).toHaveCount(0);await expect(page.getByRole('list',{name:'최근 평가 목록',exact:true})).toBeVisible();
  phase('actual Keycloak identity survives an intercepted list 503; explicit read retry restores existing evaluations without login or business writes');
  mode='expired';await page.getByRole('button',{name:'최근 평가 다시 조회',exact:true}).click();await expect(page.getByRole('button',{name:'Keycloak으로 로그인',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'로그아웃',exact:true})).toHaveCount(0);await expect(page.getByRole('list',{name:'최근 평가 목록',exact:true})).toHaveCount(0);expect(writes).toBe(0);
  phase('an intercepted list 401 clears identity, records and protected workspace instead of retaining authenticated UI');
 }finally{releaseFirstList();await page.unroute(list)}
});

test('viewer resolves receipt-specific historical signing trust and rejects substituted or unavailable public keys without writes',async({page})=>{
 await login(page,'demo-viewer');
 const rows=await (await page.request.get('/backend/campaigns')).json() as {id:string}[];let campaignId='',receiptId='';
 for(const row of rows){const response=await page.request.get('/backend/campaigns/'+row.id+'/receipts');expect(response.status()).toBe(200);const receipts=await response.json() as {id:string}[];if(receipts.length){campaignId=row.id;receiptId=receipts[0].id;break}}
 expect(campaignId).not.toBe('');
 const receipt=await (await page.request.get('/backend/campaigns/'+campaignId+'/receipts/'+receiptId)).json();
 expect(receipt.keyId).toMatch(/^[a-f0-9]{64}$/);
 const trustResponse=await page.request.get('/backend/gate-trust/keys/'+receipt.keyId);expect(trustResponse.status()).toBe(200);const trust=await trustResponse.json();
 const region=page.getByRole('region',{name:'버전과 평가 캠페인',exact:true});await region.getByRole('button',{name:'캠페인 '+campaignId.slice(0,8),exact:true}).click();
 const history=page.getByRole('region',{name:'서명된 과거 판정',exact:true});await history.getByRole('button',{name:'서명 기록 목록 확인',exact:true}).click();
 const button=history.getByRole('button',{name:'서명 기록 '+receiptId.slice(0,8)+' 검증',exact:true}),verified=history.getByText('브라우저 Ed25519 서명 검증 완료 · 개발용 공개키',{exact:true});
 let mode='actual',lookups=0,currentKeyFallbacks=0;const path='**/backend/gate-trust/keys/'+receipt.keyId,currentPath='**/backend/gate-trust';
 await page.route(path,route=>{lookups++;if(mode==='actual')return route.continue();if(mode==='unavailable')return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'KEY_UNAVAILABLE'})});return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...trust,keyId:'f'.repeat(64)})})});
 await page.route(currentPath,route=>{currentKeyFallbacks++;return route.continue()});
 try{
  await button.click();await expect(verified).toBeVisible();await expect(history.getByText('서명 키 '+receipt.keyId,{exact:true})).toBeVisible();expect(lookups).toBe(1);
  for(mode of ['substituted','unavailable']){await button.click();await expect(verified).toHaveCount(0);await expect(history.getByRole('button',{name:'검증된 서명·근거 번들 다운로드',exact:true})).toHaveCount(0);await expect(region.getByRole('status',{name:'버전과 캠페인 작업 상태',exact:true})).toContainText('과거 판정의 서명과 보관 근거 연결을 확인하지 못했습니다.')}
  mode='actual';await button.click();await expect(verified).toBeVisible();const before=lookups,downloadEvent=page.waitForEvent('download');await history.getByRole('button',{name:'검증된 서명·근거 번들 다운로드',exact:true}).click();const download=await downloadEvent;expect(await download.failure()).toBeNull();expect(lookups).toBe(before+1);expect(currentKeyFallbacks).toBe(0);
 }finally{await page.unroute(path);await page.unroute(currentPath)}
 phase('actual existing receipt and full bundle use the bounded receipt key lookup; substituted/unavailable trust clears proof and download; explicit retry recovers; no active-key fallback and no business/provider writes');
});

test('editor preserves uncertain campaign versions and conditions while explicitly retrying the original admission',async({page})=>{
 await login(page,'demo-editor');await expect(page.getByRole('button',{name:'캠페인 실행',exact:true})).toBeEnabled();const {record}=await existingRecoverableCampaign(page),create=page.getByRole('button',{name:'캠페인 실행',exact:true}),panel=page.getByRole('region',{name:'저장 결과가 불확실한 캠페인 요청',exact:true});
 let key='',original:unknown,posts=0,mode='stalled',release!:()=>void,entered!:()=>void,finished!:()=>void;const held=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r),done=new Promise<void>(r=>finished=r),path='**/backend/campaigns',requirementsPath='**/backend/campaigns/'+record.id+'/release-requirements',gatePath='**/backend/campaigns/'+record.id+'/gate';
 await page.route(path,async route=>{if(route.request().method()!=='POST')return route.fallback();posts++;const request=route.request();if(posts===1){key=request.headers()['idempotency-key'];original=request.postDataJSON();expect(key).toMatch(/^[a-f0-9-]{36}$/)}else{expect(request.headers()['idempotency-key']).toBe(key);expect(request.postDataJSON()).toEqual(original)}if(mode==='stalled'){entered();await held;try{await route.abort('failed')}catch{/* owned timed-out request */}finally{finished()}return}if(mode==='refused')return route.fulfill({status:403,body:'fixture-private-refusal'});return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(record)})});
 try{
  await create.click();await started;await expect(page.getByText(uncertainCampaignWrite,{exact:true})).toBeVisible({timeout:15000});release();await done;await expect(panel).toBeVisible();await expect(create).toBeDisabled();expect(posts).toBe(1);
  await page.getByLabel('캠페인 관리자 승인 필요',{exact:true}).setChecked(!record.requires_approval);await page.getByLabel('양쪽 근거 유효 기간',{exact:true}).fill('7200');const retry=panel.getByRole('button',{name:'같은 캠페인 요청 다시 제출',exact:true});
  mode='refused';await retry.click();await expect(page.getByText('권한 또는 요청 검증을 확인해 주세요.',{exact:true})).toBeVisible();await expect(panel).toBeVisible();await expect(create).toBeDisabled();expect(posts).toBe(2);
  mode='metadata';await page.route(requirementsPath,route=>route.fulfill({status:503,body:'fixture-private-requirements'}));await retry.click();await expect(page.getByText(uncertainCampaignWrite,{exact:true})).toBeVisible();await expect(panel).toBeVisible();await expect(create).toBeDisabled();expect(posts).toBe(3);await page.unroute(requirementsPath);
  mode='confirmed';await page.route(gatePath,route=>route.fulfill({status:503,body:'fixture-private-gate'}));await retry.click();await expect(page.getByText('캠페인 요청의 저장 결과는 확인했지만 목록이나 현재 게이트를 확인하지 못했습니다.',{exact:false})).toBeVisible();await expect(panel).toHaveCount(0);await expect(create).toBeEnabled();expect(posts).toBe(4);await expect(page.getByText('fixture-private',{exact:false})).toHaveCount(0);
 }finally{release();await page.unroute(path);await page.unroute(requirementsPath);await page.unroute(gatePath)}
 phase('all campaign admission POSTs intercepted; actual10-second browser timeout preserves original actor version hashes approval baseline and age; edited form never changes retry body or key; explicit403 on a previously unknown request retains it; admission receipt followed by unavailable requirements remains unresolved; exact input and requirements verified before clearing pending state; later gate503 is distinct; no business mutation');
});

test('editor resolves an uncertain campaign using a scoped admission and verifies original versions and release conditions',async({page})=>{
 await login(page,'demo-editor');await expect(page.getByRole('button',{name:'캠페인 실행',exact:true})).toBeEnabled();const {record,requirements,me}=await existingRecoverableCampaign(page);let key='',posts=0,mode='missing';const createPath='**/backend/campaigns',lookupPath='**/backend/campaign-requests/*',readPath='**/backend/campaigns/'+record.id,requirementsPath='**/backend/campaigns/'+record.id+'/release-requirements';
 await page.route(createPath,route=>{if(route.request().method()!=='POST')return route.fallback();posts++;key=route.request().headers()['idempotency-key'];return route.fulfill({status:200,contentType:'application/json',body:'{"fixture-private":'})});
 await page.route(lookupPath,route=>{expect(route.request().method()).toBe('GET');expect(route.request().url().endsWith('/'+key)).toBe(true);return route.fulfill({status:mode==='missing'?404:200,contentType:'application/json',body:JSON.stringify({requestKey:mode==='substituted'?randomUUID():key,organizationId:me.organizationId,projectId:me.projectId,actorId:me.actorId,campaignId:record.id,deploymentAuthority:false})})});
 await page.route(readPath,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(mode==='changed-input'?{...record,requires_approval:!record.requires_approval}:record)}));
 await page.route(requirementsPath,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(mode==='changed-requirements'?{...requirements,projectId:randomUUID()}:requirements)}));
 try{
  await page.getByRole('button',{name:'캠페인 실행',exact:true}).click();await expect(page.getByText(uncertainCampaignWrite,{exact:true})).toBeVisible();const panel=page.getByRole('region',{name:'저장 결과가 불확실한 캠페인 요청',exact:true}),lookup=panel.getByRole('button',{name:'기존 캠페인 요청 조회',exact:true});
  for(const observation of ['missing','substituted','changed-input','changed-requirements']){mode=observation;await lookup.click();await expect(page.getByText(observation==='missing'?'현재 이 요청의 캠페인을 찾지 못했습니다.':'캠페인 요청의 저장 결과를 조회하지 못했습니다.',{exact:false})).toBeVisible();await expect(panel).toBeVisible();await expect(page.getByRole('button',{name:'캠페인 실행',exact:true})).toBeDisabled();expect(posts).toBe(1)}
  mode='valid';await lookup.click();await expect(panel).toHaveCount(0);await expect(page.getByText('버전에 연결된 캠페인을 저장했습니다.',{exact:true})).toBeVisible();expect(posts).toBe(1);await expect(page.getByText('fixture-private',{exact:false})).toHaveCount(0);
 }finally{await page.unroute(createPath);await page.unroute(lookupPath);await page.unroute(readPath);await page.unroute(requirementsPath)}
 phase('initial campaign POST and owned admission pointer are synthetic intercepted responses; actual immutable version hashes and release conditions read;404 substituted key changed approval and foreign requirements preserve unresolved intent; explicit correct lookup verifies exact scope record input and requirements without another POST; no business mutation');
});
if(process.env.STACK_E2E_READ_ONLY==='true')test('local read-only guard blocks a business mutation before backend dispatch',async({page})=>{
 await login(page,'demo-admin');const result=await page.evaluate(async()=>{try{await fetch('/backend/runs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scenario:'forbidden-guard-probe',requiresApproval:false})});return 'unexpected-network-response'}catch{return 'browser-network-blocked'}});expect(result).toBe('browser-network-blocked');expect(test.info().annotations.some(a=>a.type==='phase'&&a.description==='read-only network guard refused unintended business mutation')).toBe(true);phase('actual read-only browser guard blocks POST before dispatch; probe also omitsCSRF and uses invalid scenario as independent backend refusal protection; no business write');
});

for(const resource of ['runs','campaigns'] as const)test('administrator compares observed '+resource+' review sequence and refuses stale or unverified basis without forwarding writes',async({page})=>{
 await login(page,'demo-admin');let record:any;
 if(resource==='runs')record=(await existingSyntheticEvaluation(page,true)).record;
 else{const rows=await (await page.request.get('/backend/campaigns')).json();for(const row of rows){const value=await (await page.request.get('/backend/campaigns/'+row.id)).json();if(value.decision==='pass'){record=value;break}}}
 expect(record).toBeTruthy();const prefix='/backend/'+resource+'/'+record.id,frame=await (await page.request.get(prefix+'/reviews/page')).json(),me=await (await page.request.get('/backend/me')).json(),gate=await (await page.request.get(prefix+'/gate')).json();
 const sequence=frame.entries[0]?.review_sequence??0,reason='Synthetic concurrent rejection must be read before resubmission',changed={...frame,entries:[{id:randomUUID(),actor_id:me.actorId,decision:'rejected',reason,created_at:new Date().toISOString(),review_sequence:sequence+1,policy_version:gate.policyVersion,policy_digest:gate.policyDigest}],nextCursor:null};
 let basisMode='original',posts=0,mode='conflict';const historyPath='**'+prefix+'/reviews/page',postPath='**'+prefix+'/reviews',gatePath='**'+prefix+'/gate';
 await page.route(historyPath,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(basisMode==='original'?frame:basisMode==='changed'?changed:{...changed,projectId:randomUUID()})}));
 await page.route(postPath,route=>{expect(route.request().method()).toBe('POST');posts++;const body=route.request().postDataJSON();expect(body.expectedReviewSequence).toBe(mode==='conflict'?sequence:sequence+1);if(mode==='conflict'){basisMode='changed';return route.fulfill({status:409,body:'fixture-private-conflict'})}return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({id:randomUUID(),decision:body.decision})})});
 try{
  if(resource==='runs')await page.locator('.runs li button').filter({hasText:record.id.slice(0,8)}).click();else await page.getByRole('button',{name:'캠페인 '+record.id.slice(0,8),exact:true}).click();
  const region=page.getByRole('region',{name:'저장 전 검토 기준',exact:true}),button=page.getByRole('button',{name:resource==='runs'?'검토 저장·게이트 확인':'캠페인 검토 저장',exact:true});await expect(button).toBeEnabled();await page.getByLabel(resource==='runs'?'검토 사유':'캠페인 검토 사유',{exact:true}).fill('Synthetic intercepted conditional approval');await button.click();
  await expect(page.getByText('최신 검토 또는 평가 상태가 변경되어 저장하지 않았습니다. 검토 기준과 현재 게이트를 확인한 뒤 다시 제출해 주세요.',{exact:true})).toBeVisible();await expect(region.getByText(reason,{exact:true})).toBeVisible();await expect(button).toBeEnabled();expect(posts).toBe(1);
  mode='valid';await page.route(gatePath,route=>route.fulfill({status:503,body:'fixture-private-gate'}));await button.click();await expect(page.getByText(resource==='runs'?'검토 저장 결과는 확인했지만 현재 게이트를 확인하지 못했습니다.':'캠페인 검토 저장 결과는 확인했지만 현재 게이트를 확인하지 못했습니다.',{exact:false})).toBeVisible();expect(posts).toBe(2);
  basisMode='invalid';await region.getByRole('button',{name:'검토 기준 다시 조회',exact:true}).click();await expect(region.getByText('최신 검토 기준을 확인하지 못해 저장할 수 없습니다.',{exact:true})).toBeVisible();await expect(button).toBeDisabled();expect(posts).toBe(2);await expect(page.getByText('fixture-private',{exact:false})).toHaveCount(0);
 }finally{await page.unroute(historyPath);await page.unroute(postPath);await page.unroute(gatePath)}
 phase('existing scope read; synthetic latest rejection and all POST responses intercepted; exact observed sequence sent once,409 clears gate and refreshes visible basis without resubmission; explicit fresh retry and valid receipt distinguished from unavailable gate; substituted basis disables writes; no business mutation');
});

test('viewer verifies existing archived bytes and clears proof without creating an evaluation',async({page})=>{
 await login(page,'demo-viewer');const rows=await (await page.request.get('/backend/runs')).json() as {id:string;state:string}[];let id='',proof:{contentSha256:string;storageVersion:string}|null=null;
 for(const row of rows.filter(row=>row.state!=='queued')){const response=await page.request.get('/backend/runs/'+row.id+'/evidence');if(response.status()===200){id=row.id;proof=await response.json();break}expect(response.status()).toBe(409)}expect(id).not.toBe('');expect(proof).not.toBeNull();
 await page.locator('.runs button').filter({hasText:id.slice(0,8)}).click();await page.getByRole('button',{name:'근거 해시·버전 확인',exact:true}).click();await expect(page.getByText('SHA-256 '+proof!.contentSha256,{exact:true})).toBeVisible();await expect(page.getByText('저장 버전 '+proof!.storageVersion,{exact:true})).toBeVisible();const other=rows.find(row=>row.id!==id)!;await page.locator('.runs button').filter({hasText:other.id.slice(0,8)}).click();await expect(page.locator('.evidence > .mono')).toHaveText('실행 '+other.id);await expect(page.getByText('SHA-256 '+proof!.contentSha256,{exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'평가 실행',exact:true})).toBeDisabled();phase('existing immutable archive read and selection clearing verified as viewer; no evaluation creation and no business write');
});

test('editor preserves uncertain evaluation input and explicitly resubmits the same admission key',async({page})=>{
 await login(page,'demo-editor');const {record}=await existingSyntheticEvaluation(page);await prepareSyntheticEvaluationForm(page,record);let posts=0,key='',body:unknown=null;
 const path='**/backend/runs';await page.route(path,async route=>{if(route.request().method()!=='POST')return route.continue();posts++;const currentKey=route.request().headers()['idempotency-key'],currentBody=route.request().postDataJSON();if(posts===1){key=currentKey;body=currentBody;return route.abort('failed')}expect(currentKey).toBe(key);expect(currentBody).toEqual(body);return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(record)})});
 try{
  const create=page.getByRole('button',{name:'평가 실행',exact:true});await create.click();await expect(page.getByText(uncertainEvaluationWrite,{exact:true})).toBeVisible();expect(posts).toBe(1);expect(key).toMatch(/^[a-f0-9-]{36}$/);
  const pending=page.getByRole('region',{name:'미확인 평가 요청',exact:true});await expect(pending).toBeVisible();await expect(create).toBeDisabled();await page.getByLabel('합성 시나리오',{exact:true}).selectOption(record.scenario==='pass'?'block':'pass');
  const lookup='**/backend/run-requests/'+key;await page.route(lookup,route=>route.fulfill({status:404,contentType:'application/json',body:'{}'}));try{await pending.getByRole('button',{name:'평가 요청 결과 다시 조회',exact:true}).click();await expect(page.getByText('현재 이 요청의 평가를 찾지 못했습니다.',{exact:false})).toBeVisible();expect(posts).toBe(1);await expect(pending).toBeVisible()}finally{await page.unroute(lookup)}
  await pending.getByRole('button',{name:'같은 평가 요청 다시 제출',exact:true}).click();await expect(page.locator('.evidence').getByText('실행 '+record.id,{exact:true})).toBeVisible();await expect(pending).toHaveCount(0);await expect(create).toBeEnabled();expect(posts).toBe(2);
 }finally{await page.unroute(path)}
 phase('POSTs intercepted and never forwarded; lost receipt holds immutable input and original key; read-only404 does not assert absence or resubmit; explicit second POST uses identical original payload/key despite edited form; synthetic receipt borrows an actual scoped read-only evaluation; no business or provider writes');
});
test('editor resolves an uncertain evaluation by scoped request lookup without another submission',async({page})=>{
 await login(page,'demo-editor');const {record,me}=await existingSyntheticEvaluation(page);await prepareSyntheticEvaluationForm(page,record);let key='',posts=0,mode='foreign';const createPath='**/backend/runs';
 await page.route(createPath,route=>{if(route.request().method()!=='POST')return route.continue();posts++;key=route.request().headers()['idempotency-key'];return route.fulfill({status:200,contentType:'application/json',body:'{"fixture-private-receipt":'})});
 try{
  await page.getByRole('button',{name:'평가 실행',exact:true}).click();await expect(page.getByText(uncertainEvaluationWrite,{exact:true})).toBeVisible();expect(posts).toBe(1);const pending=page.getByRole('region',{name:'미확인 평가 요청',exact:true}),lookup='**/backend/run-requests/'+key,detailPath='**/backend/runs/'+record.id;
  const frame={requestKey:key,organizationId:me.organizationId,projectId:me.projectId,actorId:me.actorId,runId:record.id,deploymentAuthority:false};
  await page.route(lookup,route=>route.fulfill({status:mode==='unavailable'?503:200,contentType:'application/json',body:JSON.stringify(mode==='foreign'?{...frame,actorId:randomUUID()}:frame)}));await page.route(detailPath,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(mode==='wrong-input'?{...record,scenario:record.scenario==='pass'?'block':'pass'}:record)}));
  try{for(const failure of ['foreign','wrong-input','unavailable']){mode=failure;await pending.getByRole('button',{name:'평가 요청 결과 다시 조회',exact:true}).click();await expect(page.getByText('평가 요청의 저장 결과를 조회하지 못했습니다.',{exact:false})).toBeVisible();await expect(page.locator('.evidence')).toHaveCount(0);await expect(pending).toBeVisible();expect(posts).toBe(1)}mode='valid';await pending.getByRole('button',{name:'평가 요청 결과 다시 조회',exact:true}).click();await expect(page.locator('.evidence').getByText('실행 '+record.id,{exact:true})).toBeVisible();await expect(pending).toHaveCount(0);expect(posts).toBe(1)}finally{await page.unroute(lookup);await page.unroute(detailPath)}
  await expect(page.getByText('fixture-private-receipt',{exact:false})).toHaveCount(0);
 }finally{await page.unroute(createPath)}
 phase('single malformed POST never forwarded; read-only synthetic lookup refuses foreign actor mismatched original input and HTTP503 before exact scoped read-only recovery; retained key never generates another submission; actual resolution API is separately verified against existing owned admission');
});
test('administrator distinguishes uncertain evaluation review receipts from verified receipt gate-read failure',async({page})=>{
 await login(page,'demo-admin');const {record}=await existingSyntheticEvaluation(page,true);await page.locator('.runs li button').filter({hasText:record.id.slice(0,8)}).click();
 await page.getByLabel('검토 사유',{exact:true}).fill('Synthetic intercepted review boundary');const button=page.getByRole('button',{name:'검토 저장·게이트 확인',exact:true}),path='**/backend/runs/'+record.id+'/reviews',gatePath='**/backend/runs/'+record.id+'/gate';let mode='abort',posts=0;
 await page.route(path,route=>{posts++;if(mode==='abort')return route.abort('failed');if(mode==='refused')return route.fulfill({status:403,body:'fixture-private-refusal'});if(mode==='malformed')return route.fulfill({status:200,contentType:'application/json',body:'{"fixture-private":'});return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({id:randomUUID(),decision:mode==='array'?['approved']:mode==='mismatched'?'rejected':'approved'})})});
 try{
  for(const failure of ['abort','malformed','array','mismatched']){mode=failure;await button.click();await expect(page.getByText(uncertainEvaluationWrite,{exact:true})).toBeVisible();await expect(button).toBeEnabled();await expect(page.getByText('릴리스 허용',{exact:true})).toHaveCount(0)}
  mode='refused';await button.click();await expect(page.getByText('권한 또는 요청 검증을 확인해 주세요.',{exact:true})).toBeVisible();await expect(page.getByText(uncertainEvaluationWrite,{exact:true})).toHaveCount(0);
  mode='valid';await page.route(gatePath,route=>route.fulfill({status:503,body:'fixture-private-gate'}));try{await button.click();await expect(page.getByText('검토 저장 결과는 확인했지만 현재 게이트를 확인하지 못했습니다.',{exact:false})).toBeVisible();await expect(page.getByText('릴리스 허용',{exact:true})).toHaveCount(0);await expect(button).toBeEnabled()}finally{await page.unroute(gatePath)}expect(posts).toBe(6);await expect(page.getByText('fixture-private',{exact:false})).toHaveCount(0);
 }finally{await page.unroute(path)}
 phase('all six review POSTs intercepted and never forwarded; lost/malformed/coerced/substituted receipts clear permission and remain uncertain;403 stays explicit refusal; synthetic valid receipt followed by503 remains distinct from missing receipt; no actual review or business mutation');
});
test('administrator bounds stalled evaluation cancellation and separates confirmed receipt from unavailable gate',async({page})=>{
 await login(page,'demo-admin');const {record,gate}=await existingSyntheticEvaluation(page);const pendingRecord={...record,state:'queued',decision:'inconclusive',result:{state:'queued',decision:'inconclusive',executionEngine:'python-queued',rules:[{id:'worker-completion',required:true,status:'inconclusive',reason:'Synthetic pending cancellation observation'}]}},pendingGate={...gate,decision:'inconclusive',deploymentAllowed:false};
 const read='**/backend/runs/'+record.id,gatePath=read+'/gate',cancelPath=read+'/cancel';let posts=0,mode='stalled',release!:()=>void,entered!:()=>void,finished!:()=>void;const held=new Promise<void>(resolve=>release=resolve),started=new Promise<void>(resolve=>entered=resolve),done=new Promise<void>(resolve=>finished=resolve);
 await page.route(read,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(pendingRecord)}));await page.route(gatePath,route=>route.fulfill({status:mode==='confirmed'?503:200,contentType:'application/json',body:JSON.stringify(pendingGate)}));
 await page.route(cancelPath,async route=>{posts++;if(mode==='stalled'){entered();await held;try{await route.abort('failed')}catch{/* owned timed-out request */}finally{finished()}return}return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...record,state:'failed',decision:'inconclusive',result:{state:'failed',decision:'inconclusive',executionEngine:'java-cancelled',rules:[{id:'evaluation-cancelled',required:true,status:'inconclusive',reason:'Synthetic confirmed cancellation receipt'}]}})})});
 try{
  await page.locator('.runs li button').filter({hasText:record.id.slice(0,8)}).click();await page.getByLabel('평가 취소 사유',{exact:true}).fill('Synthetic intercepted cancellation');const button=page.getByRole('button',{name:'평가 취소',exact:true});await button.click();await started;await expect(page.getByText(uncertainEvaluationWrite,{exact:true})).toBeVisible({timeout:15000});await expect(button).toBeEnabled();expect(posts).toBe(1);release();await done;await expect(page.getByText('평가 취소 결과를 확인했습니다.',{exact:true})).toHaveCount(0);
  mode='confirmed';await button.click();await expect(page.getByText('평가 취소 결과는 확인했지만 현재 게이트를 확인하지 못했습니다.',{exact:false})).toBeVisible();await expect(button).toHaveCount(0);await expect(page.getByText('릴리스 허용',{exact:true})).toHaveCount(0);expect(posts).toBe(2);
 }finally{release();await page.unroute(cancelPath);await page.unroute(read);await page.unroute(gatePath)}
 phase('synthetic pending read uses exact existing scope; intercepted cancellation POST stalls to actual10-second browser bound and is never forwarded; no automatic retry or false cancellation success; explicit synthetic valid cancellation receipt followed by503 is shown separately without release permission; original business data unchanged');
});

test('viewer reads scoped evaluation review history and rejects replayed pages and delayed selection responses',async({page})=>{
 await login(page,'demo-viewer');const rows=await (await page.request.get('/backend/runs')).json() as {id:string}[];expect(rows.length).toBeGreaterThan(0);const id=rows[0].id;
 const actual=await (await page.request.get('/backend/runs/'+id+'/reviews/page')).json();expect(actual.runId).toBe(id);expect(actual.deploymentAuthority).toBe(false);const me=await (await page.request.get('/backend/me')).json(),gate=await (await page.request.get('/backend/runs/'+id+'/gate')).json();
 await page.locator('.runs li button').filter({hasText:id.slice(0,8)}).click();const region=page.getByRole('region',{name:'평가 검토 이력',exact:true}),latest=region.getByRole('button',{name:'평가 검토 이력 조회',exact:true});await latest.click();await expect(region.getByRole('status')).toContainText(actual.entries.length?'검토 이력을 확인했습니다.':'검토 이력이 없습니다.');await expect(region.locator('li')).toHaveCount(actual.entries.length);
 const token=(sequence:number,domain='RRV')=>{const bytes=Buffer.alloc(59);bytes.write(domain);for(const [offset,value] of [[3,me.organizationId],[19,me.projectId],[35,id]] as const)Buffer.from((value as string).replaceAll('-',''),'hex').copy(bytes,offset);bytes.writeBigInt64BE(BigInt(sequence),51);return bytes.toString('base64url')};
 const synthetic={id:randomUUID(),actor_id:me.actorId,decision:'rejected',reason:'Synthetic review navigation',review_sequence:100,policy_version:gate.policyVersion,policy_digest:gate.policyDigest,created_at:'2026-10-14T04:00:00.123456+00:00'},first={...actual,entries:Array.from({length:50},(_,index)=>({...synthetic,id:'00000000-0000-4000-8000-'+(index+1).toString(16).padStart(12,'0'),review_sequence:100-index})),nextCursor:token(51)},last={...actual,entries:[{...synthetic,review_sequence:50}],nextCursor:null};let mode='valid';const path='**/backend/runs/'+id+'/reviews/page**';
 await page.route(path,route=>{const older=route.request().url().endsWith('/'+token(51));if(mode==='unavailable'&&older)return route.fulfill({status:503,body:'{}'});const frame=mode==='foreign'?{...first,runId:randomUUID()}:mode==='campaign'?{...first,nextCursor:token(51,'CRV')}:mode==='array-decision'?{...first,entries:[{...synthetic,decision:['approved']}],nextCursor:null}:mode==='invalid-date'?{...first,entries:[{...synthetic,created_at:'2026-02-30T12:00:00Z'}],nextCursor:null}:mode==='long-reason'?{...first,entries:[{...synthetic,reason:'R'.repeat(500)}],nextCursor:null}:mode==='escaped'?{...first,entries:[{...synthetic,reason:'<img src=x onerror="window.__runReviewInjected=true">'}],nextCursor:null}:older?(mode==='replayed'?first:last):first;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(frame)})});
 try{
  for(const failure of ['foreign','campaign','invalid-date','array-decision']){mode=failure;await latest.click();await expect(region.getByRole('status')).toContainText('검토 이력을 확인하지 못했습니다.');await expect(region.locator('li')).toHaveCount(0)}
  await page.setViewportSize({width:375,height:812});mode='long-reason';await latest.click();await expect(region.locator('li')).toHaveCount(1);await expect(region.getByText('R'.repeat(500),{exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  mode='escaped';await latest.click();await expect(region.locator('li')).toHaveCount(1);await expect(region.getByText('<img src=x onerror="window.__runReviewInjected=true">',{exact:true})).toBeVisible();await expect(region.locator('img')).toHaveCount(0);expect(await page.evaluate(()=>('__runReviewInjected' in window))).toBe(false);
  mode='valid';await latest.click();await expect(region.locator('li')).toHaveCount(50);const next=region.getByRole('button',{name:'다음 검토 페이지',exact:true}),previous=region.getByRole('button',{name:'이전 검토 페이지',exact:true});await next.click();await expect(region.locator('li')).toHaveCount(1);await expect(next).toBeDisabled();await previous.click();await expect(region.locator('li')).toHaveCount(50);
  for(const failure of ['replayed','unavailable']){mode=failure;await next.click();await expect(region.getByRole('status')).toContainText('검토 이력을 확인하지 못했습니다.');await expect(region.locator('li')).toHaveCount(0);mode='valid';await latest.click();await expect(region.locator('li')).toHaveCount(50)}
 }finally{await page.unroute(path)}
 if(rows.length>1){let release!:()=>void,entered!:()=>void,finished!:()=>void;const held=new Promise<void>(resolve=>release=resolve),started=new Promise<void>(resolve=>entered=resolve),done=new Promise<void>(resolve=>finished=resolve);await page.route(path,async route=>{const response=await route.fetch();entered();await held;try{await route.fulfill({response})}catch{/* owned selection abort */}finally{finished()}});try{await latest.click();await started;await page.locator('.runs li button').filter({hasText:rows[1].id.slice(0,8)}).click();await expect(region.locator('li')).toHaveCount(0);release();await done;await expect(region.locator('li')).toHaveCount(0);await expect(region.getByRole('status')).toBeEmpty()}finally{release();await page.unroute(path)}}
 phase('actual evaluation history read; explicitly intercepted synthetic navigation verifies scope campaign-domain dates escaped text replay HTTP503 and next/previous; delayed old evaluation response never restores rows; no business writes');
});

test('viewer navigates bounded review pages and rejects replayed boundaries without business writes',async({page})=>{
 await login(page,'demo-viewer');const rows=await (await page.request.get('/backend/campaigns')).json() as {id:string}[];expect(rows.length).toBeGreaterThan(0);let id=rows[0].id;
 for(const row of rows){const frame=await (await page.request.get('/backend/campaigns/'+row.id+'/reviews/page')).json();if(frame.entries.length){id=row.id;break}}
 const actual=await (await page.request.get('/backend/campaigns/'+id+'/reviews/page')).json();expect(actual.entries.length).toBeGreaterThan(0);
 const encode=(sequence:number,campaign=id)=>{const bytes=Buffer.alloc(59);bytes.write('CRV');for(const [offset,value] of [[3,actual.organizationId],[19,actual.projectId],[35,campaign]] as const)Buffer.from((value as string).replaceAll('-',''),'hex').copy(bytes,offset);bytes.writeBigInt64BE(BigInt(sequence),51);return bytes.toString('base64url')};
 const entries=Array.from({length:50},(_,index)=>({...actual.entries[0],id:'00000000-0000-4000-8000-'+(index+1).toString(16).padStart(12,'0'),review_sequence:100-index,reason:'Synthetic navigation record '+index}));
 const first={...actual,entries,nextCursor:encode(51)},last={...actual,entries:[{...actual.entries[0],id:'00000000-0000-4000-8000-000000000099',review_sequence:50,reason:'Synthetic older navigation record'}],nextCursor:null};let mode='valid';
 const routePath='**/backend/campaigns/'+id+'/reviews/page**';
 await page.route(routePath,route=>{const older=route.request().url().endsWith('/'+encode(51));if(older&&mode==='unavailable')return route.fulfill({status:503,body:'{}'});return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(older?(mode==='replayed'?first:last):first)})});
 try{
  await page.getByRole('button',{name:'캠페인 '+id.slice(0,8),exact:true}).click();const region=page.getByRole('region',{name:'캠페인 검토 이력',exact:true}),latest=region.getByRole('button',{name:'캠페인 검토 이력 조회',exact:true}),next=region.getByRole('button',{name:'다음 검토 페이지',exact:true}),previous=region.getByRole('button',{name:'이전 검토 페이지',exact:true});
  await latest.click();await expect(region.locator('li')).toHaveCount(50);await expect(previous).toBeDisabled();await expect(next).toBeEnabled();await next.click();await expect(region.locator('li')).toHaveCount(1);await expect(region.getByText('검토 이력 페이지 2 · 1개',{exact:true})).toBeVisible();await expect(next).toBeDisabled();await previous.click();await expect(region.locator('li')).toHaveCount(50);
  for(const failure of ['replayed','unavailable']){mode=failure;await next.click();await expect(region.getByRole('status')).toContainText('검토 이력을 확인하지 못했습니다.');await expect(region.locator('li')).toHaveCount(0);await latest.click();await expect(region.locator('li')).toHaveCount(50)}
  mode='valid';await next.click();await expect(region.locator('li')).toHaveCount(1);await latest.click();await expect(region.getByText('검토 이력 페이지 1 · 50개',{exact:true})).toBeVisible();phase('actual scoped frame supplies metadata; explicitly intercepted synthetic 51-row navigation verifies next previous last page replay rejection HTTP503 clearing and first-page recovery; business writes absent');
 }finally{await page.unroute(routePath)}
});

test('viewer reads actual campaign review history and recovers from substituted scope and HTTP 503',async({page})=>{
 await login(page,'demo-viewer');const listResponse=await page.request.get('/backend/campaigns');phase('review-history fixture list HTTP '+listResponse.status());expect(listResponse.status()).toBe(200);const rows=await listResponse.json() as {id:string}[];expect(rows.length).toBeGreaterThan(0);let id=rows[0].id;
 for(const row of rows){const response=await page.request.get('/backend/campaigns/'+row.id+'/reviews/page');expect(response.status()).toBe(200);if((await response.json()).entries.length){id=row.id;break}}
 const response=await page.request.get('/backend/campaigns/'+id+'/reviews/page');expect(response.status()).toBe(200);const frame=await response.json();expect(frame.campaignId).toBe(id);expect(frame.deploymentAuthority).toBe(false);expect(frame.entries.length).toBeLessThanOrEqual(50);phase('actual review history entry count '+frame.entries.length);
 await page.getByRole('button',{name:'캠페인 '+id.slice(0,8),exact:true}).click();const region=page.getByRole('region',{name:'캠페인 검토 이력',exact:true}),button=region.getByRole('button',{name:'캠페인 검토 이력 조회',exact:true});await button.click();await expect(region.getByRole('status')).toContainText(frame.entries.length?'검토 이력을 확인했습니다.':'검토 이력이 없습니다.');await expect(region.locator('li')).toHaveCount(frame.entries.length);
 const path='**/backend/campaigns/'+id+'/reviews/page';
 for(let index=0;index<frame.entries.length;index++){const row=region.locator('li').nth(index),entry=frame.entries[index];await expect(row).toContainText(entry.reason);await expect(row).toContainText(entry.actor_id);await expect(row).toContainText(entry.policy_version);await expect(row).toContainText(entry.policy_digest);await expect(row).toContainText(entry.created_at)}
 if(frame.entries.length){const marker='<img src=x onerror="window.__reviewInjected=true">';await page.route(path,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...frame,entries:[{...frame.entries[0],reason:marker}]})}));try{await button.click();await expect(region.getByText(marker,{exact:true})).toBeVisible();await expect(region.locator('img')).toHaveCount(0);expect(await page.evaluate(()=>('__reviewInjected' in window))).toBe(false)}finally{await page.unroute(path)}}
 if(frame.entries.length){await page.route(path,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...frame,entries:[{...frame.entries[0],created_at:'2026-02-30T12:00:00Z'}]})}));try{await button.click();await expect(region.getByRole('status')).toContainText('검토 이력을 확인하지 못했습니다.');await expect(region.locator('li')).toHaveCount(0);await expect(button).toBeEnabled()}finally{await page.unroute(path)}phase('impossible review date rejected without retaining previous rows')}
 if(rows.some(row=>row.id!==id)){
  const otherId=rows.find(row=>row.id!==id)!.id;let releaseSwitch!:()=>void,enteredSwitch!:()=>void,finishedSwitch!:()=>void;const heldSwitch=new Promise<void>(resolve=>releaseSwitch=resolve),startedSwitch=new Promise<void>(resolve=>enteredSwitch=resolve),doneSwitch=new Promise<void>(resolve=>finishedSwitch=resolve);
  await page.route(path,async route=>{const response=await route.fetch();enteredSwitch();await heldSwitch;try{await route.fulfill({response})}catch{/* selection aborts the owned request */}finally{finishedSwitch()}});
  try{await button.click();await startedSwitch;await page.getByRole('button',{name:'캠페인 '+otherId.slice(0,8),exact:true}).click();await expect(region.locator('li')).toHaveCount(0);releaseSwitch();await doneSwitch;await expect(region.locator('li')).toHaveCount(0);await expect(region.getByRole('status')).toBeEmpty()}finally{releaseSwitch();await page.unroute(path)}
  await page.getByRole('button',{name:'캠페인 '+id.slice(0,8),exact:true}).click();await button.click();await expect(region.getByRole('status')).toContainText(frame.entries.length?'검토 이력을 확인했습니다.':'검토 이력이 없습니다.');await expect(region.locator('li')).toHaveCount(frame.entries.length);phase('switching actual campaign aborts held review response; previous campaign rows never return; manual selected campaign read recovers');
 }
 let release!:()=>void,finished!:()=>void,entered!:()=>void;const held=new Promise<void>(resolve=>release=resolve),done=new Promise<void>(resolve=>finished=resolve),started=new Promise<void>(resolve=>entered=resolve);
 await page.route(path,async route=>{entered();await held;try{await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(frame)})}catch{}finally{finished()}});
 try{await button.click();await started;await expect(region.locator('li')).toHaveCount(0);await expect(region.getByRole('status')).toContainText('검토 이력을 확인하지 못했습니다.',{timeout:12000});await expect(button).toBeEnabled();release();await done;await expect(region.locator('li')).toHaveCount(0);await expect(region.getByRole('status')).toContainText('검토 이력을 확인하지 못했습니다.')}finally{release();await done;await page.unroute(path)}
 await page.route(path,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...frame,organizationId:'22222222-2222-4222-8222-222222222222'})}));
 try{await button.click();await expect(region.getByRole('status')).toContainText('검토 이력을 확인하지 못했습니다.');await expect(region.locator('li')).toHaveCount(0)}finally{await page.unroute(path)}
 await page.route(path,route=>route.fulfill({status:503,contentType:'application/json',body:'{}'}));try{await button.click();await expect(region.getByRole('status')).toContainText('검토 이력을 확인하지 못했습니다.');await expect(button).toBeEnabled()}finally{await page.unroute(path)}
 await button.click();await expect(region.getByRole('status')).toContainText(frame.entries.length?'검토 이력을 확인했습니다.':'검토 이력이 없습니다.');await expect(region.locator('li')).toHaveCount(frame.entries.length);
 await page.setViewportSize({width:390,height:844});await expect(region).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 phase('actual scoped review history read; substituted scope and503 clear older rows; explicit retry recovers; past reviews are not current deployment authority; no business writes');
});
test('administrator sees uncertain cancellation guidance with a synthetic pending read and intercepted POST',async({page})=>{
 await login(page,'demo-admin');const rows=await (await page.request.get('/backend/campaigns')).json() as {id:string}[];expect(rows.length).toBeGreaterThan(0);const id=rows[0].id;
 const record=await (await page.request.get('/backend/campaigns/'+id)).json(),gate=await (await page.request.get('/backend/campaigns/'+id+'/gate')).json();
 record.state='queued';record.decision='inconclusive';record.cases[0].state='queued';record.cases[0].decision='inconclusive';record.result.state='queued';record.result.decision='inconclusive';record.result.rules[0].status='inconclusive';
 gate.decision='inconclusive';gate.deploymentAllowed=false;
 const read='**/backend/campaigns/'+id,gatePath=read+'/gate',cancelPath=read+'/cancel';let posts=0;
 await page.route(read,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(record)}));await page.route(gatePath,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(gate)}));
 await page.route(cancelPath,async route=>{expect(route.request().method()).toBe('POST');posts++;await route.abort('failed')});
 try{await page.getByRole('button',{name:'캠페인 '+id.slice(0,8),exact:true}).click();await page.getByLabel('캠페인 취소 사유',{exact:true}).fill('synthetic intercepted cancellation');const button=page.getByRole('button',{name:'미완료 사례 취소',exact:true});await button.click();await expect(page.getByText(uncertainCampaignWrite,{exact:true})).toBeVisible();await expect(button).toBeEnabled();expect(posts).toBe(1);await expect(page.getByText('캠페인의 미완료 사례 취소를 확인했습니다.',{exact:true})).toHaveCount(0)}
 finally{await page.unroute(cancelPath);await page.unroute(gatePath);await page.unroute(read)}
 phase('synthetic pending campaign response uses real existing version bindings; cancel POST never forwarded; uncertain guidance and no automatic retry, no real cancellation or business writes');
});
test('administrator receives uncertain receipt guidance when the intercepted write loses its response',async({page})=>{
 await login(page,'demo-admin');const records=await (await page.request.get('/backend/campaigns')).json() as {id:string}[];let id:string|null=null;
 for(const row of records){const record=await (await page.request.get('/backend/campaigns/'+row.id)).json();if(record.state!=='queued'&&(await page.request.get('/backend/campaigns/'+row.id+'/evidence')).ok()){id=row.id;break}}
 expect(id).not.toBeNull();await page.getByRole('button',{name:'캠페인 '+id!.slice(0,8),exact:true}).click();
 const button=page.getByRole('button',{name:'현재 판정의 서명 기록 저장',exact:true});await expect(button).toBeEnabled();
 let posts=0;const path='**/backend/campaigns/'+id+'/receipts';await page.route(path,async route=>{if(route.request().method()==='POST'){posts++;await route.abort('failed')}else await route.continue()});
 try{await button.click();await expect(page.getByText(uncertainCampaignWrite,{exact:true})).toBeVisible();await expect(button).toBeEnabled();expect(posts).toBe(1);await expect(page.getByText('브라우저 Ed25519 서명 검증 완료 · 개발용 공개키',{exact:true})).toHaveCount(0)}finally{await page.unroute(path)}
 phase('receipt write intercepted and never forwarded; lost response gives fixed uncertain guidance and no automatic retry or verified receipt; no business writes');
});
test('editor sees uncertain write guidance after an intercepted POST timeout without resubmission',async({page})=>{
 await login(page,'demo-editor');
 const path='**/backend/versions/agents',button=page.getByRole('button',{name:'에이전트 버전 고정',exact:true});
 await expect(button).toBeEnabled();let release!:()=>void,finished!:()=>void,entered!:()=>void,posts=0;
 const held=new Promise<void>(resolve=>release=resolve),done=new Promise<void>(resolve=>finished=resolve),started=new Promise<void>(resolve=>entered=resolve);
 await page.route(path,async route=>{if(route.request().method()!=='POST'){await route.continue();return}posts++;entered();await held;try{await route.abort()}catch{}finally{finished()}});
 try{await button.click();await started;await expect(button).toBeDisabled();await expect(page.getByText(uncertainCampaignWrite,{exact:true})).toBeVisible({timeout:12000});await expect(button).toBeEnabled();expect(posts).toBe(1);release();await done;await expect(page.getByText(uncertainCampaignWrite,{exact:true})).toBeVisible();expect(posts).toBe(1)}
 finally{release();await done;await page.unroute(path)}
 await page.route(path,async route=>{if(route.request().method()==='POST'){posts++;await route.fulfill({status:200,contentType:'application/json',body:'{"fixture-private-response":'})}else await route.continue()});
 try{await button.click();await expect(page.getByText(uncertainCampaignWrite,{exact:true})).toBeVisible();await expect(button).toBeEnabled();expect(posts).toBe(2);await expect(page.getByText('fixture-private-response',{exact:false})).toHaveCount(0)}finally{await page.unroute(path)}
 phase('registration POST intercepted without forwarding; timeout is uncertain, controls recover and no automatic resubmission occurs; no business writes');
});
test('viewer recovers campaign selection after a stalled read and HTTP 503 without automatic retry',async({page})=>{
 await login(page,'demo-viewer');
 const records=await (await page.request.get('/backend/campaigns')).json() as {id:string}[];
 expect(records.length).toBeGreaterThan(0);const id=records[0].id,path='**/backend/campaigns/'+id;
 const button=page.getByRole('button',{name:'캠페인 '+id.slice(0,8),exact:true});await expect(button).toBeVisible();
 let release!:()=>void,finished!:()=>void,entered!:()=>void,requests=0;
 const held=new Promise<void>(resolve=>release=resolve),done=new Promise<void>(resolve=>finished=resolve),started=new Promise<void>(resolve=>entered=resolve);
 await page.route(path,async route=>{requests++;entered();await held;try{await route.abort()}catch{}finally{finished()}});
 try{await button.click();await started;await expect(button).toBeDisabled();await expect(button).toBeEnabled({timeout:12000});expect(requests).toBe(1);await expect(page.getByRole('heading',{name:'캠페인 평가 근거',exact:true})).toHaveCount(0)}
 finally{release();await done;await page.unroute(path)}
 await page.route(path,route=>route.fulfill({status:503,contentType:'application/json',body:'{}'}));
 try{await button.click();await expect(page.getByText('캠페인 요청을 확인하지 못했습니다.',{exact:true})).toBeVisible();await expect(button).toBeEnabled()}
 finally{await page.unroute(path)}
 await page.route(path,route=>route.fulfill({status:200,contentType:'application/json',body:'{"fixture-private-read":'}));
 try{await button.click();await expect(page.getByText('캠페인 요청을 확인하지 못했습니다.',{exact:true})).toBeVisible();await expect(button).toBeEnabled();await expect(page.getByText('fixture-private-read',{exact:false})).toHaveCount(0);await expect(page.getByRole('heading',{name:'캠페인 평가 근거',exact:true})).toHaveCount(0)}finally{await page.unroute(path)}
 await button.click();await expect(page.getByRole('heading',{name:'캠페인 평가 근거',exact:true})).toBeVisible();await expect(button).toBeEnabled();
 phase('campaign read timeout and503 release controls; no automatic retry or business writes; explicit retry restores actual scoped campaign');
});
const users=JSON.parse(readFileSync(resolve(process.cwd(),'../../.local/stack/demo-credentials.json'),'utf-8')) as {username:string;password:string;organizationId:string}[];
test('viewer searches actual scoped audit actions and resources and rejects a substituted search frame',async({page})=>{
 await login(page,'demo-viewer');const reference=await (await page.request.get('/backend/audit-search/all/all')).json();expect(reference.entries).toHaveLength(25);const supported=await (await page.request.get('/backend/audit-search/version.agents.retired/all')).json();const entry=supported.entries[0];expect(entry).toBeDefined();expect(auditFilters(entry.action,entry.resourceId).action).toBe('version.agents.retired');const region=page.getByRole('region',{name:'감사 기록 검색',exact:true});
 await region.getByLabel('감사 작업 종류',{exact:true}).selectOption(entry.action);await region.getByLabel('감사 대상 ID',{exact:true}).fill(entry.resourceId);await region.getByRole('button',{name:'감사 기록 검색 실행',exact:true}).click();await expect(region.locator('[data-audit-search-id="'+entry.id+'"]')).toBeVisible();
 const rows=region.locator('[data-audit-search-id]');for(let index=0;index<await rows.count();index++){await expect(rows.nth(index)).toContainText(entry.action);await expect(rows.nth(index)).toContainText(entry.resourceId)}
 await region.getByLabel('감사 작업 종류',{exact:true}).selectOption('all');await expect(rows).toHaveCount(0);await region.getByLabel('감사 대상 ID',{exact:true}).fill('');await region.getByRole('button',{name:'감사 기록 검색 실행',exact:true}).click();await expect(rows).toHaveCount(25);const first=await rows.evaluateAll(values=>values.map(row=>row.getAttribute('data-audit-search-id')));
 const nextPath='**/backend/audit-search/all/all/'+reference.nextCursor;
 try{await page.route(nextPath,route=>route.fulfill({status:503,contentType:'application/json',body:'{}'}));await region.getByRole('button',{name:'다음 검색 페이지',exact:true}).click();await expect(region.getByRole('status')).toContainText('감사 검색을 확인하지 못했습니다.');await expect(rows).toHaveCount(0);await expect(region.getByRole('navigation',{name:'감사 검색 페이지',exact:true})).toHaveCount(0)}finally{await page.unroute(nextPath)}
 await region.getByRole('button',{name:'감사 기록 검색 실행',exact:true}).click();await expect(rows).toHaveCount(25);expect(await rows.evaluateAll(values=>values.map(row=>row.getAttribute('data-audit-search-id')))).toEqual(first);
 await region.getByRole('button',{name:'다음 검색 페이지',exact:true}).click();await expect(region.getByText('검색 페이지 2 · 25개 기록 · 25개 표시',{exact:true})).toBeVisible();const second=await rows.evaluateAll(values=>values.map(row=>row.getAttribute('data-audit-search-id')));expect(second.some(id=>first.includes(id))).toBe(false);await region.getByRole('button',{name:'이전 검색 페이지',exact:true}).click();await expect(region.getByText('검색 페이지 1 · 25개 기록 · 25개 표시',{exact:true})).toBeVisible();expect(await rows.evaluateAll(values=>values.map(row=>row.getAttribute('data-audit-search-id')))).toEqual(first);
 phase('failed next-page request clears older rows and page controls; manual restart restores the first page before distinct next and previous navigation');
 const path='**/backend/audit-search/all/all';try{await page.route(path,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...reference,filters:{action:'review.approved',resourceId:null}})}));await region.getByRole('button',{name:'감사 기록 검색 실행',exact:true}).click();await expect(region.getByRole('status')).toContainText('감사 검색을 확인하지 못했습니다.');await expect(rows).toHaveCount(0)}finally{await page.unroute(path)}
 // Hold a real old-condition response until a new search has completed. The
 // cancelled request must not restore its rows, status or pagination controls.
 let releaseOld!:()=>void,oldStarted!:()=>void,oldFinished!:()=>void;const heldOld=new Promise<void>(resolve=>{releaseOld=resolve}),startedOld=new Promise<void>(resolve=>{oldStarted=resolve}),finishedOld=new Promise<void>(resolve=>{oldFinished=resolve});
 await page.route(path,async route=>{oldStarted();await heldOld;try{await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(reference)})}catch{expect(route.request().failure()?.errorText).toMatch(/abort|cancel|failed/i)}finally{oldFinished()}});
 try{
  await region.getByRole('button',{name:'감사 기록 검색 실행',exact:true}).click();await startedOld;await expect(region.getByRole('button',{name:'감사 기록 검색 실행',exact:true})).toBeDisabled();
  await region.getByLabel('감사 작업 종류',{exact:true}).selectOption(entry.action);await region.getByLabel('감사 대상 ID',{exact:true}).fill(entry.resourceId);await expect(rows).toHaveCount(0);await expect(region.getByRole('button',{name:'감사 기록 검색 실행',exact:true})).toBeEnabled();
  await region.getByRole('button',{name:'감사 기록 검색 실행',exact:true}).click();await expect(region.locator('[data-audit-search-id="'+entry.id+'"]')).toBeVisible();const fresh=await rows.evaluateAll(values=>values.map(row=>row.getAttribute('data-audit-search-id')));
  releaseOld();await finishedOld;await expect.poll(()=>rows.evaluateAll(values=>values.map(row=>row.getAttribute('data-audit-search-id')))).toEqual(fresh);await expect(region.getByRole('status')).toHaveText('');
  for(let index=0;index<await rows.count();index++){await expect(rows.nth(index)).toContainText(entry.action);await expect(rows.nth(index)).toContainText(entry.resourceId)}
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
 }finally{releaseOld();await page.unroute(path)}
 let invalidRequests=0;const countInvalid=()=>{invalidRequests++};const invalidPath='**/backend/audit-search/**/invalid-target';await page.route(invalidPath,async route=>{countInvalid();await route.abort()});
 try{await region.getByLabel('감사 대상 ID',{exact:true}).fill('invalid-target');await region.getByRole('button',{name:'감사 기록 검색 실행',exact:true}).click();await expect(region.getByRole('status')).toContainText('감사 검색을 확인하지 못했습니다.');await expect(rows).toHaveCount(0);expect(invalidRequests).toBe(0)}finally{await page.unroute(invalidPath)}
 await region.getByLabel('감사 작업 종류',{exact:true}).selectOption('all');await region.getByLabel('감사 대상 ID',{exact:true}).fill('');
 try{await page.route(path,route=>route.fulfill({status:503,contentType:'application/json',body:'{}'}));await region.getByRole('button',{name:'감사 기록 검색 실행',exact:true}).click();await expect(region.getByRole('status')).toContainText('감사 검색을 확인하지 못했습니다.');await expect(rows).toHaveCount(0);await expect(region.getByRole('button',{name:'감사 기록 검색 실행',exact:true})).toBeEnabled()}finally{await page.unroute(path)}
 await region.getByRole('button',{name:'감사 기록 검색 실행',exact:true}).click();await expect(rows).toHaveCount(25);await expect(region.getByRole('status')).toHaveText('');
 // Exercise the production AbortSignal timeout without mocking browser clocks.
 let releaseTimeout!:()=>void,timeoutStarted!:()=>void,timeoutFinished!:()=>void;const heldTimeout=new Promise<void>(resolve=>{releaseTimeout=resolve}),startedTimeout=new Promise<void>(resolve=>{timeoutStarted=resolve}),finishedTimeout=new Promise<void>(resolve=>{timeoutFinished=resolve});
 await page.route(path,async route=>{timeoutStarted();await heldTimeout;try{await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(reference)})}catch{expect(route.request().failure()?.errorText).toMatch(/abort|cancel|failed/i)}finally{timeoutFinished()}});
 try{await region.getByRole('button',{name:'감사 기록 검색 실행',exact:true}).click();await startedTimeout;await expect(rows).toHaveCount(0);await expect(region.getByRole('button',{name:'감사 기록 검색 실행',exact:true})).toBeDisabled();await expect(region.getByRole('status')).toContainText('감사 검색을 확인하지 못했습니다.',{timeout:15000});await expect(region.getByRole('button',{name:'감사 기록 검색 실행',exact:true})).toBeEnabled();releaseTimeout();await finishedTimeout;await expect(rows).toHaveCount(0);await expect(region.getByRole('status')).toContainText('감사 검색을 확인하지 못했습니다.')}finally{releaseTimeout();await page.unroute(path)}
 await region.getByRole('button',{name:'감사 기록 검색 실행',exact:true}).click();await expect(rows).toHaveCount(25);await expect(region.getByRole('status')).toHaveText('');
 phase('actual ten-second browser request timeout clears rows, releases the search button, ignores the delayed response and permits a successful manual retry; clocks and timeout implementation unchanged');
 const completed=await (await page.request.get('/backend/audit-search/evaluation.completed/all')).json();expect(completed.entries.length).toBeGreaterThan(0);const runEntry=completed.entries[0];await region.getByLabel('감사 작업 종류',{exact:true}).selectOption(runEntry.action);await region.getByLabel('감사 대상 ID',{exact:true}).fill(runEntry.resourceId);await region.getByRole('button',{name:'감사 기록 검색 실행',exact:true}).click();const runRow=region.locator('[data-audit-search-id="'+runEntry.id+'"]');await expect(runRow).toBeVisible();await region.getByLabel('감사 작업자 ID',{exact:true}).fill(runEntry.actorId);await region.getByRole('button',{name:'작업자 필터 적용',exact:true}).click();await expect(runRow).toBeVisible();await region.getByLabel('감사 작업자 ID',{exact:true}).fill('invalid');await region.getByRole('button',{name:'작업자 필터 적용',exact:true}).click();await expect(region.getByRole('alert')).toHaveText('작업자 ID는 정확한 소문자 UUID로 입력해 주세요.');await expect(runRow).toBeVisible();await region.getByRole('button',{name:'작업자 필터 해제',exact:true}).click();await expect(region.getByRole('alert')).toHaveText('');await runRow.getByRole('button',{name:'평가 근거 '+runEntry.resourceId.slice(0,8),exact:true}).click();await expect(page.locator('.evidence').getByText('실행 '+runEntry.resourceId,{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'검토 저장·게이트 확인',exact:true})).toHaveCount(0);
 phase('viewer opens the exact existing scoped evaluation from a verified audit row without gaining review authority or writing business records');
 await page.getByRole('button',{name:'근거 해시·버전 확인',exact:true}).click();await expect(page.getByText('서버와 브라우저의 바이트 해시 검증 완료',{exact:false})).toBeVisible();
 const other=completed.entries.find((value:{resourceId:string})=>value.resourceId!==runEntry.resourceId);expect(other).toBeDefined();await region.getByLabel('감사 대상 ID',{exact:true}).fill(other.resourceId);await region.getByRole('button',{name:'감사 기록 검색 실행',exact:true}).click();const otherRow=region.locator('[data-audit-search-id="'+other.id+'"]');await expect(otherRow).toBeVisible();
 const detailPath='**/backend/runs/'+other.resourceId;let releaseDetail!:()=>void,detailStarted!:()=>void;const heldDetail=new Promise<void>(resolve=>{releaseDetail=resolve}),startedDetail=new Promise<void>(resolve=>{detailStarted=resolve});await page.route(detailPath,async route=>{const response=await route.fetch();detailStarted();await heldDetail;await route.fulfill({response})});
 try{await otherRow.getByRole('button',{name:'평가 근거 '+other.resourceId.slice(0,8),exact:true}).click();await startedDetail;await expect(page.locator('.evidence')).toHaveCount(0);await expect(page.getByText('서버와 브라우저의 바이트 해시 검증 완료',{exact:false})).toHaveCount(0);releaseDetail();await expect(page.locator('.evidence').getByText('실행 '+other.resourceId,{exact:true})).toBeVisible();await expect(page.getByText('서버와 브라우저의 바이트 해시 검증 완료',{exact:false})).toHaveCount(0)}finally{releaseDetail();await page.unroute(detailPath)}
 phase('switching evaluation from audit clears previous detail gate and verified archive before a held actual detail response arrives; new detail does not inherit the previous archive proof');
 await region.getByLabel('감사 대상 ID',{exact:true}).fill(runEntry.resourceId);await region.getByRole('button',{name:'감사 기록 검색 실행',exact:true}).click();const failedDetailPath='**/backend/runs/'+runEntry.resourceId;
 try{await page.route(failedDetailPath,route=>route.fulfill({status:404,contentType:'application/json',body:'{}'}));await region.locator('[data-audit-search-id="'+runEntry.id+'"]').getByRole('button',{name:'평가 근거 '+runEntry.resourceId.slice(0,8),exact:true}).click();await expect(page.getByText('평가 근거를 확인하지 못했습니다. 다시 선택해 주세요.',{exact:true})).toBeVisible();await expect(page.locator('.evidence')).toHaveCount(0)}finally{await page.unroute(failedDetailPath)}
 await region.locator('[data-audit-search-id="'+runEntry.id+'"]').getByRole('button',{name:'평가 근거 '+runEntry.resourceId.slice(0,8),exact:true}).click();await expect(page.locator('.evidence').getByText('실행 '+runEntry.resourceId,{exact:true})).toBeVisible();
 phase('unavailable audit target leaves no previous evaluation detail or authority; selecting the same verified row again recovers through the real scoped API');
 const actorPath='/backend/audit-actor-search/'+entry.actorId+'/all/all',actorResponse=await page.request.get(actorPath);
 if(process.env.STACK_E2E_LEGACY_CORE_RETURN==='true'){
  expect(actorResponse.status()).toBe(500);
  await region.getByLabel('감사 작업 종류',{exact:true}).selectOption('all');await region.getByLabel('감사 대상 ID',{exact:true}).fill('');await region.getByLabel('전체 이력 작업자 ID',{exact:true}).fill(entry.actorId);
  const unsupported=page.waitForResponse(response=>new URL(response.url()).pathname===actorPath);await region.getByRole('button',{name:'감사 기록 검색 실행',exact:true}).click();expect((await unsupported).status()).toBe(500);await expect(region.getByRole('status')).toContainText('감사 검색을 확인하지 못했습니다.');await expect(rows).toHaveCount(0);
  await region.getByLabel('전체 이력 작업자 ID',{exact:true}).fill('');await region.getByRole('button',{name:'감사 기록 검색 실행',exact:true}).click();await expect(rows).toHaveCount(25);
  phase('actual previous Core refuses unsupported actor route and legacy audit search recovers without fabricated rows');
 }else{
 expect(actorResponse.status()).toBe(200);const actorReference=await actorResponse.json();expect(actorReference.actorId).toBe(entry.actorId);expect(actorReference.entries.length).toBeGreaterThan(0);
 await region.getByLabel('감사 작업 종류',{exact:true}).selectOption('all');await region.getByLabel('감사 대상 ID',{exact:true}).fill('');await region.getByLabel('전체 이력 작업자 ID',{exact:true}).fill(entry.actorId);await region.getByRole('button',{name:'감사 기록 검색 실행',exact:true}).click();await expect(rows).toHaveCount(actorReference.entries.length);expect(await rows.evaluateAll(values=>values.map(row=>row.getAttribute('data-audit-search-id')))).toEqual(actorReference.entries.map((value:{id:string})=>value.id));
 if(actorReference.nextCursor){await region.getByRole('button',{name:'다음 검색 페이지',exact:true}).click();await expect(region.getByText(/검색 페이지 2/)).toBeVisible();for(let index=0;index<await rows.count();index++)await expect(rows.nth(index)).toContainText(entry.actorId);}
 await page.route('**'+actorPath,route=>route.fulfill({status:404,contentType:'application/json',body:'{}'}));
 try{await region.getByRole('button',{name:'감사 기록 검색 실행',exact:true}).click();await expect(region.getByRole('status')).toContainText('현재 Core는 전체 이력 작업자 검색을 지원하지 않습니다.');await expect(rows).toHaveCount(0);}finally{await page.unroute('**'+actorPath)}
 await region.getByLabel('전체 이력 작업자 ID',{exact:true}).fill('');await region.getByRole('button',{name:'감사 기록 검색 실행',exact:true}).click();await expect(rows).toHaveCount(25);
 await region.getByLabel('전체 이력 작업자 ID',{exact:true}).fill(entry.actorId);
 const actorRoute='**'+actorPath;
 await page.route(actorRoute,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...actorReference,actorId:entry.actorId==='11111111-1111-4111-8111-111111111111'?'22222222-2222-4222-8222-222222222222':'11111111-1111-4111-8111-111111111111'})}));
 try{await region.getByRole('button',{name:'감사 기록 검색 실행',exact:true}).click();await expect(region.getByRole('status')).toContainText('감사 검색을 확인하지 못했습니다.');await expect(rows).toHaveCount(0);}finally{await page.unroute(actorRoute)}
 let releaseActor!:()=>void,startActor!:()=>void;const heldActor=new Promise<void>(resolve=>{releaseActor=resolve}),actorStarted=new Promise<void>(resolve=>{startActor=resolve});
 await page.route(actorRoute,async route=>{const response=await route.fetch();startActor();await heldActor;await route.fulfill({response})});
 try{
  await region.getByRole('button',{name:'감사 기록 검색 실행',exact:true}).click();await actorStarted;
  await region.getByRole('button',{name:'감사 검색 취소',exact:true}).click();await expect(rows).toHaveCount(0);await expect(region.getByRole('button',{name:'감사 기록 검색 실행',exact:true})).toBeEnabled();
  await region.getByLabel('전체 이력 작업자 ID',{exact:true}).fill('');await region.getByRole('button',{name:'감사 기록 검색 실행',exact:true}).click();await expect(rows).toHaveCount(25);const afterCancel=await rows.evaluateAll(values=>values.map(row=>row.getAttribute('data-audit-search-id')));
  releaseActor();await page.waitForTimeout(100);expect(await rows.evaluateAll(values=>values.map(row=>row.getAttribute('data-audit-search-id')))).toEqual(afterCancel);
 }finally{releaseActor();await page.unroute(actorRoute)}
 phase('substituted actor frame refused; cancelled held actual actor response cannot overwrite newer legacy search; no business writes');
 phase('actual whole-history actor query uses scoped Java rows and retains original search after unsupported actor endpoint; no business writes');
 }
 const utcDay=reference.entries[0].createdAt.slice(0,10),periodPath='/backend/audit-period-search/'+utcDay+'/'+utcDay+'/all/all/all';
 await region.getByLabel('전체 이력 작업자 ID',{exact:true}).fill('');await region.getByLabel('감사 작업 종류',{exact:true}).selectOption('all');await region.getByLabel('감사 대상 ID',{exact:true}).fill('');
 await region.getByLabel('감사 UTC 시작일',{exact:true}).fill(utcDay);await region.getByLabel('감사 UTC 종료일',{exact:true}).fill(utcDay);
 const periodResponse=await page.request.get(periodPath);
 if(process.env.STACK_E2E_LEGACY_CORE_RETURN==='true'){
  expect(periodResponse.status()).toBe(500);await region.getByRole('button',{name:'감사 기록 검색 실행',exact:true}).click();await expect(region.getByRole('status')).toContainText('이전 Core는 기간 검색을 지원하지 않을 수 있습니다.');await expect(rows).toHaveCount(0);
  await region.getByRole('button',{name:'기간 JSON 첫 구간 다운로드',exact:true}).click();await expect(region.getByLabel('기간 JSON 내보내기 상태')).toContainText('기간 JSON 내보내기를 확인하지 못했습니다.');await expect(region.getByRole('button',{name:'기간 JSON 다음 구간 다운로드',exact:true})).toBeDisabled();
  phase('actual previous Core period search/export stays unavailable with zero fabricated rows/files');
 }else{
  expect(periodResponse.status()).toBe(200);const periodReference=await periodResponse.json();expect(periodReference.startDay).toBe(utcDay);expect(periodReference.endDay).toBe(utcDay);expect(periodReference.entries).toHaveLength(25);expect(periodReference.nextCursor).toBeTruthy();
  await region.getByRole('button',{name:'감사 기록 검색 실행',exact:true}).click();await expect(rows).toHaveCount(25);const firstPeriod=await rows.evaluateAll(values=>values.map(row=>row.getAttribute('data-audit-search-id')));expect(firstPeriod).toEqual(periodReference.entries.map((value:{id:string})=>value.id));
  await region.getByRole('button',{name:'다음 검색 페이지',exact:true}).click();await expect(region.getByText(/검색 페이지 2/)).toBeVisible();expect((await rows.evaluateAll(values=>values.map(row=>row.getAttribute('data-audit-search-id')))).some(id=>firstPeriod.includes(id))).toBe(false);
  await region.getByLabel('감사 UTC 종료일',{exact:true}).fill('');let invalidPeriodRequests=0;const countPeriodRequest=(request:import('@playwright/test').Request)=>{if(new URL(request.url()).pathname.startsWith('/backend/audit-period-search/'))invalidPeriodRequests++};page.on('request',countPeriodRequest);
  try{await region.getByRole('button',{name:'감사 기록 검색 실행',exact:true}).click();await expect(region.getByRole('status')).toContainText('UTC 시작·종료일은 모두 입력');await expect(rows).toHaveCount(0);expect(invalidPeriodRequests).toBe(0);}finally{page.off('request',countPeriodRequest)}
  await region.getByLabel('감사 UTC 종료일',{exact:true}).fill(utcDay);const periodRoute='**'+periodPath;
  await page.route(periodRoute,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...periodReference,startDay:'1970-01-01'})}));
  try{await region.getByRole('button',{name:'감사 기록 검색 실행',exact:true}).click();await expect(region.getByRole('status')).toContainText('감사 검색을 확인하지 못했습니다.');await expect(rows).toHaveCount(0);}finally{await page.unroute(periodRoute)}
  await page.route(periodRoute,route=>route.fulfill({status:503,contentType:'application/json',body:'{}'}));
  try{await region.getByRole('button',{name:'감사 기록 검색 실행',exact:true}).click();await expect(region.getByRole('status')).toContainText('감사 검색을 확인하지 못했습니다.');await expect(rows).toHaveCount(0);}finally{await page.unroute(periodRoute)}
  await region.getByRole('button',{name:'감사 기록 검색 실행',exact:true}).click();await expect(rows).toHaveCount(25);
  const exportPath=periodPath.replace('/audit-period-search/','/audit-period-export/'),exportRoute='**'+exportPath;
  const firstDownload=page.waitForEvent('download');await region.getByRole('button',{name:'기간 JSON 첫 구간 다운로드',exact:true}).click();const firstFile=await firstDownload,firstFilePath=await firstFile.path();expect(firstFilePath).toBeTruthy();const firstChunk=JSON.parse(readFileSync(firstFilePath!,'utf8'));expect(firstChunk.recordCount).toBe(250);expect(firstChunk.nextCursor).toBeTruthy();expect(firstChunk.entireProjectHistory).toBe(false);expect(firstChunk.signed).toBe(false);
  const nextDownload=page.waitForEvent('download');await region.getByRole('button',{name:'기간 JSON 다음 구간 다운로드',exact:true}).click();const nextFilePath=await (await nextDownload).path();const nextChunk=JSON.parse(readFileSync(nextFilePath!,'utf8'));expect(nextChunk.requestedCursor).toBe(firstChunk.nextCursor);expect(nextChunk.recordCount).toBe(250);expect(nextChunk.entries.some((row:{id:string})=>firstChunk.entries.some((previous:{id:string})=>previous.id===row.id))).toBe(false);
  const actualExport=await (await page.request.get(exportPath)).json();let refusedDownloads=0;const countDownload=()=>refusedDownloads++;page.on('download',countDownload);
  await page.route(exportRoute,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...actualExport,contentSha256:'0'.repeat(64)})}));
  try{await region.getByRole('button',{name:'기간 JSON 첫 구간 다운로드',exact:true}).click();await expect(region.getByLabel('기간 JSON 내보내기 상태')).toContainText('기간 JSON 내보내기를 확인하지 못했습니다.');expect(refusedDownloads).toBe(0);await expect(region.getByRole('button',{name:'기간 JSON 다음 구간 다운로드',exact:true})).toBeDisabled();}finally{await page.unroute(exportRoute)}
  let releaseExport!:()=>void,markExport!:()=>void;const heldExport=new Promise<void>(resolve=>releaseExport=resolve),exportEntered=new Promise<void>(resolve=>markExport=resolve);
  await page.route(exportRoute,async route=>{const response=await route.fetch();markExport();await heldExport;await route.fulfill({response})});
  try{await region.getByRole('button',{name:'기간 JSON 첫 구간 다운로드',exact:true}).click();await exportEntered;await region.getByRole('button',{name:'감사 검색 취소',exact:true}).click();await region.getByLabel('감사 UTC 종료일',{exact:true}).fill('');releaseExport();await page.waitForTimeout(150);expect(refusedDownloads).toBe(0);await expect(region.getByRole('button',{name:'기간 JSON 다음 구간 다운로드',exact:true})).toBeDisabled();await region.getByLabel('감사 UTC 종료일',{exact:true}).fill(utcDay);}finally{releaseExport();await page.unroute(exportRoute);page.off('download',countDownload)}
  phase('actual period JSON downloads traverse250record chunks without overlap; corrupt hash and cancelled delayed response create no download; each file is a separate query without whole-project/signature claims');
  phase('actual inclusive UTC audit period pagination; invalid partial day sends no request; substituted date and503 clear rows before manual recovery');
 }
 await region.getByLabel('감사 UTC 시작일',{exact:true}).fill('');await region.getByLabel('감사 UTC 종료일',{exact:true}).fill('');await region.getByRole('button',{name:'감사 기록 검색 실행',exact:true}).click();await expect(rows).toHaveCount(25);
 phase('clearing both UTC dates restores existing scoped audit search without writes');
 phase('actual viewer audit search verifies distinct pages, rejects substituted frames and ignores a delayed cancelled response after a new condition finishes; mobile viewport has no document overflow; invalid UUID sends no request and an HTTP 503 clears results before a successful manual retry; no business writes');
});

test('administrator retires an owned version in the browser and cannot select it for a new campaign',async({page})=>{
 await login(page,'demo-admin');
 const csrf=(await (await page.request.get('/backend/csrf')).json()).token,key='browser-life-'+randomUUID();
 const registered=await page.request.post('/backend/versions/agents',{headers:{'X-CSRF-TOKEN':csrf,Origin:'http://127.0.0.1:4320'},data:{key,version:1,provider:'synthetic',description:'Own browser retirement fixture'}});expect(registered.status()).toBe(200);const registration=await registered.json();const originalResponse=await page.request.get('/backend/versions/agents/'+registration.id);expect(originalResponse.status()).toBe(200);const original=await originalResponse.json();expect(original.id).toBe(registration.id);expect(original.content_sha256).toBe(registration.content_sha256);
 const datasetResponse=await page.request.post('/backend/versions/datasets',{headers:{'X-CSRF-TOKEN':csrf,Origin:'http://127.0.0.1:4320'},data:{key:'browser-life-data-'+randomUUID(),version:1,cases:[{id:'required',scenario:'pass',required:true}]}});expect(datasetResponse.status()).toBe(200);const dataset=await datasetResponse.json();
 const admitted=await page.request.post('/backend/campaigns',{headers:{'X-CSRF-TOKEN':csrf,Origin:'http://127.0.0.1:4320','Idempotency-Key':randomUUID()},data:{agentVersionId:original.id,datasetVersionId:dataset.id,requiresApproval:true}});expect(admitted.status()).toBe(200);const campaignId=(await admitted.json()).id;
 await expect.poll(async()=>(await (await page.request.get('/backend/campaigns/'+campaignId)).json()).state,{timeout:35000}).toBe('succeeded');expect((await page.request.post('/backend/campaigns/'+campaignId+'/reviews',{headers:{'X-CSRF-TOKEN':csrf,Origin:'http://127.0.0.1:4320'},data:{decision:'approved',reason:'Own browser pre-retirement approval'}})).status()).toBe(200);
 await expect.poll(async()=>(await page.request.get('/backend/campaigns/'+campaignId+'/evidence')).status(),{timeout:15000}).toBe(200);
 await page.reload();await expect(page.getByRole('button',{name:'로그아웃',exact:true})).toBeVisible();const workspace=page.getByRole('region',{name:'버전과 평가 캠페인',exact:true});await workspace.getByRole('button',{name:'캠페인 '+campaignId.slice(0,8),exact:true}).click();await expect(workspace.getByText('캠페인 릴리스 허용',{exact:true})).toBeVisible();const checks=page.getByRole('region',{name:'서명된 현재 판정 확인',exact:true});await checks.getByRole('button',{name:'현재 판정 서명 확인',exact:true}).click();await expect(checks.getByText('서명 확인 완료 · 합성 릴리스 허용',{exact:true})).toBeVisible();
 const region=page.getByRole('region',{name:'프로젝트 에이전트 버전 이력',exact:true});await region.getByRole('button',{name:'에이전트 버전 이력 조회',exact:true}).click();
 const row=region.locator('[data-version-history-id="'+original.id+'"]');await expect(row).toBeVisible();await row.getByRole('button',{name:'버전 상태 확인',exact:true}).click();await expect(row.getByText('상태: 활성',{exact:true})).toBeVisible();
 const gateRoute='**/backend/campaigns/'+campaignId+'/gate';let releaseGate!:()=>void;const heldGate=new Promise<void>(resolve=>{releaseGate=resolve});await page.route(gateRoute,async route=>{await heldGate;await route.continue()});
 try{await row.getByLabel('버전 폐기 사유',{exact:true}).fill('Own browser immutable retirement');await row.getByRole('button',{name:'이 버전 폐기',exact:true}).click();await expect(row.getByText('상태: 폐기',{exact:true})).toBeVisible();await expect(workspace.getByText('캠페인 릴리스 허용',{exact:true})).toHaveCount(0);await expect(page.getByText('서명 확인 완료 · 합성 릴리스 허용',{exact:true})).toHaveCount(0);releaseGate();await expect(workspace.getByText('캠페인 릴리스 허용 안 됨',{exact:true})).toBeVisible();}finally{releaseGate();await page.unroute(gateRoute)}
 await expect(row.getByText('폐기 사유: Own browser immutable retirement',{exact:true})).toBeVisible();await expect(row.getByRole('button',{name:'이 버전 폐기',exact:true})).toHaveCount(0);
 const selection=page.getByLabel('캠페인 에이전트 버전',{exact:true}),before=await selection.inputValue();let campaignPosts=0;page.on('request',request=>{if(new URL(request.url()).pathname==='/backend/campaigns'&&request.method()==='POST')campaignPosts++});
 await row.getByRole('button',{name:'에이전트 버전 '+key+' / v1 선택',exact:true}).click();await expect(region.getByText('폐기된 버전입니다. 새 평가 실행에 선택할 수 없습니다.',{exact:true})).toBeVisible();await expect(selection).toHaveValue(before);expect(campaignPosts).toBe(0);
 expect(await (await page.request.get('/backend/versions/agents/'+original.id)).json()).toEqual(original);phase('actual Java retirement through administrator UI immediately clears old allowed gate and current signature while the fresh gate is delayed; immutable bytes survive and retired selection is refused without another campaign submission');
});

test('viewer reads an actual retired version without a retirement control',async({page})=>{
 await login(page,'demo-admin');const csrf=(await (await page.request.get('/backend/csrf')).json()).token;const created=await page.request.post('/backend/versions/agents',{headers:{'X-CSRF-TOKEN':csrf,Origin:'http://127.0.0.1:4320'},data:{key:'browser-viewer-life-'+randomUUID(),version:1,provider:'synthetic',description:'Own independent viewer retirement fixture'}});expect(created.status()).toBe(200);const version=await created.json(),reason='Own independent viewer retirement';const retirement=await page.request.post('/backend/versions/agents/'+version.id+'/lifecycle/retirement',{headers:{'X-CSRF-TOKEN':csrf,Origin:'http://127.0.0.1:4320'},data:{reason}});expect(retirement.status()).toBe(200);expect((await retirement.json()).state).toBe('retired');await logout(page);phase('independent owned retired fixture prepared by an administrator before a separate viewer login');
 await login(page,'demo-viewer');const region=page.getByRole('region',{name:'프로젝트 에이전트 버전 이력',exact:true});await region.getByRole('button',{name:'에이전트 버전 이력 조회',exact:true}).click();await expect(region.locator('[data-version-history-id]').first()).toBeVisible();
 const row=region.locator('[data-version-history-id="'+version.id+'"]');await expect(row).toBeVisible();await row.getByRole('button',{name:'버전 상태 확인',exact:true}).click();await expect(row.getByText('상태: 폐기',{exact:true})).toBeVisible();await expect(row.getByText('폐기 사유: '+reason,{exact:true})).toBeVisible();await expect(row.getByRole('button',{name:'이 버전 폐기',exact:true})).toHaveCount(0);await expect(row.getByLabel('버전 폐기 사유',{exact:true})).toHaveCount(0);
 phase('actual viewer Keycloak session reads scoped immutable retirement and has no retirement form');
});

test('viewer downloads bounded scoped audit JSON and refuses changed bytes before download',async({page})=>{
 await login(page,'demo-viewer');const region=page.getByRole('region',{name:'프로젝트 감사 기록',exact:true});const identity=await (await page.request.get('/backend/me')).json();const frame=await (await page.request.get('/backend/audit-export')).json();
 const event=page.waitForEvent('download');await region.getByRole('button',{name:'감사 기록 JSON 다운로드',exact:true}).click();const download=await event;expect(await download.failure()).toBeNull();const stream=await download.createReadStream();expect(stream).not.toBeNull();let bytes=Buffer.alloc(0);for await(const chunk of stream!){bytes=Buffer.concat([bytes,chunk]);expect(bytes.length).toBeLessThanOrEqual(262144)}
 expect(bytes.toString('utf8')).toBe(frame.contentJson);expect(createHash('sha256').update(bytes).digest('hex')).toBe(frame.contentSha256);const doc=JSON.parse(bytes.toString('utf8'));expect(doc.organizationId).toBe(identity.organizationId);expect(doc.projectId).toBe(identity.projectId);expect(doc.signed).toBe(false);expect(doc.currentDeploymentAuthority).toBe(false);expect(doc.entries.length).toBeLessThanOrEqual(500);expect(doc.entireProjectHistory).toBe(!doc.hasOlderRecords);await expect(region.getByRole('status',{name:'감사 기록 조회와 내보내기 상태',exact:true})).toContainText('개 감사 기록을 검증해 내려받았습니다.');phase('actual scoped Java audit JSON bytes hash boundaries and history marker verified before browser download');
 let unexpected=false;const note=()=>{unexpected=true};page.on('download',note);try{await page.route('**/backend/audit-export',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...frame,contentJson:frame.contentJson+' '})}));await region.getByRole('button',{name:'감사 기록 JSON 다운로드',exact:true}).click();await expect(region.getByRole('status',{name:'감사 기록 조회와 내보내기 상태',exact:true})).toContainText('감사 내보내기를 검증하지 못했습니다.');expect(unexpected).toBe(false);phase('changed export bytes refused before emitting a second download')}finally{page.off('download',note);await page.unroute('**/backend/audit-export')}
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('viewer completes a delayed real identity provider callback before authenticated controls are checked',async({page})=>{
 let triggered=false,continued=false;
 await login(page,'demo-viewer',async()=>{
  await page.route(url=>url.origin==='http://127.0.0.1:4322'&&url.pathname.startsWith('/realms/agenttrust/login-actions/'),async route=>{
   if(route.request().method()!=='POST')return route.continue();
   const response=await route.fetch({maxRedirects:0});expect([302,303]).toContain(response.status());
   const target=new URL(response.headers()['location'],response.url());expect(target.origin).toBe('http://127.0.0.1:4320');expect(target.pathname).toBe('/backend/login/oauth2/code/keycloak');
   triggered=true;await new Promise(resolve=>setTimeout(resolve,6000));await route.fulfill({response});continued=true;
  });
 });
 expect(triggered&&continued).toBe(true);const me=await page.request.get('/backend/me');expect(me.status()).toBe(200);expect((await me.json()).role).toBe('viewer');
 phase('actual provider redirect held six seconds; original UI visibility bound unchanged; authenticated home and scoped viewer verified after callback; no business write');
});

function phase(description:string){test.info().annotations.push({type:'phase',description})}
async function login(page:Page,name:string,beforeNavigation?:()=>Promise<unknown>){
 await page.route('**/*',route=>{const url=new URL(route.request().url());if(process.env.STACK_E2E_READ_ONLY==='true'&&url.origin==='http://127.0.0.1:4320'&&url.pathname.startsWith('/backend/')&&route.request().method()!=='GET'&&!['/backend/login','/backend/logout'].includes(url.pathname)){phase('read-only network guard refused unintended business mutation');return route.abort('blockedbyclient')}if(['http://127.0.0.1:4320','http://127.0.0.1:4322'].includes(url.origin))return route.continue();return route.abort()});
 if(beforeNavigation)await beforeNavigation();
 const {initial,entry}=await openWorkspace(page);phase('workspace initial navigation HTTP '+initial!.status());const providerInfo=await page.request.get('/backend/auth-info');phase('authentication provider metadata HTTP '+providerInfo.status());expect(providerInfo.status()).toBe(200);const info=await providerInfo.json();
 const user=users.find(u=>u.username===name)!;
 // Reporter never records invocation arguments, browser traces, cookies or credentials.
 if(info.identityProvider==='keycloak'){await page.getByRole('button',{name:'Keycloak으로 로그인',exact:true}).click();await expect(page.locator('#username')).toBeVisible();await page.evaluate(value=>{document.querySelector<HTMLInputElement>('#username')!.value=value.username;document.querySelector<HTMLInputElement>('#password')!.value=value.password;document.querySelector<HTMLFormElement>('#kc-form-login')!.requestSubmit(document.querySelector<HTMLButtonElement>('#kc-login')!)},{username:user.username,password:user.password});await page.waitForURL('http://127.0.0.1:4320'+entry.authenticatedPath);phase('Keycloak authorization code login into expected Console entry')}
 else {await expect(page.getByRole('button',{name:'로그인',exact:true})).toBeEnabled();await page.evaluate(value=>{const account=document.querySelector<HTMLInputElement>('input[name="username"]')!,password=document.querySelector<HTMLInputElement>('input[name="password"]')!;account.value=value.username;password.value=value.password;account.form!.requestSubmit()}, {username:user.username,password:user.password})}
 await expect(page.getByRole('button',{name:'로그아웃',exact:true})).toBeVisible();phase('authenticated application controls visible');await expect(page.getByText('조직 '+user.organizationId.slice(0,8),{exact:true})).toBeVisible();phase('expected workspace scope visible');
}
test.beforeEach(async({page},info)=>{
 const statuses=new WeakMap<object,number>();let networkRecords=0;
 const recordNetwork=(request:import('@playwright/test').Request,event:'response'|'finished'|'failed')=>{
  if(networkRecords>=48)return;const kind=diagnosticRequestKind(request.url(),request.method());if(!kind)return;
  const value=sanitizedNetworkDiagnostic({kind,event,status:statuses.get(request),failure:diagnosticFailure(event==='failed'?request.failure()?.errorText:null),timing:request.timing()});
  if(value){networkRecords++;info.annotations.push({type:'network-diagnostic',description:JSON.stringify(value)})}
 };
 page.on('response',response=>{statuses.set(response.request(),response.status());recordNetwork(response.request(),'response')});
 page.on('requestfinished',request=>recordNetwork(request,'finished'));
 page.on('requestfailed',request=>recordNetwork(request,'failed'));
 page.on('response',response=>{if(response.status()===429&&new URL(response.url()).origin==='http://127.0.0.1:4320'&&new URL(response.url()).pathname.startsWith('/backend/'))phase('actual gateway HTTP 429 observed; no quota bypass or automatic business write retry')});
 // Only fixed route classes and numeric HTTP status leave the browser. No URL,
 // query, account, request body, cookies, token or response text is recorded.
 page.on('response',response=>{const url=new URL(response.url());if(url.origin!=='http://127.0.0.1:4320')return;const kind=url.pathname==='/backend/me'?'identity bootstrap':url.pathname==='/backend/login/oauth2/code/keycloak'?'OIDC callback':url.pathname==='/backend/campaigns'&&response.request().method()==='POST'?'campaign admission':null;if(kind)phase(kind+' HTTP '+response.status())});
 if(process.env.STACK_E2E_QUOTA_GUARD==='true'){
  const started=Date.now();info.setTimeout(125000);
  const budget=JSON.parse(execFileSync(process.platform==='win32'?'python':'python3',[resolve(process.cwd(),'../../scripts/stack-browser-quota-guard.py')],{encoding:'utf-8',timeout:75000,maxBuffer:16384}));
  expect(budget.completed).toBe(true);expect(budget.quotaLimitsChanged).toBe(false);expect(budget.redisEntriesDeleted).toBe(false);info.setTimeout(45000+Date.now()-started);
  phase('read-only Redis test headroom verified; quotas expire naturally without changing limits or deleting counters');if(budget.waitedForNaturalExpiry)phase('actual project quota expired naturally before this browser test');
 }
});

async function logout(page:Page){const csrf=await page.request.get('/backend/csrf');const token=(await csrf.json()).token;const logout=await page.request.post('/backend/logout',{headers:{'X-CSRF-TOKEN':token,Origin:'http://127.0.0.1:4320'},data:{}});expect(logout.status()).toBe(200);expect((await page.request.get('/backend/me')).status()).toBe(401);const value=await logout.json();if(value.logoutUrl){expect(value.logoutUrl).toBe('http://127.0.0.1:4322/realms/agenttrust/protocol/openid-connect/logout?client_id=agenttrust-console&post_logout_redirect_uri=http%3A%2F%2F127.0.0.1%3A4320%2F');await page.goto(value.logoutUrl);if(new URL(page.url()).port==='4322'){await page.locator('#kc-logout').click();await page.waitForURL('http://127.0.0.1:4320/')}phase('own identity provider session logged out')}phase('own session logged out')}
test.afterEach(async({page})=>{await logout(page)});

test('viewer data tables remain readable and keyboard scrollable on mobile',async({page})=>{
 await login(page,'demo-viewer');
 const cases=[
  ['프로젝트 모델 실행 한도','현재 실행 한도 조회','공급자별 예약과 평가 상태','usage'],
  ['프로젝트 평가 이력','최신 평가 이력 조회','평가 이력 표','runs'],
  ['프로젝트 캠페인 이력','최신 캠페인 이력 조회','캠페인 이력 표','campaigns'],
  ['프로젝트 감사 기록','최신 감사 기록 조회','프로젝트 감사 기록 표','audit'],
  ['감사 기록 검색','감사 기록 검색 실행','감사 검색 결과 표','audit-search']
 ] as const;
 for(const [name,button,label,file] of cases){
  const region=page.getByRole('region',{name,exact:true});await region.getByRole('button',{name:button,exact:true}).click();
  const scroll=page.getByRole('region',{name:label+' · 좁은 화면에서 좌우로 이동',exact:true});await expect(scroll.getByRole('table')).toBeVisible();
  for(const width of [390,1440]){
   await page.setViewportSize({width,height:960});await scroll.scrollIntoViewIfNeeded();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   if(width===390){expect(await scroll.evaluate(n=>n.scrollWidth>n.clientWidth)).toBe(true);await scroll.evaluate(n=>{n.scrollLeft=0});await scroll.focus();await expect(scroll).toBeFocused();await page.keyboard.press('ArrowRight');await expect.poll(()=>scroll.evaluate(n=>n.scrollLeft)).toBeGreaterThan(0);}
   phase('table '+file+' '+width+': horizontal reset');
   // Keyboard scrolling can continue asynchronously after the first positive offset.
   // Wait for that motion to settle before positioning the screenshot fixture.
   await scroll.evaluate(async n=>{
    let previous=n.scrollLeft,stableFrames=0;
    for(let frame=0;frame<180&&stableFrames<6;frame++){
     await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
     const next=n.scrollLeft;stableFrames=Math.abs(next-previous)<0.1?stableFrames+1:0;previous=next;
    }
    if(stableFrames<6)throw Error('TABLE_KEYBOARD_SCROLL_DID_NOT_SETTLE');
    n.scrollIntoView({block:'start',inline:'nearest',behavior:'instant'});
    n.scrollTo({left:0,behavior:'instant'});
   });
   phase('table '+file+' '+width+': keyboard scroll settled; reset requested');
   await expect.poll(()=>scroll.evaluate(n=>n.scrollLeft)).toBe(0);
   // Preserve the actual failing viewport too; assertions remain mandatory.
   await page.screenshot({path:test.info().outputPath('workspace-table-'+file+'-'+width+'.png'),animations:'disabled',maskColor:'#DCE3EA',mask:[page.locator('.account'),page.locator('.scope'),page.locator('.mono'),page.locator('.runs button > span')]});
   phase('table '+file+' '+width+': caption viewport');
   await expect(scroll.locator('caption')).toBeInViewport();
   if(width===390){phase('table '+file+' '+width+': timestamp wrapping');for(const time of await scroll.locator('time').all()){expect(await time.evaluate(n=>getComputedStyle(n).whiteSpace)).toBe('nowrap');}}
   phase('table '+file+' '+width+': visual assertions passed');
  }
 }
 phase('five actual scoped data tables,390px internal keyboard scroll and1440px,page width preserved,no business writes');
});

test('audit export arriving after workspace authentication loss never downloads',async({page})=>{
 await login(page,'demo-viewer');let release!:()=>void,ready!:()=>void;const held=new Promise<void>(resolve=>{release=resolve}),received=new Promise<void>(resolve=>{ready=resolve});let downloads=0;const note=()=>{downloads++};page.on('download',note);
 await page.route('**/backend/audit-export',async route=>{const response=await route.fetch();expect(response.status()).toBe(200);ready();await held;await route.fulfill({response});});
 try{
  await page.getByRole('region',{name:'프로젝트 감사 기록',exact:true}).getByRole('button',{name:'감사 기록 JSON 다운로드',exact:true}).click();await received;
  await page.route('**/backend/me',route=>route.fulfill({status:401,contentType:'application/json',body:'{}'}));await page.getByRole('button',{name:'최근 평가 다시 조회',exact:true}).click();await expect(page.getByRole('button',{name:'Keycloak으로 로그인',exact:true})).toBeVisible();
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/backend/audit-export');release();await (await response).finished();
  const unexpected=await page.waitForEvent('download',{timeout:1500}).then(()=>true,()=>false);expect(unexpected).toBe(false);expect(downloads).toBe(0);
  phase('actual scoped export response held until injected401 unmount;late verified bytes do not trigger download;no business writes');
 }finally{release();page.off('download',note);await page.unroute('**/backend/audit-export');await page.unroute('**/backend/me');}
});

test('viewer navigates real older evaluation pages and opens scoped evidence',async({page})=>{
 phase('history acceptance source step 1');
 await login(page,'demo-viewer');
 const region=page.getByRole('region',{name:'프로젝트 평가 이력',exact:true});
 phase('history acceptance source step 2');
 await region.getByRole('button',{name:'최신 평가 이력 조회',exact:true}).click();
 phase('history acceptance source step 3');
 await expect(region.locator('[data-run-history-id]')).toHaveCount(25);
 phase('history acceptance source step 4');
 const first=await region.locator('[data-run-history-id]').evaluateAll(rows=>rows.map(row=>row.getAttribute('data-run-history-id')));
 expect(first.length).toBe(25);
 phase('history acceptance source step 5');
 const currentPage=await (await page.request.get('/backend/run-history')).json();
 const chosen=currentPage.entries[0];
 phase('history acceptance source step 6');
 await region.getByLabel('평가 이력 시나리오',{exact:true}).selectOption(chosen.scenario);
 const scenarioMatches=currentPage.entries.filter((row:{scenario:string})=>row.scenario===chosen.scenario);
 phase('history acceptance source step 7');
 expect(await region.locator('[data-run-history-id]').evaluateAll(rows=>rows.map(row=>row.getAttribute('data-run-history-id')))).toEqual(scenarioMatches.map((row:{id:string})=>row.id));
 phase('history acceptance source step 8');
 await expect(region.getByRole('button',{name:'평가 이력 필터 해제',exact:true})).toBeEnabled();
 phase('history acceptance source step 9');
 await region.getByRole('button',{name:'평가 이력 필터 해제',exact:true}).click();
 phase('history acceptance source step 10');
 await expect(region.getByLabel('평가 이력 시나리오',{exact:true})).toHaveValue('all');
 phase('history acceptance source step 11');
 await expect(region.locator('[data-run-history-id]')).toHaveCount(25);
 phase('history acceptance source step 12');
 await region.getByLabel('평가 이력 시나리오',{exact:true}).selectOption(chosen.scenario);
 phase('history acceptance source step 13');
 await region.getByLabel('평가 이력 승인 필요 설정',{exact:true}).selectOption(chosen.requiresApproval?'required':'not-required');
 phase('history acceptance source step 14');
 await region.getByLabel('평가 이력 실행 상태',{exact:true}).selectOption(chosen.state);
 phase('history acceptance source step 15');
 await region.getByLabel('평가 이력 판정',{exact:true}).selectOption(chosen.decision);
 phase('history acceptance source step 16');
 await region.getByLabel('평가 이력 공급자',{exact:true}).selectOption(chosen.provider);
 const matching=currentPage.entries.filter((row:{scenario:string;state:string;decision:string;provider:string;requiresApproval:boolean})=>row.scenario===chosen.scenario&&row.requiresApproval===chosen.requiresApproval&&row.state===chosen.state&&row.decision===chosen.decision&&row.provider===chosen.provider);
 phase('history acceptance source step 17');
 await expect(region.locator('[data-run-history-id]')).toHaveCount(matching.length);
 phase('history acceptance source step 18');
 expect(await region.locator('[data-run-history-id]').evaluateAll(rows=>rows.map(row=>row.getAttribute('data-run-history-id')))).toEqual(matching.map((row:{id:string})=>row.id));
 phase('history acceptance source step 19');
 await region.getByRole('button',{name:'평가 이력 필터 해제',exact:true}).click();
 phase('history acceptance source step 20');
 await expect(region.locator('[data-run-history-id]')).toHaveCount(25);
 phase('history acceptance source step 21');
 await region.getByRole('button',{name:'다음 평가 페이지',exact:true}).click();
 phase('history acceptance source step 22');
 await expect(region.getByText(/이력 페이지 2/)).toBeVisible();
 phase('history acceptance source step 23');
 const older=await region.locator('[data-run-history-id]').evaluateAll(rows=>rows.map(row=>row.getAttribute('data-run-history-id')));
 expect(older.length).toBeGreaterThan(0);expect(older.some(id=>first.includes(id))).toBe(false);
 phase('history acceptance source step 24');
 await region.getByRole('button',{name:'평가 근거 '+older[0]!.slice(0,8),exact:true}).click();
 phase('history acceptance source step 25');
 await expect(page.locator('.evidence').getByText('실행 '+older[0],{exact:true})).toBeVisible();
 phase('history acceptance source step 26');
 await region.getByRole('button',{name:'이전 평가 페이지',exact:true}).click();
 phase('history acceptance source step 27');
 await expect(region.getByText(/이력 페이지 1/)).toBeVisible();
 phase('history acceptance source step 28');
 expect(await region.locator('[data-run-history-id]').evaluateAll(rows=>rows.map(row=>row.getAttribute('data-run-history-id')))).toEqual(first);
  phase('history acceptance source step 29');
  const snapshot=await (await page.request.get('/backend/run-history')).json();
  phase('history acceptance source step 30');
  await page.route('**/backend/run-history',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...snapshot,projectId:'ffffffff-ffff-4fff-8fff-ffffffffffff'})}));
  phase('history acceptance source step 31');
  await region.getByRole('button',{name:'최신 평가 이력 조회',exact:true}).click();
  phase('history acceptance source step 32');
  await expect(region.getByText('평가 이력을 확인하지 못했습니다. 다시 조회해 주세요.',{exact:true})).toBeVisible();
  phase('history acceptance source step 33');
  await expect(region.locator('[data-run-history-id]')).toHaveCount(0);
 phase('actual read-only browser history returns distinct pages and opens the selected existing evaluation');
});

test('viewer reads immutable baseline conditions and verifies actual v2 current signature',async({page})=>{
 await login(page,'demo-viewer');
 const root=resolve(process.cwd(),'../../.local');
 const sources=readdirSync(root).filter(name=>/^stack-baseline-gate-[a-f0-9-]{36}\.json$/.test(name)).map(name=>({path:resolve(root,name),time:statSync(resolve(root,name)).mtimeMs})).sort((a,b)=>b.time-a.time);
 const reference=sources.map(item=>JSON.parse(readFileSync(item.path,'utf8'))).find(value=>value.completed&&value.candidateCampaignId&&value.baselineCampaignId);expect(reference).toBeTruthy();
 const id=reference.candidateCampaignId as string,baseline=reference.baselineCampaignId as string;
 const region=page.getByRole('region',{name:'버전과 평가 캠페인',exact:true});
 await region.getByRole('button',{name:'캠페인 '+id.slice(0,8),exact:true}).click();
 const conditions=page.getByRole('region',{name:'고정된 릴리스 조건',exact:true});
 await conditions.getByRole('button',{name:'비교 기준·근거 유효 기간 확인',exact:true}).click();
 await expect(conditions.getByText('고정 기준 캠페인 '+baseline,{exact:true})).toBeVisible();
 await expect(conditions.getByRole('region',{name:'검증된 캠페인 회귀 비교 결과',exact:true}).getByText(id,{exact:true})).toBeVisible();
 await expect(conditions.getByRole('region',{name:'검증된 캠페인 회귀 비교 결과',exact:true}).getByText(baseline,{exact:true})).toBeVisible();
 await expect(conditions.getByText(/양쪽 근거 유효 기간 60초/)).toBeVisible();
 const checks=page.getByRole('region',{name:'서명된 현재 판정 확인',exact:true});
 await checks.getByRole('button',{name:'현재 판정 서명 확인',exact:true}).click();
 await expect(checks.getByText('서명 확인 완료 · 릴리스 허용 안 됨',{exact:true})).toBeVisible();
 await expect(checks.getByText('서명에 묶인 비교 기준 '+baseline+' · 유효 기간 60초',{exact:true})).toBeVisible();
 const snapshot=await (await page.request.get('/backend/campaigns/'+id+'/release-requirements')).json();
 await page.route('**/backend/campaigns/'+id+'/release-requirements',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...snapshot,projectId:'ffffffff-ffff-4fff-8fff-ffffffffffff'})}));
 await conditions.getByRole('button',{name:'비교 기준·근거 유효 기간 확인',exact:true}).click();
 await expect(conditions.getByRole('status')).toHaveText('고정된 릴리스 조건을 확인하지 못했습니다. 다시 확인해 주세요.');
 await expect(conditions.getByText('고정 기준 캠페인 '+baseline,{exact:true})).toHaveCount(0);
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 phase('actual immutable baseline and natural expiry are visible; Java v2 signature verified and foreign condition response cleared');
});

test('administrator creates an immutable baseline campaign and approves the actual signed gate',async({page})=>{
 await login(page,'demo-admin');
 const root=resolve(process.cwd(),'../../.local'),files=readdirSync(root).filter(name=>/^stack-baseline-gate-[a-f0-9-]{36}\.json$/.test(name)).sort((a,b)=>statSync(resolve(root,b)).mtimeMs-statSync(resolve(root,a)).mtimeMs);
 const reference=files.map(name=>JSON.parse(readFileSync(resolve(root,name),'utf8'))).find(value=>value.completed&&value.baselineCampaignId);expect(reference).toBeTruthy();
 const baseline=await (await page.request.get('/backend/campaigns/'+reference.baselineCampaignId)).json();expect(baseline.agentVersion.definition.provider).toBe('synthetic');
 const csrf=(await (await page.request.get('/backend/csrf')).json()).token;const fresh=await page.request.post('/backend/campaigns',{headers:{'X-CSRF-TOKEN':csrf,Origin:'http://127.0.0.1:4320','Idempotency-Key':randomUUID()},data:{agentVersionId:baseline.agent_version_id,datasetVersionId:baseline.dataset_version_id,requiresApproval:true}});expect(fresh.status()).toBe(200);reference.baselineCampaignId=(await fresh.json()).id;
 await expect.poll(async()=>(await (await page.request.get('/backend/campaigns/'+reference.baselineCampaignId)).json()).state,{timeout:35000}).toBe('succeeded');await page.reload();await expect(page.getByRole('button',{name:'로그아웃',exact:true})).toBeVisible();
 const region=page.getByRole('region',{name:'버전과 평가 캠페인',exact:true});
 await region.getByLabel('캠페인 에이전트 버전',{exact:true}).selectOption(baseline.agent_version_id);
 await region.getByLabel('캠페인 데이터셋 버전',{exact:true}).selectOption(baseline.dataset_version_id);
 await region.getByLabel('릴리스에 고정할 비교 기준',{exact:true}).selectOption(reference.baselineCampaignId);
 await region.getByLabel('양쪽 근거 유효 기간',{exact:true}).fill('3600');
 const admitted=page.waitForResponse(response=>response.url().endsWith('/backend/campaigns')&&response.request().method()==='POST');
 phase('baseline candidate admission click requested');
 await region.getByRole('button',{name:'캠페인 실행',exact:true}).click();
 phase('baseline candidate admission click completed');
 const admission=await admitted;
 phase('baseline candidate admission response HTTP '+admission.status());
 expect(admission.status()).toBe(200);
 // Require the actual UI to select the admitted record, then independently
 // read its ID; do not depend on Chromium's transient protocol body store.
 // An uncertain UI write still fails. No POST retry or body-read fallback.
 phase('baseline candidate selection visibility requested');
 const selectedCampaign=region.getByText(/^캠페인 [a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
 await expect(selectedCampaign).toBeVisible();
 const candidateId=(await selectedCampaign.innerText()).slice('캠페인 '.length);
 const candidateRead=await page.request.get('/backend/campaigns/'+candidateId);expect(candidateRead.status()).toBe(200);
 const candidate=await candidateRead.json();expect(candidate.id).toBe(candidateId);expect(candidate.agent_version_id).toBe(baseline.agent_version_id);expect(candidate.dataset_version_id).toBe(baseline.dataset_version_id);
 expect(candidate.id).not.toBe(reference.baselineCampaignId);
 phase('baseline candidate selection visible and independently read');
 await expect(region.getByRole('button',{name:'캠페인 검토 저장',exact:true})).toBeVisible();
 phase('baseline candidate review form visible');
 await region.getByLabel('캠페인 검토 사유',{exact:true}).fill('Own browser synthetic baseline approval');
 phase('baseline candidate review reason filled');
 await region.getByRole('button',{name:'캠페인 검토 저장',exact:true}).click();
 phase('baseline candidate review click completed');
 await expect(region.getByText('캠페인 릴리스 허용',{exact:true})).toBeVisible();
 phase('baseline candidate reviewed release allowance visible');
 const conditions=page.getByRole('region',{name:'고정된 릴리스 조건',exact:true});
 await conditions.getByRole('button',{name:'비교 기준·근거 유효 기간 확인',exact:true}).click();
 await expect(conditions.getByText('고정 기준 캠페인 '+reference.baselineCampaignId,{exact:true})).toBeVisible();
 await expect(conditions.getByText(/양쪽 근거 유효 기간 3600초/)).toBeVisible();
 await expect.poll(async()=>{const value=await page.request.get('/backend/campaigns/'+candidate.id+'/evidence');return value.status()},{timeout:15000}).toBe(200);
 const checks=page.getByRole('region',{name:'서명된 현재 판정 확인',exact:true});
 await checks.getByRole('button',{name:'현재 판정 서명 확인',exact:true}).click();
 await expect(checks.getByText('서명 확인 완료 · 합성 릴리스 허용',{exact:true})).toBeVisible();
 await expect(checks.getByText('서명에 묶인 비교 기준 '+reference.baselineCampaignId+' · 유효 기간 3600초',{exact:true})).toBeVisible();
 await region.getByLabel('서명 기록 메모',{exact:true}).fill('Own complete baseline archive observation');await region.getByRole('button',{name:'현재 판정의 서명 기록 저장',exact:true}).click();await expect(region.getByText('브라우저 Ed25519 서명 검증 완료 · 개발용 공개키',{exact:true})).toBeVisible();
 const event=page.waitForEvent('download');await region.getByRole('button',{name:'검증된 서명·근거 번들 다운로드',exact:true}).click();const download=await event;expect(await download.failure()).toBeNull();const stream=await download.createReadStream();let bytes=Buffer.alloc(0);for await(const chunk of stream!){bytes=Buffer.concat([bytes,chunk]);expect(bytes.length).toBeLessThanOrEqual(524288)}const bundle=JSON.parse(bytes.toString('utf8'));expect(bundle.schemaVersion).toBe(2);expect(bundle.baseline.campaign.id).toBe(reference.baselineCampaignId);
 const signedPayload=JSON.parse(Buffer.from(bundle.receipt.payloadBase64,'base64').toString('utf8'));expect(signedPayload.schemaVersion).toBe(4);
 expect(signedPayload.versionLifecycle.contract).toBe('campaign-version-lifecycle-v1');expect(signedPayload.versionLifecycle.campaignId).toBe(candidate.id);
 expect(signedPayload.versionLifecycle.versions.map((version:{kind:string,state:string})=>[version.kind,version.state])).toEqual([['agents','active'],['datasets','active'],['agents','active'],['datasets','active']]);
 await expect(region.getByRole('status',{name:'버전과 캠페인 작업 상태',exact:true})).toContainText('기준 캠페인의 부모와 1개 자식 보관본도 검증했습니다.');phase('actual Java v4 historical signature binds lifecycle and both complete archive chains; browser downloads the verified comparison baseline');
 let unexpected=false;const note=()=>{unexpected=true};page.on('download',note);try{const changed=structuredClone(bundle);changed.baseline.children[0].archive.contentBase64=Buffer.from('changed comparison bytes').toString('base64');const receiptId=bundle.receipt.receiptId;await page.route('**/backend/campaigns/'+candidate.id+'/receipts/'+receiptId+'/bundle',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(changed)}));await region.getByRole('button',{name:'검증된 서명·근거 번들 다운로드',exact:true}).click();await expect(region.getByRole('status',{name:'버전과 캠페인 작업 상태',exact:true})).toContainText('서명과 모든 보관 바이트의 연결을 검증하지 못해 번들을 내보내지 않았습니다.');expect(unexpected).toBe(false)}finally{page.off('download',note)}phase('altered baseline child is refused before a second browser download');
 phase('actual UI admission freezes baseline and age; Python completion and administrator review lead to verified Java v2 current signature');
});

test('viewer reads real provider reservations and clears an invented billed usage response',async({page})=>{
 await login(page,'demo-viewer');
 const region=page.getByRole('region',{name:'프로젝트 모델 실행 한도',exact:true});
 const snapshot=await (await page.request.get('/backend/provider-usage')).json();
 await region.getByRole('button',{name:'현재 실행 한도 조회',exact:true}).click();
 await expect(region.getByText(/UTC 기준일/)).toBeVisible();
 await expect(region.getByText(new RegExp('남은 예약 '+snapshot.remainingAttempts+'회'))).toBeVisible();
 await expect(region.getByRole('table',{name:'공급자별 예약과 평가 상태'})).toBeVisible();
 await page.route('**/backend/provider-usage',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...snapshot,billableUsageMeasured:true})}));
 await region.getByRole('button',{name:'현재 실행 한도 조회',exact:true}).click();
 await expect(region.getByText('실행 한도를 확인하지 못했습니다. 다시 조회해 주세요.',{exact:true})).toBeVisible();
 await expect(region.getByRole('table')).toHaveCount(0);
 phase('browser displays actual scoped reservations and refuses invented paid usage');
});

test('viewer verifies a fresh signed gate and clears replayed unavailable and expired checks',async({page})=>{
 await login(page,'demo-viewer');
 await page.clock.install({time:new Date()});
 const region=page.getByRole('region',{name:'버전과 평가 캠페인',exact:true});
 const records=await (await page.request.get('/backend/campaigns')).json() as {id:string}[];
 let selected:string|null=null;
 for(const row of records){const record=await (await page.request.get('/backend/campaigns/'+row.id)).json();if(record.state==='succeeded'&&(await page.request.get('/backend/campaigns/'+row.id+'/evidence')).ok()){selected=row.id;break}}
 expect(selected).not.toBeNull();
 await region.getByRole('button',{name:'캠페인 '+selected!.slice(0,8),exact:true}).click();
 const checks=page.getByRole('region',{name:'서명된 현재 판정 확인',exact:true});
 const received=page.waitForResponse(response=>response.url().includes('/gate-check/')&&response.status()===200);
 await checks.getByRole('button',{name:'현재 판정 서명 확인',exact:true}).click();
 const frame=await (await received).json();
 await expect(checks.getByText(/서명 확인 완료/)).toBeVisible();phase('viewer independently verifies actual Java current-check signature in browser');
 await page.route('**/backend/campaigns/'+selected+'/gate-check/*',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(frame)}));
 await checks.getByRole('button',{name:'현재 판정 서명 확인',exact:true}).click();
 await expect(checks.getByRole('status')).toContainText('서명·범위·유효 시간을 확인하지 못했습니다.');await expect(checks.getByText(/서명 확인 완료/)).toHaveCount(0);phase('replayed signed response for a different challenge is refused');
 await page.unroute('**/backend/campaigns/'+selected+'/gate-check/*');
 await checks.getByRole('button',{name:'현재 판정 서명 확인',exact:true}).click();await expect(checks.getByText(/서명 확인 완료/)).toBeVisible();
 await page.route('**/backend/campaigns/'+selected+'/gate-check/*',route=>route.fulfill({status:503,contentType:'application/json',body:'{"code":"TEST_CHECK_UNAVAILABLE"}'}));
 await checks.getByRole('button',{name:'현재 판정 서명 확인',exact:true}).click();await expect(checks.getByText(/서명 확인 완료/)).toHaveCount(0);await expect(checks.getByRole('status')).toContainText('서명·범위·유효 시간을 확인하지 못했습니다.');phase('request failure clears earlier signed status');
 await page.unroute('**/backend/campaigns/'+selected+'/gate-check/*');
 await checks.getByRole('button',{name:'현재 판정 서명 확인',exact:true}).click();await expect(checks.getByText(/서명 확인 완료/)).toBeVisible();
 await page.clock.setSystemTime(new Date(Date.now()-60000));await page.clock.runFor(31000);
 await expect(checks.getByText(/서명 확인 완료/)).toHaveCount(0);await expect(checks.getByRole('status')).toContainText('확인 시간이 만료됐습니다.');phase('signed result expires even when browser wall clock moves backward; no evaluation or approval is created');
});

test('a delayed signed check cannot populate another selected campaign',async({page})=>{
 await login(page,'demo-viewer');const region=page.getByRole('region',{name:'버전과 평가 캠페인',exact:true});
 const records=await (await page.request.get('/backend/campaigns')).json() as {id:string}[];
 const candidates:string[]=[];
 for(const row of records){const record=await (await page.request.get('/backend/campaigns/'+row.id)).json();if(record.state==='succeeded'&&(await page.request.get('/backend/campaigns/'+row.id+'/evidence')).ok())candidates.push(row.id);if(candidates.length===2)break}
 expect(candidates.length).toBe(2);const [first,second]=candidates;
 await region.getByRole('button',{name:'캠페인 '+first.slice(0,8),exact:true}).click();
 let release!:()=>void,received!:()=>void;const held=new Promise<void>(resolve=>{release=resolve}),ready=new Promise<void>(resolve=>{received=resolve});
 await page.route('**/backend/campaigns/'+first+'/gate-check/*',async route=>{const response=await route.fetch();received();await held;try{await route.fulfill({response})}catch{/* The old component aborted its request. */}});
 const checks=page.getByRole('region',{name:'서명된 현재 판정 확인',exact:true});
 await checks.getByRole('button',{name:'현재 판정 서명 확인',exact:true}).click();await ready;
 await region.getByRole('button',{name:'캠페인 '+second.slice(0,8),exact:true}).click();
 release();await expect(region.getByText('캠페인 '+second,{exact:true})).toBeVisible();await expect(checks.getByText(/서명 확인 완료/)).toHaveCount(0);
 await checks.getByRole('button',{name:'현재 판정 서명 확인',exact:true}).click();await expect(checks.getByText(/서명 확인 완료/)).toBeVisible();phase('old selection response is aborted; only newly selected campaign can display its independently verified check');
});

test('viewer navigates scoped audit history without duplicate rows and clears unavailable pages',async({page})=>{
 await login(page,'demo-viewer');const region=page.getByRole('region',{name:'프로젝트 감사 기록',exact:true});await region.getByRole('button',{name:'최신 감사 기록 조회',exact:true}).click();await expect(region.getByText('페이지 1 · 25개 기록',{exact:true})).toBeVisible();
 const first=await region.locator('tbody tr').evaluateAll(rows=>rows.map(row=>row.getAttribute('data-audit-id')));expect(new Set(first).size).toBe(25);await region.getByRole('button',{name:'다음 감사 페이지',exact:true}).click();await expect(region.getByText(/페이지 2 · \d+개 기록/)).toBeVisible();const second=await region.locator('tbody tr').evaluateAll(rows=>rows.map(row=>row.getAttribute('data-audit-id')));expect(second.some(id=>first.includes(id))).toBe(false);phase('actual scoped PostgreSQL audit history navigates without duplicated records');
 await region.getByRole('button',{name:'이전 감사 페이지',exact:true}).click();await expect(region.getByText('페이지 1 · 25개 기록',{exact:true})).toBeVisible();expect(await region.locator('tbody tr').evaluateAll(rows=>rows.map(row=>row.getAttribute('data-audit-id')))).toEqual(first);
 await page.route('**/backend/audit',route=>route.fulfill({status:503,contentType:'application/json',body:'{"code":"TEST_AUDIT_UNAVAILABLE"}'}));await region.getByRole('button',{name:'최신 감사 기록 조회',exact:true}).click();await expect(region.getByText('감사 기록을 확인하지 못했습니다. 다시 조회해 주세요.',{exact:true})).toBeVisible();await expect(region.locator('tbody tr')).toHaveCount(0);phase('read failure clears previous audit contents instead of displaying stale history');
 await page.unroute('**/backend/audit');await region.getByRole('button',{name:'최신 감사 기록 조회',exact:true}).click();await expect(region.getByText('페이지 1 · 25개 기록',{exact:true})).toBeVisible();await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);phase('audit rows recover after unavailable reads and fit mobile width');
});

test('administrator creates evaluation, approves, rejects and cannot override required failure',async({page})=>{
 await login(page,'demo-admin');phase('authenticated');await page.getByRole('button',{name:'평가 실행',exact:true}).click();phase('evaluation submitted');
 await expect(page.getByRole('heading',{name:'관리자 검토',exact:true})).toBeVisible({timeout:20000});phase('worker completed');await expect(page.getByText('릴리스 허용 안 됨',{exact:true})).toBeVisible();
 await page.getByLabel('검토 사유',{exact:true}).fill('Synthetic browser approval');await page.getByRole('button',{name:'검토 저장·게이트 확인',exact:true}).click();await expect(page.getByText('합성 릴리스 허용',{exact:true})).toBeVisible();phase('approval allows');
 const runId=(await page.locator('.evidence > p.mono').textContent())!.match(/[a-f0-9-]{36}/)![0],csrf=(await (await page.request.get('/backend/csrf')).json()).token;
 const rejected=await page.request.post('/backend/runs/'+runId+'/reviews',{headers:{'X-CSRF-TOKEN':csrf,Origin:'http://127.0.0.1:4320'},data:{decision:'rejected',reason:'Synthetic independently submitted rejection'}});expect(rejected.status()).toBe(200);
 await expect(page.getByText('합성 릴리스 허용',{exact:true})).toBeVisible();
 await page.locator('.evidence .gate').getByRole('button',{name:'현재 게이트 다시 확인',exact:true}).click();await expect(page.getByText('릴리스 허용 안 됨',{exact:true})).toBeVisible();phase('manual refresh replaces stale allowed snapshot with actual latest rejection');
 await page.getByLabel('검토 사유',{exact:true}).fill('Fresh synthetic approval after external rejection');await page.getByRole('button',{name:'검토 저장·게이트 확인',exact:true}).click();await expect(page.getByText('합성 릴리스 허용',{exact:true})).toBeVisible();

 await page.getByLabel('결정',{exact:true}).selectOption('rejected');await page.getByRole('button',{name:'검토 저장·게이트 확인',exact:true}).click();await expect(page.getByText('릴리스 허용 안 됨',{exact:true})).toBeVisible();phase('rejection denies');
 await page.getByLabel('합성 시나리오',{exact:true}).selectOption('block');await page.getByRole('button',{name:'평가 실행',exact:true}).click();await expect(page.locator('.evidence .decision-summary .badge.block')).toHaveText('차단',{timeout:20000});await expect(page.locator('.evidence-rules').getByText('실패',{exact:true}).first()).toBeVisible();await expect(page.getByRole('heading',{name:'관리자 검토',exact:true})).toHaveCount(0);await expect(page.getByText('릴리스 허용 안 됨',{exact:true})).toBeVisible();
});

test('viewer can read own evidence and cannot create evaluations',async({page})=>{
 await login(page,'demo-viewer');await expect(page.getByRole('button',{name:'평가 실행',exact:true})).toBeDisabled();await page.locator('.runs li button').first().click();await expect(page.getByRole('heading',{name:'평가 근거',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'관리자 검토',exact:true})).toHaveCount(0);
});

test('administrator fixes versions, runs a campaign and reviews the aggregate gate',async({page})=>{
 await login(page,'demo-admin');const region=page.getByRole('region',{name:'버전과 평가 캠페인',exact:true}),suffix=Date.now().toString(36);
 await region.getByLabel('에이전트 이름',{exact:true}).fill('browser-agent-'+suffix);await region.getByRole('button',{name:'에이전트 버전 고정',exact:true}).click();phase('agent registration submitted');await expect(region.getByRole('status',{name:'버전과 캠페인 작업 상태',exact:true})).toContainText('고정 버전 확인: browser-agent-'+suffix);
 phase('agent version confirmed');await region.getByLabel('데이터셋 이름',{exact:true}).fill('browser-data-'+suffix);await region.getByRole('button',{name:'사례 추가',exact:true}).click();phase('second case added');await region.getByLabel('사례 시나리오 2',{exact:true}).selectOption('block');await region.getByLabel('사례 2 필수',{exact:true}).uncheck();await region.getByRole('button',{name:'데이터셋 버전 고정',exact:true}).click();phase('dataset registration submitted');await expect(region.getByRole('status',{name:'버전과 캠페인 작업 상태',exact:true})).toContainText('고정 버전 확인: browser-data-'+suffix);
 const agents=await (await page.request.get('/backend/versions/agents')).json() as {id:string;resource_key:string}[],datasets=await (await page.request.get('/backend/versions/datasets')).json() as {id:string;resource_key:string}[];
 await region.getByLabel('캠페인 에이전트 버전',{exact:true}).selectOption(agents.find(v=>v.resource_key==='browser-agent-'+suffix)!.id);await region.getByLabel('캠페인 데이터셋 버전',{exact:true}).selectOption(datasets.find(v=>v.resource_key==='browser-data-'+suffix)!.id);
 await region.getByRole('button',{name:'캠페인 실행',exact:true}).click();await expect(region.getByRole('heading',{name:'캠페인 관리자 검토',exact:true})).toBeVisible({timeout:20000});await expect(region.getByText('캠페인 릴리스 허용 안 됨',{exact:true})).toBeVisible();const first=(await region.locator('.mono').first().textContent())!.replace('캠페인 ','');await expect(region.getByText(/실행 프로필 SHA-256 [a-f0-9]{64}/)).toBeVisible();phase('actual installed evaluator profile bound to agent version');phase('version bound case evidence completed');let archiveHash='';await expect.poll(async()=>{const response=await page.request.get('/backend/campaigns/'+first+'/evidence');if(response.status()===200){archiveHash=(await response.json()).contentSha256;return true}expect(response.status()).toBe(409);return false},{timeout:30000}).toBe(true);await region.getByRole('button',{name:'캠페인 보관 근거 확인',exact:true}).click();await expect(region.getByText('캠페인과 2개 사례의 브라우저 바이트 해시 검증 완료',{exact:true})).toBeVisible();phase('browser verifies frozen parent and both child archive bytes');
 await region.getByLabel('캠페인 검토 사유',{exact:true}).fill('Version-bound browser approval');await region.getByRole('button',{name:'캠페인 검토 저장',exact:true}).click();await expect(region.getByText('캠페인 릴리스 허용',{exact:true})).toBeVisible();await region.getByLabel('서명 기록 메모',{exact:true}).fill('Historical browser approval');await region.getByRole('button',{name:'현재 판정의 서명 기록 저장',exact:true}).click();await expect(region.getByText('브라우저 Ed25519 서명 검증 완료 · 개발용 공개키',{exact:true})).toBeVisible();const historical=(await (await page.request.get('/backend/campaigns/'+first+'/receipts')).json())[0].id;phase('browser verifies actual Ed25519 historical approval');await region.getByLabel('캠페인 검토 결정',{exact:true}).selectOption('rejected');await region.getByRole('button',{name:'캠페인 검토 저장',exact:true}).click();await expect(region.getByText('캠페인 릴리스 허용 안 됨',{exact:true})).toBeVisible();phase('parent approval and latest rejection verified');await region.getByRole('button',{name:'서명 기록 '+historical.slice(0,8)+' 검증',exact:true}).click();await expect(region.getByText('브라우저 Ed25519 서명 검증 완료 · 개발용 공개키',{exact:true})).toBeVisible();await expect(region.getByText('캠페인 릴리스 허용 안 됨',{exact:true})).toBeVisible();await expect(region.getByText(/당시 판정 통과 · 당시 허용 예/)).toBeVisible();phase('old passing signature does not override current rejection');const downloadEvent=page.waitForEvent('download');await region.getByRole('button',{name:'검증된 서명·근거 번들 다운로드',exact:true}).click();const download=await downloadEvent;expect(await download.failure()).toBeNull();const stream=await download.createReadStream();expect(stream).not.toBeNull();let bytes=Buffer.alloc(0);for await(const chunk of stream!){bytes=Buffer.concat([bytes,chunk]);expect(bytes.length).toBeLessThanOrEqual(524288)}const bundle=JSON.parse(bytes.toString('utf8'));expect(bundle.kind).toBe('campaign-observation-bundle');expect(bundle.currentDeploymentAuthority).toBe(false);expect(bundle.receipt.receiptId).toBe(historical);expect(bundle.children.length).toBe(2);await expect(region.getByText('캠페인 릴리스 허용 안 됨',{exact:true})).toBeVisible();phase('browser exports verified signed parent and all child bytes while current rejection remains denied');let unexpectedDownload=false;const noteDownload=()=>{unexpectedDownload=true};page.on('download',noteDownload);try{const altered=structuredClone(bundle);altered.children[0].archive.contentBase64=Buffer.from('altered archive bytes').toString('base64');await page.route('**/backend/campaigns/'+first+'/receipts/'+historical+'/bundle',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(altered)}));await region.getByRole('button',{name:'검증된 서명·근거 번들 다운로드',exact:true}).click();await expect(region.getByRole('status',{name:'버전과 캠페인 작업 상태',exact:true})).toContainText('서명과 모든 보관 바이트의 연결을 검증하지 못해 번들을 내보내지 않았습니다.');expect(unexpectedDownload).toBe(false);phase('browser refuses altered child archive before creating a download')}finally{page.off('download',noteDownload)}expect((await (await page.request.get('/backend/campaigns/'+first+'/evidence')).json()).contentSha256).toBe(archiveHash);
 await region.getByRole('button',{name:'캠페인 실행',exact:true}).click();await expect(region.getByRole('heading',{name:'캠페인 관리자 검토',exact:true})).toBeVisible({timeout:20000});await region.getByLabel('비교 기준 캠페인',{exact:true}).selectOption(first);await region.getByRole('button',{name:'캠페인 회귀 비교',exact:true}).click();await expect(region.getByRole('region',{name:'검증된 캠페인 회귀 비교 결과',exact:true}).getByRole('heading',{name:'비교 결과 새 회귀 없음',exact:true})).toBeVisible();phase('same dataset comparison remains advisory');await expect(region.getByText('브라우저 Ed25519 서명 검증 완료 · 개발용 공개키',{exact:true})).toHaveCount(0);phase('new selection clears historical proof');
});

test('campaign response with substituted immutable content cannot display evidence or permission',async({page})=>{
 await login(page,'demo-admin');const region=page.getByRole('region',{name:'버전과 평가 캠페인',exact:true}),rows=await (await page.request.get('/backend/campaigns')).json() as {id:string}[];expect(rows.length).toBeGreaterThan(0);const id=rows[0].id,evidence=await (await page.request.get('/backend/campaigns/'+id)).json();
 await page.route('**/backend/campaigns/'+id,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...evidence,agentVersion:{...evidence.agentVersion,definition:{...evidence.agentVersion.definition,description:'substituted content'}}})}));await region.getByRole('button',{name:'캠페인 '+id.slice(0,8),exact:true}).click();await expect(region.getByRole('status',{name:'버전과 캠페인 작업 상태',exact:true})).toContainText('버전과 평가 근거의 연결을 확인하지 못했습니다.');await expect(region.getByRole('heading',{name:'캠페인 평가 근거',exact:true})).toHaveCount(0);await expect(region.getByText('캠페인 릴리스 허용',{exact:true})).toHaveCount(0);phase('actual canonical version hash rejects substituted campaign content');
});

test('a delayed earlier selection cannot replace the newer selected evidence',async({page})=>{
 await login(page,'demo-admin');const rows=await (await page.request.get('/backend/runs')).json() as {id:string}[];expect(rows.length).toBeGreaterThanOrEqual(2);const first=rows[0].id,second=rows[1].id;const evidence=await (await page.request.get('/backend/runs/'+first)).json();let release:()=>void=()=>{};let arrived:()=>void=()=>{};const intercepted=new Promise<void>(resolve=>{arrived=resolve});const held=new Promise<void>(resolve=>{release=resolve});
 await page.route('**/backend/runs/'+first,async route=>{arrived();await held;await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(evidence)})});
 try{await page.locator('.runs button').filter({hasText:first.slice(0,8)}).click();await intercepted;await page.locator('.runs button').filter({hasText:second.slice(0,8)}).click();await expect(page.locator('.evidence > .mono')).toHaveText('실행 '+second);const response=page.waitForResponse(r=>r.url().endsWith('/backend/runs/'+first));release();await response;await expect(page.locator('.evidence > .mono')).toHaveText('실행 '+second)}finally{release()}
});


test('browser verifies exact archived bytes and clears proof when selecting another run',async({page})=>{
 await login(page,'demo-admin');expect((await (await page.request.get('/backend/auth-info')).json()).objectStorage).toBe('minio');
 await page.getByRole('button',{name:'평가 실행',exact:true}).click();await expect(page.getByRole('heading',{name:'관리자 검토',exact:true})).toBeVisible({timeout:20000});
 const selected=await page.locator('.evidence > .mono').textContent();const id=selected!.replace('실행 ','');let proof:{contentSha256:string;storageVersion:string}|undefined;
 await expect.poll(async()=>{const response=await page.request.get('/backend/runs/'+id+'/evidence');if(response.status()===200){proof=await response.json();return true}expect(response.status()).toBe(409);return false},{timeout:30000}).toBe(true);
 await page.getByRole('button',{name:'근거 해시·버전 확인',exact:true}).click();await expect(page.getByText('SHA-256 '+proof!.contentSha256,{exact:true})).toBeVisible();await expect(page.getByText('저장 버전 '+proof!.storageVersion,{exact:true})).toBeVisible();phase('browser verifies stored byte hash and version');
 const rows=await (await page.request.get('/backend/runs')).json() as {id:string}[];const other=rows.find(row=>row.id!==id)!;await page.locator('.runs button').filter({hasText:other.id.slice(0,8)}).click();await expect(page.locator('.evidence > .mono')).toHaveText('실행 '+other.id);await expect(page.getByText('SHA-256 '+proof!.contentSha256,{exact:true})).toHaveCount(0);phase('selection change clears archived proof');
});


test('viewer follows a scoped pgvector neighbor without retaining old evidence',async({page})=>{
 await login(page,'demo-viewer');const rows=await (await page.request.get('/backend/runs')).json() as {id:string;state:string}[];const source=rows.find(row=>row.state==='succeeded')!;let target='';
 await expect.poll(async()=>{const response=await page.request.get('/backend/runs/'+source.id+'/similar');if(response.status()===200){const value=await response.json();target=value.matches[0].runId;return true}expect(response.status()).toBe(409);return false},{timeout:30000}).toBe(true);
 await page.locator('.runs button').filter({hasText:source.id.slice(0,8)}).click();await expect(page.locator('.evidence > .mono')).toHaveText('실행 '+source.id);await page.getByRole('button',{name:'유사 근거 찾기',exact:true}).click();await expect(page.locator('.similar li button').first()).toContainText(target.slice(0,8));await page.locator('.similar li button').first().click();await expect(page.locator('.evidence > .mono')).toHaveText('실행 '+target);await expect(page.locator('.similar li button')).toHaveCount(0);await expect(page.getByRole('heading',{name:'관리자 검토',exact:true})).toHaveCount(0);phase('viewer navigates real scoped vector neighbor and clears previous search');
});

if(process.env.STACK_E2E_LOCAL_MODEL==='true')test('reference dataset is registered and independently graded through actual browser controls',async({page})=>{
 test.setTimeout(150000);await login(page,'demo-admin');const suffix=crypto.randomUUID().replaceAll('-','').slice(0,12),agentKey='browser-ref-agent-'+suffix,datasetKey='browser-ref-data-'+suffix;
 await page.getByLabel('에이전트 이름',{exact:true}).fill(agentKey);await page.getByLabel('에이전트 평가 방식',{exact:true}).selectOption('reference-answer');await page.getByLabel('에이전트 공급자',{exact:true}).selectOption('ollama');
 await page.getByRole('button',{name:'에이전트 버전 고정',exact:true}).click();await expect(page.getByText('고정 버전 확인: '+agentKey+' / v1',{exact:false})).toBeVisible();phase('browser verified immutable reference agent and actual execution profile');
 await page.getByLabel('데이터셋 이름',{exact:true}).fill(datasetKey);await page.getByLabel('데이터셋 평가 방식',{exact:true}).selectOption('reference-answer');await page.getByLabel('평가 입력 1',{exact:true}).fill('Respond exactly with {"answer":"GREEN"}.');await page.getByLabel('기대 정답 1',{exact:true}).fill('GREEN');
 await page.getByRole('button',{name:'데이터셋 버전 고정',exact:true}).click();await expect(page.getByText('고정 버전 확인: '+datasetKey+' / v1',{exact:false})).toBeVisible();
 const agentId=await page.getByLabel('캠페인 에이전트 버전',{exact:true}).locator('option').filter({hasText:agentKey}).getAttribute('value'),datasetId=await page.getByLabel('캠페인 데이터셋 버전',{exact:true}).locator('option').filter({hasText:datasetKey}).getAttribute('value');
 await page.getByLabel('캠페인 에이전트 버전',{exact:true}).selectOption(agentId!);await page.getByLabel('캠페인 데이터셋 버전',{exact:true}).selectOption(datasetId!);await page.getByRole('button',{name:'캠페인 실행',exact:true}).click();
 await expect(page.getByRole('heading',{name:'캠페인 관리자 검토',exact:true})).toBeVisible({timeout:100000});await expect(page.getByText('캠페인 릴리스 허용 안 됨',{exact:true})).toBeVisible();
 const region=page.locator('section[aria-label="버전과 평가 캠페인"]'),text=await region.locator('p.mono').filter({hasText:/^캠페인 /}).textContent(),id=text!.match(/[a-f0-9-]{36}/)![0];
 const record=await (await page.request.get('/backend/campaigns/'+id)).json();expect(record.agentVersion.definition.contract).toBe('reference-answer-v1');expect(record.datasetVersion.definition.cases[0].expected).toBe('GREEN');
 const child=await (await page.request.get('/backend/runs/'+record.cases[0].runId)).json();expect(child.result.executionEngine).toBe('python-ollama');expect(child.result.rules.some((r:{id:string;status:string})=>r.id==='verifier-agreement'&&r.status==='pass')).toBe(true);phase('actual Python model and Promptfoo agree; browser shows no release authority before approval');
 await page.getByLabel('캠페인 검토 사유',{exact:true}).fill('Actual reference dataset browser review');await page.getByRole('button',{name:'캠페인 검토 저장',exact:true}).click();await expect(page.getByText('캠페인 릴리스 허용',{exact:true})).toBeVisible();
 await expect.poll(async()=>(await page.request.get('/backend/campaigns/'+id+'/evidence')).status(),{timeout:45000}).toBe(200);await page.getByRole('button',{name:'캠페인 보관 근거 확인',exact:true}).click();await expect(page.getByText('캠페인과 1개 사례의 브라우저 바이트 해시 검증 완료',{exact:true})).toBeVisible();
 await page.getByLabel('캠페인 검토 결정',{exact:true}).selectOption('rejected');await page.getByLabel('캠페인 검토 사유',{exact:true}).fill('Current rejection after immutable reference archive');await page.getByRole('button',{name:'캠페인 검토 저장',exact:true}).click();await expect(page.getByText('캠페인 릴리스 허용 안 됨',{exact:true})).toBeVisible();phase('reference archive hashes verified in browser; latest rejection denies release');
});

if(process.env.STACK_E2E_LOCAL_MODEL==='true')test('local model provider evidence survives browser approval and archive verification',async({page})=>{
 test.setTimeout(120000);await login(page,'demo-admin');await page.getByLabel('실행 공급자',{exact:true}).selectOption('ollama');await page.getByRole('button',{name:'평가 실행',exact:true}).click();
 await expect(page.getByRole('heading',{name:'관리자 검토',exact:true})).toBeVisible({timeout:90000});await expect(page.getByText('실행 공급자 ollama · 실행 엔진 python-ollama',{exact:true})).toBeVisible();
 await expect(page.getByText('릴리스 허용 안 됨',{exact:true})).toBeVisible();await page.getByLabel('검토 사유',{exact:true}).fill('Actual local model browser review');await page.getByRole('button',{name:'검토 저장·게이트 확인',exact:true}).click();await expect(page.getByText('합성 릴리스 허용',{exact:true})).toBeVisible();
 const selected=await page.locator('.evidence > .mono').textContent();const id=selected!.replace('실행 ','');let digest='';
 await expect.poll(async()=>{const response=await page.request.get('/backend/runs/'+id+'/evidence');if(response.status()===200){digest=(await response.json()).contentSha256;return true}expect(response.status()).toBe(409);return false},{timeout:30000}).toBe(true);
 await page.getByRole('button',{name:'근거 해시·버전 확인',exact:true}).click();await expect(page.getByText('SHA-256 '+digest,{exact:true})).toBeVisible();phase('real Ollama admission and engine match; browser verifies provider-bound archive');
 await page.getByLabel('결정',{exact:true}).selectOption('rejected');await page.getByRole('button',{name:'검토 저장·게이트 확인',exact:true}).click();await expect(page.getByText('릴리스 허용 안 됨',{exact:true})).toBeVisible();phase('model pass never overrides current rejection');
});


test('administrator cancels a real pending evaluation and campaign through browser controls',async({page})=>{
 await login(page,'demo-admin');
 const worker='agenttrust-stack-ai-worker-1';
 const legacyReturn=process.env.STACK_E2E_LEGACY_CORE_RETURN==='true',witness=process.env.STACK_E2E_WORKER_PAUSE_WITNESS;let paused=false;
 const hostedWorker=(action:'pause'|'resume')=>JSON.parse(execFileSync(process.platform==='win32'?'python':'python3',[resolve(process.cwd(),'../../scripts/stack-ci-browser-worker-pause.py'),'--execute','--action',action,'--witness',witness??''],{encoding:'utf8',timeout:75000,maxBuffer:16384}));
 if(!legacyReturn){const running=execFileSync('docker',['inspect',worker,'--format','{{.State.Running}}'],{encoding:'utf8',timeout:15000}).trim();expect(running).toBe('true')}
 try{
  if(legacyReturn){const frozen=hostedWorker('pause');expect(frozen.completed).toBe(true);expect(frozen.paused).toBe(true);expect(frozen.identityPreserved).toBe(true);paused=true;phase('owned hosted worker paused without replacing or restarting its process')}
  else execFileSync('docker',['stop','--time','10',worker],{timeout:25000});
  await page.getByRole('button',{name:'평가 실행',exact:true}).click();
  await expect(page.getByLabel('평가 취소 사유',{exact:true})).toBeVisible();
  await page.getByLabel('평가 취소 사유',{exact:true}).fill('Browser synthetic cancellation');
  await page.getByRole('button',{name:'평가 취소',exact:true}).click();
  await expect(page.getByText('평가 취소 결과를 확인했습니다.',{exact:true})).toBeVisible();
  await expect(page.locator('.evidence').getByText(/실행 엔진 java-cancelled/)).toBeVisible();
  await expect(page.locator('.evidence .similar').getByRole('button',{name:'유사 근거 찾기',exact:true})).toBeDisabled();
  await expect(page.getByText('취소된 평가는 유사 근거 검색 대상이 아닙니다.',{exact:true})).toBeVisible();
  await expect(page.locator('.evidence .gate').getByText('릴리스 허용 안 됨',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'평가 취소',exact:true})).toHaveCount(0);
  const csrf=(await (await page.request.get('/backend/csrf')).json()).token,headers={'X-CSRF-TOKEN':csrf,Origin:'http://127.0.0.1:4320'};
  const suffix=crypto.randomUUID().slice(0,8);
  const a=await page.request.post('/backend/versions/agents',{headers,data:{key:'browser-cancel-agent-'+suffix,version:1,provider:'synthetic',description:'Browser cancellation fixture'}});expect(a.status()).toBe(200);const agent=await a.json();
  const d=await page.request.post('/backend/versions/datasets',{headers,data:{key:'browser-cancel-data-'+suffix,version:1,cases:[{id:'required',scenario:'pass',required:true}]}});expect(d.status()).toBe(200);const dataset=await d.json();
  const c=await page.request.post('/backend/campaigns',{headers:{...headers,'Idempotency-Key':crypto.randomUUID()},data:{agentVersionId:agent.id,datasetVersionId:dataset.id,requiresApproval:true}});expect(c.status()).toBe(200);const campaign=await c.json();
  await page.reload();await expect(page.getByRole('button',{name:'로그아웃',exact:true})).toBeVisible();
  const region=page.getByRole('region',{name:'버전과 평가 캠페인',exact:true});
  await region.getByRole('button',{name:'캠페인 '+campaign.id.slice(0,8),exact:true}).click();
  await region.getByLabel('캠페인 취소 사유',{exact:true}).fill('Browser pending campaign cancellation');
  await region.getByRole('button',{name:'미완료 사례 취소',exact:true}).click();
  await expect(region.getByText('캠페인의 미완료 사례 취소를 확인했습니다.',{exact:true})).toBeVisible();
  const saved=await (await page.request.get('/backend/campaigns/'+campaign.id)).json();expect(saved.state).toBe('failed');expect(saved.decision).toBe('inconclusive');
  expect((await (await page.request.get('/backend/campaigns/'+campaign.id+'/gate')).json()).deploymentAllowed).toBe(false);
  phase('actual browser verifies terminal cancellation and denied release for run and campaign');
 }finally{if(legacyReturn){const resumed=hostedWorker('resume');expect(resumed.completed).toBe(true);if(paused){expect(resumed.restored).toBe(true);expect(resumed.identityPreserved).toBe(true)}phase('owned hosted worker unpaused with ID image and StartedAt preserved')}else{execFileSync('docker',['start',worker],{timeout:25000});phase('dedicated worker restored')}}
});


test('viewer opens existing campaign history and clears a foreign filtered page',async({page})=>{
 phase('history acceptance source step 1');
 await login(page,'demo-viewer');const region=page.getByRole('region',{name:'프로젝트 캠페인 이력',exact:true});
 phase('history acceptance source step 2');
 await region.getByRole('button',{name:'최신 캠페인 이력 조회',exact:true}).click();
 phase('history acceptance source step 3');
 await expect(region.locator('[data-campaign-history-id]').first()).toBeVisible();
 phase('history acceptance source step 4');
 const first=await region.locator('[data-campaign-history-id]').evaluateAll(rows=>rows.map(row=>row.getAttribute('data-campaign-history-id')));
 phase('history acceptance source step 5');
 const filterResponse=await page.request.get('/backend/campaign-history');expect(filterResponse.ok()).toBe(true);
 phase('history acceptance source step 6');
 const filterPage=await filterResponse.json(),example=filterPage.entries[0];
 phase('history acceptance source step 7');
 await region.getByLabel('캠페인 이력 승인 설정',{exact:true}).selectOption(example.requiresApproval?'required':'not-required');
 phase('history acceptance source step 8');
 await region.getByLabel('캠페인 이력 에이전트 버전',{exact:true}).selectOption(example.agentVersionId);
 const matching=filterPage.entries.filter((row:{requiresApproval:boolean;agentVersionId:string})=>row.requiresApproval===example.requiresApproval&&row.agentVersionId===example.agentVersionId);
 phase('history acceptance source step 9');
 await expect(region.locator('[data-campaign-history-id]')).toHaveCount(matching.length);
 phase('history acceptance source step 10');
 expect(await region.locator('[data-campaign-history-id]').evaluateAll(rows=>rows.map(row=>row.getAttribute('data-campaign-history-id')))).toEqual(matching.map((row:{id:string})=>row.id));
 phase('history acceptance source step 11');
 await region.getByRole('button',{name:'캠페인 이력 필터 해제',exact:true}).click();
 phase('history acceptance source step 12');
 await expect(region.locator('[data-campaign-history-id]')).toHaveCount(filterPage.entries.length);

 let selected=first[0]!;
 phase('history acceptance source step 13');
 if(await region.getByRole('button',{name:'다음 캠페인 페이지',exact:true}).isEnabled()){
  phase('history acceptance source step 14');
  await region.getByRole('button',{name:'다음 캠페인 페이지',exact:true}).click();await expect(region.getByText(/캠페인 이력 페이지 2/)).toBeVisible();
  phase('history acceptance source step 15');
  const second=await region.locator('[data-campaign-history-id]').evaluateAll(rows=>rows.map(row=>row.getAttribute('data-campaign-history-id')));expect(second.length).toBeGreaterThan(0);expect(second.some(id=>first.includes(id))).toBe(false);selected=second[0]!;
 }
 phase('history acceptance source step 16');
 await region.getByRole('button',{name:'캠페인 근거 '+selected.slice(0,8),exact:true}).click();
 phase('history acceptance source step 17');
 await expect(page.getByText('캠페인 '+selected,{exact:true})).toBeVisible();
 const caseRegion=page.getByRole('region',{name:'캠페인 사례 근거 탐색',exact:true});
 phase('history acceptance source step 18');
 const campaignResponse=await page.request.get('/backend/campaigns/'+selected);expect(campaignResponse.ok()).toBe(true);
 phase('history acceptance source step 19');
 const campaignEvidence=await campaignResponse.json(),caseExample=campaignEvidence.cases[0];
 phase('history acceptance source step 20');
 await caseRegion.getByLabel('사례 식별자 검색',{exact:true}).fill(caseExample.caseId.toUpperCase());
 phase('history acceptance source step 21');
 await caseRegion.getByLabel('사례 필수 여부',{exact:true}).selectOption(caseExample.required?'required':'optional');
 phase('history acceptance source step 22');
 await caseRegion.getByLabel('사례 판정',{exact:true}).selectOption(caseExample.decision);
 phase('history acceptance source step 23');
 await caseRegion.getByLabel('사례 실행 상태',{exact:true}).selectOption(caseExample.state);
 const expectedCases=campaignEvidence.cases.filter((row:{caseId:string;required:boolean;decision:string;state:string})=>row.caseId.toLowerCase().includes(caseExample.caseId.toLowerCase())&&row.required===caseExample.required&&row.decision===caseExample.decision&&row.state===caseExample.state);
 phase('history acceptance source step 24');
 await expect(caseRegion.locator('[data-campaign-case-id]')).toHaveCount(expectedCases.length);
 phase('history acceptance source step 25');
 expect(await caseRegion.locator('[data-campaign-case-id]').evaluateAll(rows=>rows.map(row=>row.getAttribute('data-campaign-case-id')))).toEqual(expectedCases.map((row:{caseId:string})=>row.caseId));
 phase('history acceptance source step 26');
 await caseRegion.getByRole('button',{name:'사례 필터 해제',exact:true}).click();
 phase('history acceptance source step 27');
 await expect(caseRegion.getByLabel('사례 식별자 검색',{exact:true})).toHaveValue('');
 phase('history acceptance source step 28');
 await expect(caseRegion.locator('[data-campaign-case-id]')).toHaveCount(campaignEvidence.cases.length);

 phase('history acceptance source step 29');
 await region.getByRole('button',{name:'최신 캠페인 이력 조회',exact:true}).click();await expect(region.locator('[data-campaign-history-id]').first()).toBeVisible();
 phase('history acceptance source step 30');
 const request=await page.request.get('/backend/campaigns/'+selected),record=await request.json();
 phase('history acceptance source step 31');
 const snapshot=await (await page.request.get('/backend/campaign-history/dataset/'+record.dataset_version_id)).json();
 phase('history acceptance source step 32');
 await page.route('**/backend/campaign-history/dataset/'+record.dataset_version_id,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...snapshot,organizationId:'ffffffff-ffff-4fff-8fff-ffffffffffff'})}));
 phase('history acceptance source step 33');
 await region.getByRole('button',{name:'최신 캠페인 이력 조회',exact:true}).click();
 phase('history acceptance source step 34');
 await expect(region.getByText('캠페인 이력을 확인하지 못했습니다. 다시 조회해 주세요.',{exact:true})).toBeVisible();await expect(region.locator('[data-campaign-history-id]')).toHaveCount(0);
 phase('actual campaign history opens existing frozen evidence and refuses foreign dataset response');
});

test('viewer selects an existing historical baseline and verifies a real campaign comparison',async({page})=>{
 const folder=resolve(process.cwd(),'../../.local');
 const proof=readdirSync(folder).filter(name=>name.startsWith('stack-campaign-smoke-')&&name.endsWith('.json')).map(name=>({path:resolve(folder,name),at:statSync(resolve(folder,name)).mtimeMs})).sort((a,b)=>b.at-a.at).map(file=>JSON.parse(readFileSync(file.path,'utf-8'))).find(value=>value.completed&&value.campaignId&&value.comparisonCampaignId);
 expect(proof).toBeTruthy();await login(page,'demo-viewer');const region=page.getByRole('region',{name:'프로젝트 캠페인 이력',exact:true});
 await region.getByRole('button',{name:'최신 캠페인 이력 조회',exact:true}).click();await expect(region.locator('[data-campaign-history-id]').first()).toBeVisible();
 const candidate=region.getByRole('button',{name:'캠페인 근거 '+proof.campaignId.slice(0,8),exact:true});
 for(let attempt=0;attempt<8&&!await candidate.count();attempt++){
  await expect(region.getByRole('button',{name:'다음 캠페인 페이지',exact:true})).toBeEnabled();await region.getByRole('button',{name:'다음 캠페인 페이지',exact:true}).click();await expect(region.getByText(new RegExp('캠페인 이력 페이지 '+(attempt+2)+' '))).toBeVisible();
 }
 await candidate.click();await expect(page.getByText('캠페인 '+proof.campaignId,{exact:true})).toBeVisible();
 await region.getByRole('button',{name:'최신 캠페인 이력 조회',exact:true}).click();await expect(region.locator('[data-campaign-history-id]').first()).toBeVisible();
 await region.getByRole('button',{name:'비교 기준 '+proof.comparisonCampaignId.slice(0,8)+' 선택',exact:true}).click();
 await expect(page.getByLabel('비교 기준 캠페인',{exact:true})).toHaveValue(proof.comparisonCampaignId);
 const comparisonPath='**/backend/campaigns/'+proof.campaignId+'/comparison/'+proof.comparisonCampaignId;
 let releaseComparison!:()=>void,comparisonReceived!:()=>void;
 const heldComparison=new Promise<void>(resolve=>{releaseComparison=resolve}),receivedComparison=new Promise<void>(resolve=>{comparisonReceived=resolve});
 await page.route(comparisonPath,async route=>{const response=await route.fetch();expect(response.status()).toBe(200);comparisonReceived();await heldComparison;await route.fulfill({response});});
 try{
  await page.getByRole('button',{name:'캠페인 회귀 비교',exact:true}).click();await receivedComparison;
  await expect(page.getByLabel('비교 기준 캠페인',{exact:true})).toBeDisabled();
  await expect(page.getByRole('region',{name:'검증된 캠페인 회귀 비교 결과',exact:true})).toHaveCount(0);
 }finally{releaseComparison();}
 await expect(page.getByText(/새 필수 실패: 없음/)).toBeVisible();
 await expect(page.getByRole('region',{name:'검증된 캠페인 회귀 비교 결과',exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:/개선된 필수 사례 · \d+개/})).toBeVisible();
 const comparisonResult=page.getByRole('region',{name:'검증된 캠페인 회귀 비교 결과',exact:true});
 await expect(comparisonResult.getByText(proof.campaignId,{exact:true})).toBeVisible();
 await expect(comparisonResult.getByText(proof.comparisonCampaignId,{exact:true})).toBeVisible();
 await comparisonResult.getByLabel('회귀 비교 원인',{exact:true}).selectOption('failed');
 await expect(comparisonResult.getByRole('region',{name:'개선된 필수 사례',exact:true})).toHaveCount(0);
 await comparisonResult.getByRole('searchbox',{name:'회귀 비교 사례 검색',exact:true}).fill('<script>');
 await comparisonResult.getByRole('button',{name:'회귀 비교 필터 초기화',exact:true}).click();
 await expect(comparisonResult.getByLabel('회귀 비교 원인',{exact:true})).toHaveValue('all');
 await expect(comparisonResult.getByRole('searchbox',{name:'회귀 비교 사례 검색',exact:true})).toHaveValue('');
 await expect(comparisonResult.getByRole('button',{name:'후보 캠페인 근거 열기',exact:true})).toBeVisible();
 await expect(comparisonResult.getByRole('button',{name:'비교 기준 캠페인 근거 열기',exact:true})).toBeVisible();

 await page.getByLabel('비교 기준 캠페인',{exact:true}).selectOption('');
 await expect(comparisonResult).toHaveCount(0);
 phase('read-only historical dataset navigation supplies the real baseline to Java comparison verification; result identifies both requests and clears on baseline change');
});


test('viewer checks real evaluation dependencies and clears untrusted or unavailable observations',async({page})=>{
 await login(page,'demo-viewer');const region=page.getByRole('region',{name:'평가 경로 준비 상태',exact:true});
 await region.getByRole('button',{name:'평가 경로 상태 확인',exact:true}).click();
 await expect(region.getByText('평가 경로 연결 확인 완료',{exact:true})).toBeVisible();
 await expect(region.getByText('Python 평가 워커·NATS 큐 · 연결 확인',{exact:true})).toBeVisible();
 const snapshot=await (await page.request.get('/backend/evaluation-readiness')).json();
 await page.route('**/backend/evaluation-readiness',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({...snapshot,ready:false,dependencies:snapshot.dependencies.map((d:{name:string;available:boolean})=>({...d,available:d.name!=='worker-queue'}))})}));
 await region.getByRole('button',{name:'평가 경로 상태 확인',exact:true}).click();
 await expect(region.getByText('Python 평가 워커·NATS 큐 · 확인 불가',{exact:true})).toBeVisible();
 await page.unroute('**/backend/evaluation-readiness');
 await page.route('**/backend/evaluation-readiness',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...snapshot,projectId:'ffffffff-ffff-4fff-8fff-ffffffffffff'})}));
 await region.getByRole('button',{name:'평가 경로 상태 확인',exact:true}).click();
 await expect(region.getByText('준비 상태를 확인하지 못했습니다. 다시 조회해 주세요.',{exact:true})).toBeVisible();
 await expect(region.locator('time')).toHaveCount(0);await expect(region.locator('li')).toHaveCount(0);
 phase('actual ready dependency response, simulated unavailable rendering and foreign-scope clearing verified');
});


test('viewer verifies an older registered version before selecting it for campaign preparation',async({page})=>{
 phase('history acceptance source step 1');
 await login(page,'demo-viewer');
 for(const [kind,label,selectLabel] of [['agents','에이전트','캠페인 에이전트 버전'],['datasets','데이터셋','캠페인 데이터셋 버전']] as const){
  const region=page.getByRole('region',{name:'프로젝트 '+label+' 버전 이력',exact:true});
  phase('history acceptance source step 2');
  await region.getByRole('button',{name:label+' 버전 이력 조회',exact:true}).click();await expect(region.locator('[data-version-history-id]').first()).toBeVisible();
  phase('history acceptance source step 3');
  const first=await region.locator('[data-version-history-id]').evaluateAll(rows=>rows.map(row=>row.getAttribute('data-version-history-id')));
  phase('history acceptance source step 4');
  const versionPage=await (await page.request.get('/backend/version-history/'+kind)).json(),resourceKey=versionPage.entries[0].resourceKey;
  phase('history acceptance source step 5');
  await region.getByLabel(label+' 이력 이름',{exact:true}).selectOption(resourceKey);
  const nameMatches=versionPage.entries.filter((entry:{resourceKey:string})=>entry.resourceKey===resourceKey);
  phase('history acceptance source step 6');
  expect(await region.locator('[data-version-history-id]').evaluateAll(rows=>rows.map(row=>row.getAttribute('data-version-history-id')))).toEqual(nameMatches.map((entry:{id:string})=>entry.id));
  phase('history acceptance source step 7');
  await region.getByRole('button',{name:'이름 필터 해제',exact:true}).click();
  phase('history acceptance source step 8');
  expect(await region.locator('[data-version-history-id]').evaluateAll(rows=>rows.map(row=>row.getAttribute('data-version-history-id')))).toEqual(first);
  phase('history acceptance source step 9');
  if(await region.getByRole('button',{name:'다음 '+label+' 버전 페이지',exact:true}).isEnabled()){
   phase('history acceptance source step 10');
   await region.getByRole('button',{name:'다음 '+label+' 버전 페이지',exact:true}).click();await expect(region.getByText(new RegExp(label+' 버전 페이지 2 '))).toBeVisible();
   phase('history acceptance source step 11');
   const older=await region.locator('[data-version-history-id]').evaluateAll(rows=>rows.map(row=>row.getAttribute('data-version-history-id')));expect(older.some(id=>first.includes(id))).toBe(false);
  }
  phase('history acceptance source step 12');
  const row=region.locator('[data-version-history-id]').last(),id=await row.getAttribute('data-version-history-id');
  phase('history acceptance source step 13');
  const response=page.waitForResponse(r=>r.url().endsWith('/versions/'+kind+'/'+id)&&r.request().method()==='GET');await row.getByRole('button',{name:new RegExp('^'+label+' 버전 .* 선택$')}).click();expect((await response).status()).toBe(200);
  phase('history acceptance source step 14');
  await expect(region.getByText(/내용·해시·활성 상태 확인 후 선택:/)).toBeVisible();await expect(page.getByLabel(selectLabel,{exact:true})).toHaveValue(id!);
  phase('history acceptance source step 15');
  if(!first.includes(id)){await region.getByRole('button',{name:'이전 '+label+' 버전 페이지',exact:true}).click();await expect(region.getByText(new RegExp(label+' 버전 페이지 1 '))).toBeVisible();expect(await region.locator('[data-version-history-id]').evaluateAll(rows=>rows.map(row=>row.getAttribute('data-version-history-id')))).toEqual(first);}
  const alternateId=first.find(value=>value!==id);expect(alternateId).toBeTruthy();const alternate=region.locator('[data-version-history-id="'+alternateId+'"]');expect(alternateId).not.toBe(id);
  phase('history acceptance source step 16');
  const detail=await (await page.request.get('/backend/versions/'+kind+'/'+alternateId)).json(),match=/^(.*T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(?:Z|\+00:00)$/.exec(detail.created_at);expect(match).not.toBeNull();
  const nanos=Number((match![2]??'').padEnd(9,'0')),changed=nanos%1000000===999000?nanos-1000:nanos+1000,created_at=match![1]+'.'+String(changed).padStart(9,'0')+'Z';expect(Date.parse(created_at)).toBe(Date.parse(detail.created_at));
  phase('history acceptance source step 17');
  const detailRoute='**/backend/versions/'+kind+'/'+alternateId;await page.route(detailRoute,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...detail,created_at})}));
  phase('history acceptance source step 18');
  try{await alternate.getByRole('button',{name:new RegExp('^'+label+' 버전 .* 선택$')}).click();await expect(region.getByText('버전 내용과 해시·활성 상태를 확인하지 못했습니다. 선택을 적용하지 않았습니다.',{exact:true})).toBeVisible();await expect(page.getByLabel(selectLabel,{exact:true})).toHaveValue(id!)}finally{await page.unroute(detailRoute)}
  phase(kind+' detail with a one-microsecond metadata substitution is refused while the earlier verified selection remains');
  phase('history acceptance source step 19');
  const snapshot=await (await page.request.get('/backend/version-history/'+kind)).json();await page.route('**/backend/version-history/'+kind,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...snapshot,kind:kind==='agents'?'datasets':'agents'})}));
  phase('history acceptance source step 20');
  await region.getByRole('button',{name:label+' 버전 이력 조회',exact:true}).click();await expect(region.getByText('버전 이력을 확인하지 못했습니다. 다시 조회해 주세요.',{exact:true})).toBeVisible();await expect(region.locator('[data-version-history-id]')).toHaveCount(0);await expect(page.getByLabel(selectLabel,{exact:true})).toHaveValue(id!);await page.unroute('**/backend/version-history/'+kind);
 }
 phase('actual immutable version content/hash checked before controlled selection; foreign-kind page refused');
});


test('mobile reviewer reads actual readiness and immutable version history without horizontal overflow',async({page})=>{
 await page.setViewportSize({width:390,height:844});await login(page,'demo-viewer');
 const ready=page.getByRole('region',{name:'평가 경로 준비 상태',exact:true});await ready.getByRole('button',{name:'평가 경로 상태 확인',exact:true}).click();await expect(ready.getByText('평가 경로 연결 확인 완료',{exact:true})).toBeVisible();
 for(const label of ['에이전트','데이터셋']){const region=page.getByRole('region',{name:'프로젝트 '+label+' 버전 이력',exact:true});await region.getByRole('button',{name:label+' 버전 이력 조회',exact:true}).click();await expect(region.locator('[data-version-history-id]').first()).toBeVisible();expect(await region.evaluate(element=>element.scrollWidth<=element.clientWidth+2)).toBe(true);}
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2)).toBe(true);
 phase('390px actual scoped readiness and version navigation have no horizontal overflow');
});


test('a stalled current gate request times out and a fresh retry verifies the actual signature',async({page})=>{
 await login(page,'demo-viewer');const region=page.getByRole('region',{name:'버전과 평가 캠페인',exact:true});
 const records=await (await page.request.get('/backend/campaigns')).json() as {id:string}[];let selected:string|null=null;
 for(const row of records){const record=await (await page.request.get('/backend/campaigns/'+row.id)).json();if(record.state==='succeeded'&&(await page.request.get('/backend/campaigns/'+row.id+'/evidence')).ok()){selected=row.id;break}}
 expect(selected).not.toBeNull();await region.getByRole('button',{name:'캠페인 '+selected!.slice(0,8),exact:true}).click();
 const checks=page.getByRole('region',{name:'서명된 현재 판정 확인',exact:true});let received!:()=>void,release!:()=>void;const ready=new Promise<void>(resolve=>{received=resolve}),held=new Promise<void>(resolve=>{release=resolve});
 const routePattern='**/backend/campaigns/'+selected+'/gate-check/*';
 await page.route(routePattern,async route=>{received();await held;try{await route.abort()}catch{/* request already aborted by the component deadline */}});
 try{await checks.getByRole('button',{name:'현재 판정 서명 확인',exact:true}).click();await ready;await expect(checks.getByRole('status')).toContainText('서명·범위·유효 시간을 확인하지 못했습니다.',{timeout:15000});await expect(checks.getByRole('button',{name:'현재 판정 서명 확인',exact:true})).toBeEnabled();await expect(checks.getByText(/서명 확인 완료/)).toHaveCount(0)}finally{release();await page.unroute(routePattern)}
 await checks.getByRole('button',{name:'현재 판정 서명 확인',exact:true}).click();await expect(checks.getByText(/서명 확인 완료/)).toBeVisible();
 phase('stalled request releases busy state at the bounded deadline; actual fresh Java signature verifies on retry');
});


test('viewer recovers from a stalled evaluation detail without retaining prior evidence',async({page})=>{
 await login(page,'demo-viewer');const region=page.getByRole('region',{name:'프로젝트 평가 이력',exact:true});await region.getByRole('button',{name:'최신 평가 이력 조회',exact:true}).click();const row=region.locator('[data-run-history-id]').first();const id=await row.getAttribute('data-run-history-id');expect(id).toBeTruthy();const button=row.getByRole('button',{name:'평가 근거 '+id!.slice(0,8),exact:true});await button.click();await expect(page.locator('.evidence').getByText('실행 '+id,{exact:true})).toBeVisible();
 const path='**/backend/runs/'+id;let release!:()=>void,started!:()=>void,finished!:()=>void;const held=new Promise<void>(resolve=>{release=resolve}),entered=new Promise<void>(resolve=>{started=resolve}),done=new Promise<void>(resolve=>{finished=resolve});
 await page.route(path,async route=>{const response=await route.fetch();started();await held;try{await route.fulfill({response})}catch{expect(route.request().failure()?.errorText).toMatch(/abort|cancel|failed/i)}finally{finished()}});
 try{await button.click();await entered;await expect(page.locator('.evidence')).toHaveCount(0);await expect(page.getByText('평가 근거를 확인하지 못했습니다. 다시 선택해 주세요.',{exact:true})).toBeVisible({timeout:12000});release();await done;await expect(page.locator('.evidence')).toHaveCount(0)}finally{release();await page.unroute(path)}
 await button.click();await expect(page.locator('.evidence').getByText('실행 '+id,{exact:true})).toBeVisible();phase('actual ten-second detail deadline clears prior evidence and permission; late response remains refused and a manual scoped API retry recovers; no business writes');
 const gatePath='**/backend/runs/'+id+'/gate';let releaseGate!:()=>void,gateStarted!:()=>void,gateFinished!:()=>void;const gateHeld=new Promise<void>(resolve=>{releaseGate=resolve}),gateEntered=new Promise<void>(resolve=>{gateStarted=resolve}),gateDone=new Promise<void>(resolve=>{gateFinished=resolve});
 await page.route(gatePath,async route=>{const response=await route.fetch();gateStarted();await gateHeld;try{await route.fulfill({response})}catch{expect(route.request().failure()?.errorText).toMatch(/abort|cancel|failed/i)}finally{gateFinished()}});
 try{await button.click();await gateEntered;await expect(page.locator('.evidence')).toHaveCount(0);await expect(page.getByText('평가 근거를 확인하지 못했습니다. 다시 선택해 주세요.',{exact:true})).toBeVisible({timeout:12000});releaseGate();await gateDone;await expect(page.locator('.evidence')).toHaveCount(0)}finally{releaseGate();await page.unroute(gatePath)}
 await button.click();await expect(page.locator('.evidence').getByText('실행 '+id,{exact:true})).toBeVisible();phase('a stalled real OPA gate response shares the detail deadline and cannot display partially verified evidence or earlier permission; manual retry recovers');

});


test('viewer recovers bounded archive and similarity reads after stalled responses',async({page})=>{
 await login(page,'demo-viewer');
 const frame=await (await page.request.get('/backend/audit-search/evaluation.completed/all')).json();const id=frame.entries[0].resourceId;const value=await (await page.request.get('/backend/runs/'+id)).json();expect(value.state).not.toBe('queued');
 const history=page.getByRole('region',{name:'프로젝트 평가 이력',exact:true});await history.getByRole('button',{name:'최신 평가 이력 조회',exact:true}).click();
 const audit=page.getByRole('region',{name:'감사 기록 검색',exact:true});await audit.getByLabel('감사 작업 종류',{exact:true}).selectOption('evaluation.completed');await audit.getByLabel('감사 대상 ID',{exact:true}).fill(id);await audit.getByRole('button',{name:'감사 기록 검색 실행',exact:true}).click();await audit.getByRole('button',{name:'평가 근거 '+id.slice(0,8),exact:true}).first().click();await expect(page.locator('.evidence').getByText('실행 '+id,{exact:true})).toBeVisible();
 for(const item of [{suffix:'evidence',button:'근거 해시·버전 확인',failure:'보관된 근거를 확인하지 못했습니다. 잠시 후 다시 확인해 주세요.'},{suffix:'similar',button:'유사 근거 찾기',failure:'유사 근거를 조회하지 못했습니다. 색인 준비 후 다시 확인해 주세요.'}]){
  const path='**/backend/runs/'+id+'/'+item.suffix;let release!:()=>void,started!:()=>void,finished!:()=>void;const held=new Promise<void>(resolve=>{release=resolve}),entered=new Promise<void>(resolve=>{started=resolve}),done=new Promise<void>(resolve=>{finished=resolve});const button=page.locator('.evidence').getByRole('button',{name:item.button,exact:true});
  await page.route(path,async route=>{const response=await route.fetch();started();await held;try{await route.fulfill({response})}catch{expect(route.request().failure()?.errorText).toMatch(/abort|cancel|failed/i)}finally{finished()}});
  try{await button.click();await entered;await expect(button).toBeDisabled();await expect(page.getByText(item.failure,{exact:true})).toBeVisible({timeout:12000});await expect(button).toBeEnabled();release();await done;await expect(page.getByText(item.failure,{exact:true})).toBeVisible()}finally{release();await page.unroute(path)}
  await button.click();await expect(button).toBeEnabled();if(item.suffix==='evidence')await expect(page.getByText('서버와 브라우저의 바이트 해시 검증 완료',{exact:false})).toBeVisible();else await expect(page.getByText('같은 프로젝트의 규칙 특징이 비슷한 평가를 조회했습니다.',{exact:true})).toBeVisible();
 }
 phase('actual ten-second archived-byte and pgvector read deadlines release controls, refuse delayed results and recover through manual real scoped API retries; no business writes');
});


test('workspace history search finds older server-filtered evaluations and opens scoped evidence',async({page})=>{
 await login(page,'demo-viewer');
 type Observed={entries:{id:string;provider:string;scenario:string;requiresApproval:boolean;state:string;decision:string}[];nextCursor:string|null};
 const observed:{page:Observed|null}={page:null};let corruptNext=false,holdNext=false,heldStarted=false,heldReady=false,heldCancelled=false;
 let releaseHeld:()=>void=()=>{},finishHeld:()=>void=()=>{};
 const heldRelease=new Promise<void>(resolve=>{releaseHeld=resolve}),heldDone=new Promise<void>(resolve=>{finishHeld=resolve});
 const pattern='**/backend/run-history-search/**';
 await page.route(pattern,async route=>{
  const hold=holdNext;holdNext=false;if(hold)heldStarted=true;
  try{
   const upstream=await route.fetch({maxRetries:0,maxRedirects:0,timeout:10000});expect(upstream.status()).toBe(200);
   const bytes=await upstream.body();expect(bytes.length).toBeLessThanOrEqual(1048576);
   const frame=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as Observed;
   if(hold){heldReady=true;await heldRelease}else observed.page=frame;
   const corrupt=corruptNext;corruptNext=false;
   await route.fulfill({response:upstream,...(corrupt?{body:JSON.stringify({...frame,organizationId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'})}:{})});
  }catch(error){if(!(hold&&heldCancelled))throw error}finally{if(hold)finishHeld()}
 });
 const region=page.getByRole('region',{name:'전체 평가 이력 검색',exact:true}),rows=region.locator('[data-run-search-id]'),search=region.getByRole('button',{name:'전체 평가 이력 검색 실행',exact:true});
 const ids=()=>rows.evaluateAll(elements=>elements.map(element=>element.getAttribute('data-run-search-id')));
 try{
  await search.click();await expect(rows).toHaveCount(25);const first=await ids();expect(observed.page!.entries.map(row=>row.id)).toEqual(first);
  await region.getByRole('button',{name:'다음 전체 이력 검색 페이지',exact:true}).click();await expect(region.getByText(/전체 이력 검색 페이지 2/)).toBeVisible();
  const older=await ids();expect(older.length).toBeGreaterThan(0);expect(older.some(id=>first.includes(id))).toBe(false);expect(older).toEqual(observed.page!.entries.map(row=>row.id));
  await region.getByRole('button',{name:'검색 평가 근거 '+older[0]!.slice(0,8),exact:true}).click();await expect(page.locator('.evidence').getByText('실행 '+older[0],{exact:true})).toBeVisible();
  phase('actual server search reaches older pages and opens existing scoped evidence without creating evaluations');
  for(const [label,value] of [['시나리오','pass'],['승인 필요 설정','required'],['실행 상태','succeeded'],['판정','pass'],['공급자','synthetic']])await region.getByLabel('전체 이력 '+label,{exact:true}).selectOption(value);
  await expect(rows).toHaveCount(0);await search.click();await expect(region.getByText(/전체 이력 검색 페이지 1/)).toBeVisible();
  expect(await ids()).toEqual(observed.page!.entries.map(row=>row.id));expect(observed.page!.entries.length).toBeGreaterThan(0);
  expect(observed.page!.entries.every(row=>row.scenario==='pass'&&row.requiresApproval&&row.state==='succeeded'&&row.decision==='pass'&&row.provider==='synthetic')).toBe(true);
  phase('all five conditions match the actual server response, rather than filtering only the first 25 records');
  corruptNext=true;await search.click();await expect(region.getByText('전체 평가 이력 검색을 확인하지 못했습니다. 현재 서버의 지원 상태나 연결을 확인하고 다시 검색해 주세요.',{exact:true})).toBeVisible();await expect(rows).toHaveCount(0);
  phase('foreign response scope is refused without inventing empty success');
  await region.getByRole('button',{name:'전체 이력 검색 조건 초기화',exact:true}).click();holdNext=true;await search.click();await expect.poll(()=>heldReady).toBe(true);
  heldCancelled=true;await region.getByLabel('전체 이력 판정',{exact:true}).selectOption('block');await search.click();await expect(region.getByText(/전체 이력 검색 페이지 1/)).toBeVisible();
  const current=await ids();expect(observed.page!.entries.every(row=>row.decision==='block')).toBe(true);releaseHeld();await heldDone;expect(await ids()).toEqual(current);await expect(region.getByLabel('전체 이력 판정',{exact:true})).toHaveValue('block');
  phase('changed conditions abort the previous request and late bytes cannot replace the current search');
  await page.setViewportSize({width:390,height:844});await region.scrollIntoViewIfNeeded();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  const searchTable=region.getByRole('region',{name:'전체 평가 이력 검색 결과 표 · 좁은 화면에서 좌우로 이동',exact:true});
  expect(await rows.evaluateAll(elements=>elements.every(row=>row.getBoundingClientRect().height<100))).toBe(true);
  await searchTable.evaluate(element=>{element.scrollLeft=element.scrollWidth});
  const evidenceButton=rows.first().getByRole('button');await evidenceButton.scrollIntoViewIfNeeded();await expect(evidenceButton).toBeInViewport();
  await evidenceButton.click();await expect(page.locator('.evidence').getByText('실행 '+current[0],{exact:true})).toBeVisible();
  await searchTable.evaluate(element=>{element.scrollLeft=0});
  await region.screenshot({path:'test-results/workspace-history-search-mobile.png'});phase('actual authenticated mobile search controls, compact rows and reachable evidence fit the viewport');
 }finally{releaseHeld();if(heldStarted)await heldDone;await page.unroute(pattern)}
});

if(process.env.STACK_E2E_LEGACY_CORE_RETURN==='true')test('legacy Core return keeps whole-history search unavailable without inventing empty results',async({page})=>{
 await login(page,'demo-viewer');const region=page.getByRole('region',{name:'전체 평가 이력 검색',exact:true});
 const response=page.waitForResponse(response=>response.request().method()==='GET'&&new URL(response.url()).pathname==='/backend/run-history-search/all/all/all/all/all'&&response.status()===500);
 await region.getByRole('button',{name:'전체 평가 이력 검색 실행',exact:true}).click();await response;
 await expect(region.getByText('전체 평가 이력 검색을 확인하지 못했습니다. 현재 서버의 지원 상태나 연결을 확인하고 다시 검색해 주세요.',{exact:true})).toBeVisible();
 await expect(region.locator('[data-run-search-id]')).toHaveCount(0);await expect(region.getByText('검색 조건에 맞는 평가 이력이 없습니다.',{exact:true})).toHaveCount(0);
 const unavailable=await page.request.get('/backend/run-history-search/all/all/all/all/all');expect(unavailable.status()).toBe(500);expect(await unavailable.json()).toEqual({code:'REQUEST_UNAVAILABLE'});
 expect((await page.request.get('/backend/me')).status()).toBe(200);phase('pinned old Core search is explicitly unavailable; existing session remains valid');
});


if(process.env.STACK_E2E_LEGACY_CORE_RETURN!=='true')test('editor copies an actual dataset into an edited immutable version without changing its source',async({page})=>{
 await login(page,'demo-editor');
 const list=await (await page.request.get('/backend/versions/datasets')).json(),source=list[0];expect(source).toBeTruthy();
 const original=await (await page.request.get('/backend/versions/datasets/'+source.id)).json();expect(source.created_at).toBe(original.created_at);phase('dataset list and detail retain exact matching microsecond coordinates');
 const region=page.getByRole('region',{name:'데이터셋 새 버전 초안',exact:true});await region.getByLabel('복사할 데이터셋 버전 ID',{exact:true}).fill(source.id);
 let posts=0;page.on('request',r=>{if(new URL(r.url()).pathname==='/backend/versions/datasets'&&r.method()==='POST')posts++});
 await region.getByRole('button',{name:'데이터셋 새 초안 불러오기',exact:true}).click();await expect(region.getByText(/새 버전 초안을 준비했습니다/)).toBeVisible();expect(posts).toBe(0);
 const copied=JSON.parse(await region.getByLabel('복사본 사례 JSON',{exact:true}).inputValue());expect(copied).toEqual(original.definition.cases);
 const key='browser-copy-'+randomUUID();await region.getByLabel('복사본 데이터셋 이름',{exact:true}).fill(key);copied[0].id='copied-first-case';await region.getByLabel('복사본 사례 JSON',{exact:true}).fill(JSON.stringify(copied));
 const save=region.getByRole('button',{name:'수정한 데이터셋 새 버전 등록',exact:true});
 const register=page.waitForResponse(r=>new URL(r.url()).pathname==='/backend/versions/datasets'&&r.request().method()==='POST');await save.click();const response=await register;expect(response.status()).toBe(200);const created=await response.json();expect(created.id).not.toBe(source.id);expect(created.resource_key).toBe(key);expect(created.definition.cases).toEqual(copied);expect(created.content_sha256).not.toBe(original.content_sha256);await expect(region.getByText(/새 데이터셋 버전 확인/)).toBeVisible();
 const retry=page.waitForResponse(r=>new URL(r.url()).pathname==='/backend/versions/datasets'&&r.request().method()==='POST');await save.click();const duplicate=await retry;expect(duplicate.status()).toBe(200);expect((await duplicate.json()).id).toBe(created.id);await expect(region.getByText(/새 데이터셋 버전 확인/)).toBeVisible();
 copied[0].id='conflicting-first-case';await region.getByLabel('복사본 사례 JSON',{exact:true}).fill(JSON.stringify(copied));const conflict=page.waitForResponse(r=>new URL(r.url()).pathname==='/backend/versions/datasets'&&r.request().method()==='POST');await save.click();expect((await conflict).status()).toBe(409);await expect(region.getByText(/같은 키·버전에 다른 내용/)).toBeVisible();expect(posts).toBe(3);
 expect(await (await page.request.get('/backend/versions/datasets/'+source.id)).json()).toEqual(original);expect((await (await page.request.get('/backend/versions/datasets/'+created.id)).json()).definition.cases[0].id).toBe('copied-first-case');
 for(const width of [1440,390]){await page.setViewportSize({width,height:960});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
 phase('actual editor source read and verified draft, explicit edited immutable registration, same-coordinate retry returns same ID, conflicting-content409, source unchanged, no evaluation created,1440 and390 no overflow');
});

if(process.env.STACK_E2E_LEGACY_CORE_RETURN!=='true')test('viewer cannot copy dataset drafts or register copied content',async({page})=>{
 await login(page,'demo-viewer');const region=page.getByRole('region',{name:'데이터셋 새 버전 초안',exact:true});await expect(region.getByRole('button',{name:'데이터셋 새 초안 불러오기',exact:true})).toBeDisabled();
 await expect(region.getByRole('button',{name:'수정한 데이터셋 새 버전 등록',exact:true})).toBeDisabled();
 const csrf=await (await page.request.get('/backend/csrf')).json();const response=await page.request.post('/backend/versions/datasets',{headers:{'X-CSRF-TOKEN':csrf.token,Origin:'http://127.0.0.1:4320'},data:{key:'viewer-copy-denied',version:1,cases:[{id:'required',scenario:'pass',required:true}]}});expect(response.status()).toBe(403);
 phase('viewer copy controls disabled and actual dataset registration API forbidden403');
});

if(process.env.STACK_E2E_LEGACY_CORE_RETURN!=='true')test('viewer opens selected actual signed observation details from project history without issuing authority',async({page,request})=>{
 await login(page,'demo-viewer');const me=await (await page.request.get('/backend/me')).json(),history=receiptHistoryPage(await (await page.request.get('/backend/receipt-history')).json(),me);expect(history.entries.length).toBeGreaterThan(0);const row=history.entries[0],path='/backend/campaigns/'+row.campaignId+'/receipts/'+row.id+'/bundle';expect((await request.get(path)).status()).toBe(401);const bundle=await (await page.request.get(path)).json(),trustPath='/backend/'+selectedObservationTrustPath(bundle,row),trust=await (await page.request.get(trustPath)).json(),proof=await verifiedSelectedObservation(bundle,trust,me,row);expect(proof.currentDeploymentAuthority).toBe(false);
 let writes=0,trustReads=0,downloads=0;page.on('request',r=>{const p=new URL(r.url()).pathname;if(p.startsWith('/backend/')&&r.method()!=='GET')writes++;if(p.startsWith('/backend/gate-trust/keys/'))trustReads++});page.on('download',()=>downloads++);
 const region=page.getByRole('region',{name:'프로젝트 서명 관측 기록 탐색',exact:true});await region.getByRole('button',{name:'최신 서명 관측 기록 조회',exact:true}).click();const entry=region.locator('[data-receipt-history-id="'+row.id+'"]');await entry.getByRole('button',{name:'관측 기록 상세 '+row.id.slice(0,8),exact:true}).click();const inspector=page.getByRole('region',{name:'선택 서명 관측 상세',exact:true}),verify=inspector.getByRole('button',{name:'선택 관측 서명·근거 확인',exact:true}),content=inspector.locator('[data-receipt-inspection-id]');await expect(content).toHaveCount(0);expect(trustReads).toBe(0);await verify.click();await expect(content).toHaveAttribute('data-receipt-inspection-id',row.id);await expect(content.getByLabel('과거 관측 게이트 근거',{exact:true})).toHaveText(proof.historicalGateReason);await expect(content.getByLabel('서명된 관측 메모',{exact:true})).toHaveText(proof.note);await expect(content.locator('time').nth(0)).toHaveAttribute('datetime',row.createdAt);await expect(content.locator('time').nth(1)).toHaveAttribute('datetime',proof.issuedAt);await expect(content).toContainText('부모·'+proof.childArchives+'개 사례');await expect(inspector).toContainText('현재 게이트·승인·배포 권한을 부여하지 않습니다');
 for(const width of [1440,390]){await page.setViewportSize({width,height:960});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
 await page.route('**'+path,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...bundle,receipt:{...bundle.receipt,keyId:'0'.repeat(64)}})}));const reads=trustReads;await verify.click();await expect(inspector.getByText(/근거를 확인하지 못했습니다/)).toBeVisible();await expect(content).toHaveCount(0);expect(trustReads).toBe(reads);await page.unroute('**'+path);
 const invalid=structuredClone(bundle),signature=Buffer.from(invalid.receipt.signatureBase64,'base64');signature[0]^=1;invalid.receipt.signatureBase64=signature.toString('base64');await page.route('**'+path,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(invalid)}));await verify.click();await expect(inspector.getByText(/근거를 확인하지 못했습니다/)).toBeVisible();await expect(content).toHaveCount(0);await page.unroute('**'+path);
 await page.route('**'+path,route=>route.fulfill({status:503,contentType:'application/json',body:'{}'}));await verify.click();await expect(inspector.getByText(/근거를 확인하지 못했습니다/)).toBeVisible();await expect(content).toHaveCount(0);await page.unroute('**'+path);
 let release!:()=>void;const held=new Promise<void>(resolve=>release=resolve);await page.route('**'+path,async route=>{await held;await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(bundle)}).catch(()=>{})});try{await verify.click();await inspector.getByRole('button',{name:'관측 상세 닫기·취소',exact:true}).click();release();await page.waitForTimeout(250);await expect(content).toHaveCount(0);}finally{release();await page.unroute('**'+path)}await verify.click();await expect(content).toHaveCount(1);await region.getByLabel('서명 관측 캠페인 ID 필터',{exact:true}).fill(row.campaignId);await expect(inspector).toHaveCount(0);expect(writes).toBe(0);expect(downloads).toBe(0);
 phase('actual selected project receipt and campaign and key bind existing Ed25519 signature plus parent child archive bytes; signed reason note and issued time match API while listed time stays separate; anonymous401; changed key refused before trust lookup; forged signature503 and cancelled late bundle remove proof; filter clears selected detail;1440 and390; no business writes downloads signing or current deployment authority');
});

if(process.env.STACK_E2E_LEGACY_CORE_RETURN!=='true')test('viewer browses actual project receipt metadata and opens verified campaign evidence without signing',async({page,request})=>{
 await login(page,'demo-viewer');expect((await request.get('/backend/receipt-history')).status()).toBe(401);const me=await (await page.request.get('/backend/me')).json();
 const database=(campaign?:string)=>JSON.parse(execFileSync(process.platform==='win32'?'python':'python3',[resolve(process.cwd(),'../../scripts/stack-receipt-history-db-probe.py'),me.organizationId,me.projectId,...(campaign?[campaign]:[])],{encoding:'utf8',timeout:20000,maxBuffer:20000}));
 const before=database(),response=await page.request.get('/backend/receipt-history');expect(response.status()).toBe(200);const value=await response.json(),checked=receiptHistoryPage(value,me);expect(checked.entries.length).toBeGreaterThan(0);expect(value.signatureVerificationPerformed).toBe(false);expect(value.deploymentAuthority).toBe(false);
 const canonicalTime=(time:string)=>time.slice(0,19)+'.'+(time.split('.')[1]?.replace('Z','')??'').padEnd(9,'0')+'Z',metadata=(entries:{createdAt:string}[])=>entries.map(row=>({...row,createdAt:canonicalTime(row.createdAt)}));expect(metadata(checked.entries)).toEqual(metadata(before.entries));expect(checked.entries.length).toBe(Math.min(25,before.count));
 let writes=0;page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/backend/')&&r.method()!=='GET')writes++});const region=page.getByRole('region',{name:'프로젝트 서명 관측 기록 탐색',exact:true}),load=region.getByRole('button',{name:'최신 서명 관측 기록 조회',exact:true}),rows=region.locator('[data-receipt-history-id]'),filter=region.getByLabel('서명 관측 캠페인 ID 필터',{exact:true});await expect(rows).toHaveCount(0);await load.click();await expect(rows).toHaveCount(checked.entries.length);expect(await rows.evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-receipt-history-id')))).toEqual(checked.entries.map(row=>row.id));
 for(const width of [1440,390]){await page.setViewportSize({width,height:960});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
 const selected=checked.entries[0];await rows.first().getByRole('button',{name:'캠페인 근거 열기 '+selected.campaignId.slice(0,8),exact:true}).click();await expect(page.getByText('캠페인 '+selected.campaignId,{exact:true})).toBeVisible();await expect(page.getByRole('region',{name:'캠페인 사례 근거 탐색',exact:true})).toBeVisible();await expect(rows).toHaveCount(0);
 await filter.fill(selected.campaignId);const scoped=database(selected.campaignId);expect((await request.get('/backend/receipt-history/campaign/'+selected.campaignId)).status()).toBe(401);const filtered=await (await page.request.get('/backend/receipt-history/campaign/'+selected.campaignId)).json();expect(metadata(receiptHistoryPage(filtered,me,selected.campaignId).entries)).toEqual(metadata(scoped.entries));await load.click();await expect(rows).toHaveCount(scoped.entries.length);
 for(const mode of ['foreign','signature-claim','unavailable']){await page.route('**/backend/receipt-history/campaign/'+selected.campaignId,route=>route.fulfill({status:mode==='unavailable'?503:200,contentType:'application/json',body:JSON.stringify(mode==='foreign'?{...filtered,projectId:randomUUID()}:mode==='signature-claim'?{...filtered,signatureVerificationPerformed:true}:{code:'UNAVAILABLE'})}));await load.click();await expect(rows).toHaveCount(0);await expect(region.getByText(/미확인 상태/)).toBeVisible();await page.unroute('**/backend/receipt-history/campaign/'+selected.campaignId);}
 let release!:()=>void;const held=new Promise<void>(resolve=>release=resolve);await page.route('**/backend/receipt-history/campaign/'+selected.campaignId,async route=>{await held;await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(filtered)}).catch(()=>{})});try{await load.click();await region.getByRole('button',{name:'서명 관측 조회 취소',exact:true}).click();release();await page.waitForTimeout(250);await expect(rows).toHaveCount(0);}finally{release();await page.unroute('**/backend/receipt-history/campaign/'+selected.campaignId)}expect(database()).toEqual(before);expect(writes).toBe(0);
 phase('actual project receipt metadata and campaign-filtered API match PostgreSQL id campaign key and exact timestamps; receipt row fingerprint unchanged; anonymous401; no payload or signature validity claim; existing campaign evidence opens with verified versions; foreign and false signature claim and503 clear metadata; cancelled late response discarded;1440 and390; no business writes signing or release authority; real multi-page database traversal not asserted');
});

if(process.env.STACK_E2E_LEGACY_CORE_RETURN!=='true')test('viewer inspects actual campaign child rule evidence only after verifying selected case membership',async({page,request})=>{
 await login(page,'demo-viewer');const rows=await (await page.request.get('/backend/campaigns')).json();let found:(Campaign&{result:unknown})|undefined;
 for(const row of rows){const value=await (await page.request.get('/backend/campaigns/'+row.id)).json();if(value.agentVersion.definition.provider==='synthetic'&&value.cases.some((c:{state:string})=>c.state!=='queued')){found=value;break}}if(!found)throw Error('Existing completed child unavailable');const record=found;
 const selected=record.cases.find((c:{state:string})=>c.state!=='queued')! ,parentPath='/backend/campaigns/'+record.id,childPath='/backend/runs/'+selected.runId;expect((await request.get(parentPath)).status()).toBe(401);expect((await request.get(childPath)).status()).toBe(401);const child=await (await page.request.get(childPath)).json();expect(child.provider).toBe(selected.provider);expect(child.scenario).toBe(selected.scenario);expect(child.state).toBe(selected.state);expect(child.decision).toBe(selected.decision);
 let writes=0,childReads=0;page.on('request',r=>{const path=new URL(r.url()).pathname;if(path.startsWith('/backend/')&&r.method()!=='GET')writes++;if(path===childPath)childReads++});await page.getByRole('button',{name:'캠페인 '+record.id.slice(0,8),exact:true}).click();const cases=page.getByRole('region',{name:'캠페인 사례 근거 탐색',exact:true});await cases.getByRole('button',{name:'사례 '+selected.caseId+' 평가 근거 확인',exact:true}).click();const inspector=page.getByRole('region',{name:'선택 사례 평가 근거',exact:true}),load=inspector.getByRole('button',{name:'선택 사례 근거 조회',exact:true}),content=inspector.locator('[data-case-inspection-run]');await expect(content).toHaveCount(0);await load.click();await expect(content).toHaveAttribute('data-case-inspection-run',selected.runId);expect(childReads).toBe(1);
 const table=content.getByRole('table');await expect(table.locator('tbody tr')).toHaveCount(child.result.rules.length);for(let i=0;i<child.result.rules.length;i++){const cells=table.locator('tbody tr').nth(i).locator('th,td'),rule=child.result.rules[i];await expect(cells.nth(0)).toHaveText(rule.id);await expect(cells.nth(1)).toHaveText(rule.required?'필수':'선택');await expect(cells.nth(3)).toHaveText(rule.reason)}
 for(const width of [1440,390]){await page.setViewportSize({width,height:960});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
 for(const mode of ['foreign','membership','unavailable']){const altered=structuredClone(record);if(mode==='foreign')altered.project_id=randomUUID();if(mode==='membership')altered.cases.find((c:{caseId:string})=>c.caseId===selected.caseId)!.runId=randomUUID();await page.route('**'+parentPath,route=>route.fulfill({status:mode==='unavailable'?503:200,contentType:'application/json',body:JSON.stringify(altered)}));const reads=childReads;await load.click();await expect(inspector.getByText(/근거를 확인하지 못했습니다/)).toBeVisible();await expect(content).toHaveCount(0);expect(childReads).toBe(reads);await page.unroute('**'+parentPath);}
 await page.route('**'+childPath,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...child,id:randomUUID()})}));await load.click();await expect(inspector.getByText(/근거를 확인하지 못했습니다/)).toBeVisible();await expect(content).toHaveCount(0);await page.unroute('**'+childPath);
 await load.click();await expect(content).toHaveCount(1);await cases.getByLabel('사례 식별자 검색',{exact:true}).fill('no-matching-case');await expect(inspector).toHaveCount(0);await cases.getByRole('button',{name:'사례 필터 해제',exact:true}).click();await cases.getByRole('button',{name:'사례 '+selected.caseId+' 평가 근거 확인',exact:true}).click();
 let release!:()=>void;const held=new Promise<void>(resolve=>release=resolve);await page.route('**'+parentPath,async route=>{await held;await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(record)}).catch(()=>{})});try{await load.click();await inspector.getByRole('button',{name:'사례 근거 닫기·취소',exact:true}).click();release();await page.waitForTimeout(250);await expect(content).toHaveCount(0);}finally{release();await page.unroute('**'+parentPath)}expect(writes).toBe(0);
 phase('actual viewer fresh parent version hashes and selected case membership precede child scoped API read; complete rule id required reason match actual child, both anonymous401, foreign and changed membership and503 prevent child fetch, substituted child ID rejected, filters clear evidence, cancelled late response discarded,1440 and390, no business writes or release authority');
});

if(process.env.STACK_E2E_LEGACY_CORE_RETURN!=='true')test('viewer reads whole project evaluation observations without admission or release authority',async({page,request})=>{
 await login(page,'demo-viewer');expect((await request.get('/backend/evaluation-overview')).status()).toBe(401);const me=await (await page.request.get('/backend/me')).json();
 const database=()=>JSON.parse(execFileSync(process.platform==='win32'?'python':'python3',[resolve(process.cwd(),'../../scripts/stack-evaluation-overview-db-probe.py'),me.organizationId,me.projectId],{encoding:'utf8',timeout:20000,maxBuffer:4096}));
 const before=database(),response=await page.request.get('/backend/evaluation-overview');expect(response.status()).toBe(200);const value=await response.json();expect(value.contract).toBe('project-evaluation-overview-v1');expect(value.scope).toBe('project');expect(value.organizationId).toBe(me.organizationId);expect(value.projectId).toBe(me.projectId);expect(value.deploymentAuthority).toBe(false);
 for(const key of ['retainedCount','states','decisions'])expect(value[key]).toEqual(before[key]);expect(value.retainedCount).toBe(value.states.queued+value.states.succeeded+value.states.failed);expect(value.retainedCount).toBe(value.decisions.pass+value.decisions.block+value.decisions.inconclusive);expect(value.decisions.inconclusive).toBeGreaterThanOrEqual(value.states.queued+value.states.failed);expect(value).not.toHaveProperty('limit');expect(value).not.toHaveProperty('remaining');
 let writes=0;page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/backend/')&&r.method()!=='GET')writes++});const region=page.getByRole('region',{name:'프로젝트 전체 평가 현황',exact:true}),load=region.getByRole('button',{name:'전체 평가 현황 조회',exact:true}),counts=region.locator('[data-overview-count]');await expect(counts).toHaveCount(0);await expect(region.getByText(/미확인 상태/)).toBeVisible();await load.click();await expect(counts).toHaveCount(7);await expect(region.locator('[data-overview-count="retained"]')).toHaveText('전체 보관 평가 '+before.retainedCount+'건');
 for(const group of ['states','decisions'])for(const key of Object.keys(before[group]))await expect(region.locator('[data-overview-count="'+key+'"]').first()).toContainText(before[group][key]+'건');
 for(const width of [1440,390]){await page.setViewportSize({width,height:960});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
 for(const mode of ['foreign','bad-total','unavailable']){await page.route('**/backend/evaluation-overview',route=>route.fulfill({status:mode==='unavailable'?503:200,contentType:'application/json',body:JSON.stringify(mode==='foreign'?{...value,projectId:randomUUID()}:mode==='bad-total'?{...value,retainedCount:value.retainedCount+1}:{code:'UNAVAILABLE'})}));await load.click();await expect(counts).toHaveCount(0);await expect(region.getByText(/미확인 상태/)).toBeVisible();await page.unroute('**/backend/evaluation-overview');}
 let release!:()=>void;const held=new Promise<void>(resolve=>release=resolve);await page.route('**/backend/evaluation-overview',async route=>{await held;await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value)}).catch(()=>{})});try{await load.click();await region.getByRole('button',{name:'전체 평가 조회 취소',exact:true}).click();release();await page.waitForTimeout(250);await expect(counts).toHaveCount(0);}finally{release();await page.unroute('**/backend/evaluation-overview')}
 expect(writes).toBe(0);const after=database();expect(after).toEqual(before);phase('whole project effective states and decisions match scoped PostgreSQL aggregates, totals consistent, anonymous401, no invented limit or release authority, initial and foreign and bad total and503 unknown, cancelled late response discarded,1440 and390, original run row fingerprints unchanged and no business writes');
});

if(process.env.STACK_E2E_LEGACY_CORE_RETURN!=='true')test('viewer reads actual project version capacity without reserving space or changing retained versions',async({page,request})=>{
 await login(page,'demo-viewer');expect((await request.get('/backend/version-capacity')).status()).toBe(401);const me=await (await page.request.get('/backend/me')).json();
 const database=()=>JSON.parse(execFileSync(process.platform==='win32'?'python':'python3',[resolve(process.cwd(),'../../scripts/stack-version-capacity-db-probe.py'),me.organizationId,me.projectId],{encoding:'utf8',timeout:20000,maxBuffer:4096}));
 const before=database(),response=await page.request.get('/backend/version-capacity');expect(response.status()).toBe(200);const value=await response.json();expect(value.organizationId).toBe(me.organizationId);expect(value.projectId).toBe(me.projectId);expect(value.scope).toBe('project');expect(value.reservationGranted).toBe(false);expect(value.deploymentAuthority).toBe(false);
 for(const kind of ['agents','datasets']){expect(value[kind].used).toBe(before[kind].used);expect(value[kind].limit).toBe(200);expect(value[kind].remaining).toBe(Math.max(0,200-before[kind].used));}
 let writes=0;page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/backend/')&&r.method()!=='GET')writes++});const region=page.getByRole('region',{name:'프로젝트 버전 등록 용량',exact:true}),load=region.getByRole('button',{name:'프로젝트 버전 용량 조회',exact:true});await load.click();await expect(region.locator('[data-version-capacity-kind]')).toHaveCount(2);
 for(const kind of ['agents','datasets'])await expect(region.locator('[data-version-capacity-kind="'+kind+'"]')).toContainText('보관 '+before[kind].used+' / 200개');
 for(const width of [1440,390]){await page.setViewportSize({width,height:960});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
 for(const mode of ['foreign','unavailable']){await page.route('**/backend/version-capacity',route=>route.fulfill({status:mode==='unavailable'?503:200,contentType:'application/json',body:JSON.stringify(mode==='foreign'?{...value,projectId:randomUUID()}:{code:'UNAVAILABLE'})}));await load.click();await expect(region.locator('[data-version-capacity-kind]')).toHaveCount(0);await expect(region.getByText(/미확인 상태/)).toBeVisible();await page.unroute('**/backend/version-capacity');}
 expect(writes).toBe(0);expect(database()).toEqual(before);phase('actual viewer capacity matches scoped PostgreSQL counts including retained versions, anonymous401,200 per kind, remaining arithmetic, no reservation or authority, foreign503 clear counts to unknown,1440 and390, version row fingerprints unchanged and no business writes');
});

if(process.env.STACK_E2E_LEGACY_CORE_RETURN!=='true')test('viewer saves only the exact selected completed evaluation observation JSON without release authority',async({page,request})=>{
 await login(page,'demo-viewer');const {record,me}=await existingSyntheticEvaluation(page);const path='/backend/runs/'+record.id;expect((await request.get(path)).status()).toBe(401);
 await page.locator('.runs li button').filter({hasText:record.id.slice(0,8)}).click();const region=page.getByRole('region',{name:'완료 평가 결과 JSON 저장',exact:true});await expect(region).toBeVisible();const save=region.getByRole('button',{name:'완료 평가 결과 JSON 저장',exact:true});
 let writes=0,downloads=0;page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/backend/')&&r.method()!=='GET')writes++});page.on('download',()=>downloads++);
 const transfer=page.waitForEvent('download');await save.click();const file=await transfer;expect(file.suggestedFilename()).toBe('agenttrust-observation-'+record.id+'.json');const saved=JSON.parse(readFileSync((await file.path())!,'utf8'));expect(saved.observation).toEqual(detail(record,me,record.id));expect(saved.deploymentAuthority).toBe(false);expect(saved.signed).toBe(false);expect(saved.currentGateIncluded).toBe(false);expect(saved.historicalEvidenceOnly).toBe(true);expect(downloads).toBe(1);
 await page.route('**'+path,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...record,project_id:randomUUID()})}));await save.click();await expect(region.getByText(/파일을 저장하지 않았습니다/)).toBeVisible();expect(downloads).toBe(1);await page.unroute('**'+path);
 await page.route('**'+path,route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'UNAVAILABLE'})}));await save.click();await expect(region.getByText(/파일을 저장하지 않았습니다/)).toBeVisible();expect(downloads).toBe(1);await page.unroute('**'+path);
 let release!:()=>void;const held=new Promise<void>(resolve=>release=resolve);await page.route('**'+path,async route=>{await held;await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(record)}).catch(()=>{})});try{await save.click();await region.getByRole('button',{name:'결과 JSON 저장 취소',exact:true}).click();release();await page.waitForTimeout(250);expect(downloads).toBe(1);}finally{release();await page.unroute('**'+path)}
 for(const width of [1440,390]){await page.setViewportSize({width,height:960});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}expect(writes).toBe(0);
 phase('actual viewer fresh scoped read downloads exact completed observation JSON only, anonymous401, no current gate or release authority, substituted scope and503 and cancelled late response create no download,1440 and390 no overflow, no business writes');
});

if(process.env.STACK_E2E_LEGACY_CORE_RETURN!=='true')test('viewer inspects complete verified agent and dataset definitions as text without writes',async({page,request})=>{
 await login(page,'demo-viewer');const catalog=await (await page.request.get('/backend/catalog')).json();let writes=0;page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/backend/')&&r.method()!=='GET')writes++});
 const region=page.getByRole('region',{name:'에이전트·데이터셋 통합 카탈로그',exact:true});await region.getByRole('button',{name:'통합 카탈로그 조회',exact:true}).click();await expect(region.locator('[data-catalog-version-id]').first()).toBeVisible();
 for(const kind of ['agents','datasets']){
  const row=catalog[kind].entries[0],path='/backend/versions/'+kind+'/'+row.id;expect((await request.get(path)).status()).toBe(401);const stored=await (await page.request.get(path)).json();
  if(kind==='agents')expect(stored.definition.executionProfile).toBeTruthy();else expect(stored.definition.cases.length).toBeGreaterThan(0);
  await region.getByLabel('카탈로그 종류',{exact:true}).selectOption(kind);await region.locator('[data-catalog-version-id="'+row.id+'"]').getByRole('button').click();
  const inspector=region.getByRole('region',{name:'검증된 불변 버전 정의',exact:true}),json=inspector.getByLabel('고정 버전 정의 JSON',{exact:true});await expect(inspector).toBeVisible();await expect(json).toHaveCount(0);
  await inspector.getByRole('button',{name:'고정 정의 펼치기',exact:true}).click();await expect(json).toBeVisible();expect(JSON.parse((await json.textContent())!)).toEqual(stored.definition);
  for(const width of [1440,390]){await page.setViewportSize({width,height:960});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
  await inspector.getByRole('button',{name:'고정 정의 접기',exact:true}).click();await expect(json).toHaveCount(0);await inspector.getByRole('button',{name:'고정 정의 펼치기',exact:true}).click();
  await region.getByLabel('카탈로그 이름 검색',{exact:true}).fill('no-definition-match');await expect(inspector).toHaveCount(0);await region.getByLabel('카탈로그 이름 검색',{exact:true}).fill('');
  await page.route('**'+path,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...stored,content_sha256:'0'.repeat(64)})}));await region.locator('[data-catalog-version-id="'+row.id+'"]').getByRole('button').click();await expect(region.getByText(/버전 내용과 해시를 확인하지 못했습니다/)).toBeVisible();await expect(inspector).toHaveCount(0);await page.unroute('**'+path);
 }
 expect(writes).toBe(0);phase('actual viewer agent profile and dataset complete definitions match stored API content, anonymous401, explicit text expansion and collapse, filter reset, invalid hash clears definition,1440 and390 no overflow, no business writes');
});

if(process.env.STACK_E2E_LEGACY_CORE_RETURN!=='true')test('viewer browses the actual scoped agent dataset catalog and verifies immutable details',async({page,request})=>{
 await login(page,'demo-viewer');
 expect((await request.get('/backend/catalog')).status()).toBe(401);
 const response=await page.request.get('/backend/catalog');expect(response.status()).toBe(200);const catalog=await response.json();
 const identity=await (await page.request.get('/backend/me')).json();expect(catalog.projectId).toBe(identity.projectId);expect(catalog.organizationId).toBe(identity.organizationId);expect(catalog.deploymentAuthority).toBe(false);
 for(const kind of ['agents','datasets']){expect(catalog[kind].kind).toBe(kind);expect(catalog[kind].limit).toBe(25);expect(catalog[kind].entries.length).toBeGreaterThan(0);expect(catalog[kind].entries.length).toBeLessThanOrEqual(25);}
 let writes=0;page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/backend/')&&r.method()!=='GET')writes++});
 const region=page.getByRole('region',{name:'에이전트·데이터셋 통합 카탈로그',exact:true});
 await region.getByRole('button',{name:'통합 카탈로그 조회',exact:true}).click();await expect(region.locator('[data-catalog-version-id]')).toHaveCount(catalog.agents.entries.length+catalog.datasets.entries.length);
 for(const kind of ['agents','datasets']){
  const row=catalog[kind].entries[0];await region.getByLabel('카탈로그 종류',{exact:true}).selectOption(kind);await region.getByLabel('카탈로그 이름 검색',{exact:true}).fill(row.resourceKey);
  const entry=region.locator('[data-catalog-version-id="'+row.id+'"]');await entry.getByRole('button').click();
  const detail=region.getByRole('region',{name:'카탈로그 검증 상세',exact:true});await expect(detail).toBeVisible();await expect(detail.getByText('SHA-256 '+row.contentSha256,{exact:true})).toBeVisible();
  for(const width of [1440,390]){await page.setViewportSize({width,height:960});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
  await region.getByLabel('카탈로그 이름 검색',{exact:true}).fill('no-matching-fixture-version');await expect(detail).toHaveCount(0);await expect(region.locator('[data-catalog-version-id]')).toHaveCount(0);await region.getByLabel('카탈로그 이름 검색',{exact:true}).fill('');
 }
 await page.route('**/backend/catalog',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...catalog,datasets:{...catalog.datasets,projectId:randomUUID()}})}));
 await region.getByRole('button',{name:'통합 카탈로그 조회',exact:true}).click();await expect(region.locator('[data-catalog-version-id]')).toHaveCount(0);await expect(region.getByText(/카탈로그를 확인하지 못했습니다/)).toBeVisible();expect(writes).toBe(0);
 phase('actual catalog API and immutable agent dataset details, viewer and anonymous401, project scopes, bounded25 per kind, filters clear details,1440 and390 no overflow, substituted nested scope rejected, no business writes');
});

if(process.env.STACK_E2E_LEGACY_CORE_RETURN!=='true')test('viewer compares two actual completed evaluations without granting release authority',async({page,request})=>{
 await login(page,'demo-viewer');
 const response=await page.request.get('/backend/runs');expect(response.status()).toBe(200);
 const rows=await response.json() as {id:string;state:string}[],complete=rows.filter(r=>r.state!=='queued');expect(complete.length).toBeGreaterThanOrEqual(2);
 const candidate=complete[0],baseline=complete[1],path='/backend/runs/'+candidate.id+'/comparison/'+baseline.id;
 expect((await request.get(path)).status()).toBe(401);
 const comparison=await page.request.get(path);expect(comparison.status()).toBe(200);const value=await comparison.json();expect(value.deploymentAuthority).toBe(false);expect(value.regressionAuthority).toBe(false);
 let writes=0;page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/backend/')&&r.method()!=='GET')writes++});
 await page.locator('.runs li button').filter({hasText:candidate.id.slice(0,8)}).click();
 const region=page.getByRole('region',{name:'두 평가 결과 비교',exact:true});await region.getByLabel('비교 기준 평가 ID',{exact:true}).fill(baseline.id);
 await region.getByRole('button',{name:'두 평가 비교 실행',exact:true}).click();await expect(region.getByRole('table')).toBeVisible();await expect(region.getByText(/회귀 통과나 배포 허용을 뜻하지 않습니다/)).toBeVisible();
 for(const width of [1440,390]){await page.setViewportSize({width,height:960});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
 await page.route('**'+path,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...value,projectId:randomUUID()})}));
 await region.getByRole('button',{name:'두 평가 비교 실행',exact:true}).click();await expect(region.getByRole('table')).toHaveCount(0);await expect(region.getByText(/비교 결과를 확인하지 못했습니다/)).toBeVisible();expect(writes).toBe(0);
 phase('actual completed run pair, viewer scope, anonymous401, read-only comparison, 1440 and390 no overflow, substituted project rejected, no business writes');
});

if(process.env.STACK_E2E_LEGACY_CORE_RETURN!=='true')test('viewer reads actual recent completion observations using the database anchored window without operating authority',async({page,request})=>{
 await login(page,'demo-viewer');expect((await request.get('/backend/evaluation-recent')).status()).toBe(401);const me=await (await page.request.get('/backend/me')).json();
 const response=await page.request.get('/backend/evaluation-recent');expect(response.status()).toBe(200);const value=await response.json();expect(value.contract).toBe('project-evaluation-recent-v1');expect(value.scope).toBe('project');expect(value.organizationId).toBe(me.organizationId);expect(value.projectId).toBe(me.projectId);expect(value.deploymentAuthority).toBe(false);
 const database=(snapshot:typeof value)=>JSON.parse(execFileSync(process.platform==='win32'?'python':'python3',[resolve(process.cwd(),'../../scripts/stack-evaluation-recent-db-probe.py'),me.organizationId,me.projectId,snapshot.windowStart,snapshot.observedAt],{encoding:'utf8',timeout:20000,maxBuffer:4096}));
 const before=database(value);for(const key of ['completedCount','executionErrorCount','unknownCompletionTimeCount'])expect(value[key]).toBe(before[key]);expect(value.executionErrorCount).toBeLessThanOrEqual(value.completedCount);expect(Date.parse(value.observedAt)-Date.parse(value.windowStart)).toBe(86400000);expect(value).not.toHaveProperty('limit');
 let writes=0;page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/backend/')&&r.method()!=='GET')writes++});const region=page.getByRole('region',{name:'최근 24시간 평가 관측',exact:true}),load=region.getByRole('button',{name:'최근 24시간 평가 관측 조회',exact:true}),counts=region.locator('[data-recent-count]');await expect(counts).toHaveCount(0);await expect(region.getByText(/미확인 상태/)).toBeVisible();
 const loaded=page.waitForResponse(r=>new URL(r.url()).pathname==='/backend/evaluation-recent'&&r.status()===200);await load.click();const observed=await (await loaded).json(),actual=database(observed);await expect(counts).toHaveCount(3);
 for(const [field,key,label] of [['completedCount','completed','최근 24시간 완료'],['executionErrorCount','errors','최근 24시간 실행 오류'],['unknownCompletionTimeCount','unknown','전체 보관 평가 중 완료 시각 미상']]){expect(observed[field]).toBe(actual[field]);await expect(region.locator('[data-recent-count="'+key+'"]')).toHaveText(label+' '+actual[field]+'건');}
 await expect(region.getByText(/생성 시각으로 추정하지 않습니다/)).toBeVisible();for(const width of [1440,390]){await page.setViewportSize({width,height:960});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
 for(const mode of ['foreign','bad-count','bad-window','unavailable']){const replacement=mode==='foreign'?{...value,projectId:randomUUID()}:mode==='bad-count'?{...value,executionErrorCount:value.completedCount+1}:mode==='bad-window'?{...value,windowStart:value.observedAt}:{code:'UNAVAILABLE'};await page.route('**/backend/evaluation-recent',route=>route.fulfill({status:mode==='unavailable'?503:200,contentType:'application/json',body:JSON.stringify(replacement)}));await load.click();await expect(counts).toHaveCount(0);await expect(region.getByText(/미확인 상태/)).toBeVisible();await page.unroute('**/backend/evaluation-recent');}
 let release!:()=>void;const held=new Promise<void>(resolve=>release=resolve);await page.route('**/backend/evaluation-recent',async route=>{await held;await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value)}).catch(()=>{})});try{await load.click();await region.getByRole('button',{name:'최근 평가 관측 취소',exact:true}).click();release();await page.waitForTimeout(250);await expect(counts).toHaveCount(0);}finally{release();await page.unroute('**/backend/evaluation-recent')}
 expect(writes).toBe(0);expect(database(value)).toEqual(before);phase('recent completion and execution error observations match PostgreSQL using exact API window, unknown historical completion timestamps separate, anonymous401, foreign count and time substitutions and503 fail closed, cancelled late response discarded,1440 and390, original run fingerprint unchanged, no business writes or operating authority');
});

if(process.env.STACK_E2E_LEGACY_CORE_RETURN!=='true')test('editor prepares a synthetic dataset example and explicitly registers edited fixed cases without changing other drafts',async({page})=>{
 await login(page,'demo-editor');const me=await (await page.request.get('/backend/me')).json(),list=await (await page.request.get('/backend/versions/datasets')).json(),originals=await Promise.all(list.map(async (v:{id:string})=>(await page.request.get('/backend/versions/datasets/'+v.id)).json()));
 const region=page.getByRole('region',{name:'합성 데이터셋 예제 초안',exact:true}),prepare=region.getByRole('button',{name:'합성 예제 초안 준비',exact:true});let posts=0,otherWrites=0;page.on('request',r=>{if(r.method()!=='GET'&&new URL(r.url()).pathname.startsWith('/backend/')){if(new URL(r.url()).pathname==='/backend/versions/datasets')posts++;else otherWrites++}});
 const existing=page.getByLabel('사례 식별자 1',{exact:true});const beforeDraft=await existing.inputValue();await prepare.click();expect(posts).toBe(0);expect(otherWrites).toBe(0);await expect(existing).toHaveValue(beforeDraft);await expect(prepare).toBeDisabled();
 const name=region.getByLabel('예제 데이터셋 이름',{exact:true}),text=region.getByLabel('예제 사례 JSON',{exact:true}),save=region.getByRole('button',{name:'예제에서 수정한 데이터셋 등록',exact:true});const cases=JSON.parse(await text.inputValue());expect(cases.map((c:{scenario:string})=>c.scenario)).toEqual(['pass','block','missing_evidence','error']);cases[0].id='edited-example-case';await text.fill(JSON.stringify(cases));const key='browser-example-'+randomUUID();await name.fill(key);
 const pending=page.waitForResponse(r=>new URL(r.url()).pathname==='/backend/versions/datasets'&&r.request().method()==='POST');await save.click();const response=await pending;expect(response.status()).toBe(200);const created=await response.json();expect(created.organization_id).toBe(me.organizationId);expect(created.project_id).toBe(me.projectId);expect(created.resource_key).toBe(key);expect(created.definition).toEqual({contract:'fixed-scenarios-v1',cases});phase('example registration API returned scoped exact edited definition');await expect(region.getByText(/예제에서 수정한 데이터셋 버전 확인:/)).toBeVisible();expect(await (await page.request.get('/backend/versions/datasets/'+created.id)).json()).toEqual(created);expect(posts).toBe(1);expect(otherWrites).toBe(0);await expect(existing).toHaveValue(beforeDraft);phase('example registration and fresh detail match exact timestamp and content; existing draft preserved');
 const retry=page.waitForResponse(r=>new URL(r.url()).pathname==='/backend/versions/datasets'&&r.request().method()==='POST');await save.click();expect((await (await retry).json()).id).toBe(created.id);await expect(region.getByText(/예제에서 수정한 데이터셋 버전 확인:/)).toBeVisible();cases[0].id='conflict-case';await text.fill(JSON.stringify(cases));const conflict=page.waitForResponse(r=>new URL(r.url()).pathname==='/backend/versions/datasets'&&r.request().method()==='POST');await save.click();expect((await conflict).status()).toBe(409);await expect(region.getByText(/같은 이름·버전에 다른 내용/)).toBeVisible();expect(posts).toBe(3);
 for(const mode of ['foreign','key','hash','unavailable']){await page.route('**/backend/versions/datasets',route=>route.request().method()==='POST'?route.fulfill({status:mode==='unavailable'?503:200,contentType:'application/json',body:JSON.stringify(mode==='foreign'?{...created,project_id:randomUUID()}:mode==='key'?{...created,resource_key:'substituted-key'}:mode==='hash'?{...created,content_sha256:'b'.repeat(64)}:{code:'UNAVAILABLE'})}):route.continue());await save.click();await expect(region.getByText(/등록 응답을 확인하지 못했습니다/)).toBeVisible();await expect(text).toHaveValue(JSON.stringify(cases));await page.unroute('**/backend/versions/datasets');}
 for(const width of [1440,390]){await page.setViewportSize({width,height:960});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
 for(const original of originals)expect(await (await page.request.get('/backend/versions/datasets/'+original.id)).json()).toEqual(original);expect(otherWrites).toBe(0);phase('local example preparation sends no writes and preserves existing draft; actual editor registration binds scoped edited fixed definition and hash, retry same ID, changed content409, foreign coordinate hash503 refused with draft preserved, original versions unchanged, no evaluations reviews signatures or deployment,1440 and390');
});
if(process.env.STACK_E2E_LEGACY_CORE_RETURN!=='true')test('viewer cannot prepare synthetic dataset examples and actual registration stays forbidden',async({page})=>{
 await login(page,'demo-viewer');const region=page.getByRole('region',{name:'합성 데이터셋 예제 초안',exact:true});await expect(region.getByRole('button',{name:'합성 예제 초안 준비',exact:true})).toBeDisabled();await expect(region.getByLabel('예제 사례 JSON',{exact:true})).toHaveCount(0);const csrf=await (await page.request.get('/backend/csrf')).json();expect((await page.request.post('/backend/versions/datasets',{headers:{'X-CSRF-TOKEN':csrf.token,Origin:'http://127.0.0.1:4320'},data:{key:'viewer-example-denied',version:1,evaluationMode:'fixed-scenarios',cases:[{id:'required-pass',scenario:'pass',required:true}]}})).status()).toBe(403);phase('viewer example preparation disabled and actual dataset registration API forbidden403');
});
