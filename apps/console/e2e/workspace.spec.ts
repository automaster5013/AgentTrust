import {test,expect,type Page} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';import {resolve} from 'node:path';
const users=JSON.parse(readFileSync(resolve(process.cwd(),'../../.local/stack/demo-credentials.json'),'utf-8')) as {username:string;password:string;organizationId:string}[];
function phase(description:string){test.info().annotations.push({type:'phase',description})}
async function login(page:Page,name:string){
 await page.route('**/*',route=>{const url=new URL(route.request().url());if(['http://127.0.0.1:4320','http://127.0.0.1:4322'].includes(url.origin))return route.continue();return route.abort()});
 await page.goto('/');const info=await (await page.request.get('/backend/auth-info')).json();
 const user=users.find(u=>u.username===name)!;
 // Reporter never records invocation arguments, browser traces, cookies or credentials.
 if(info.identityProvider==='keycloak'){await page.getByRole('button',{name:'Keycloak으로 로그인',exact:true}).click();await expect(page.locator('#username')).toBeVisible();await page.evaluate(value=>{document.querySelector<HTMLInputElement>('#username')!.value=value.username;document.querySelector<HTMLInputElement>('#password')!.value=value.password;document.querySelector<HTMLFormElement>('#kc-form-login')!.requestSubmit(document.querySelector<HTMLButtonElement>('#kc-login')!)},{username:user.username,password:user.password});phase('Keycloak authorization code login')}
 else {await expect(page.getByRole('button',{name:'로그인',exact:true})).toBeEnabled();await page.evaluate(value=>{const account=document.querySelector<HTMLInputElement>('input[name="username"]')!,password=document.querySelector<HTMLInputElement>('input[name="password"]')!;account.value=value.username;password.value=value.password;account.form!.requestSubmit()}, {username:user.username,password:user.password})}
 await expect(page.getByRole('button',{name:'로그아웃',exact:true})).toBeVisible();await expect(page.getByText('조직 '+user.organizationId.slice(0,8),{exact:true})).toBeVisible();
}
test.afterEach(async({page})=>{const csrf=await page.request.get('/backend/csrf');const token=(await csrf.json()).token;const logout=await page.request.post('/backend/logout',{headers:{'X-CSRF-TOKEN':token,Origin:'http://127.0.0.1:4320'},data:{}});expect(logout.status()).toBe(200);expect((await page.request.get('/backend/me')).status()).toBe(401);const value=await logout.json();if(value.logoutUrl){expect(value.logoutUrl).toBe('http://127.0.0.1:4322/realms/agenttrust/protocol/openid-connect/logout?client_id=agenttrust-console&post_logout_redirect_uri=http%3A%2F%2F127.0.0.1%3A4320%2F');await page.goto(value.logoutUrl);if(new URL(page.url()).port==='4322'){await page.locator('#kc-logout').click();await page.waitForURL('http://127.0.0.1:4320/')}phase('own identity provider session logged out')}phase('own session logged out')});

test('viewer navigates real older evaluation pages and opens scoped evidence',async({page})=>{
 await login(page,'demo-viewer');
 const region=page.getByRole('region',{name:'프로젝트 평가 이력',exact:true});
 await region.getByRole('button',{name:'최신 평가 이력 조회',exact:true}).click();
 await expect(region.locator('[data-run-history-id]')).toHaveCount(25);
 const first=await region.locator('[data-run-history-id]').evaluateAll(rows=>rows.map(row=>row.getAttribute('data-run-history-id')));
 expect(first.length).toBe(25);
 await region.getByRole('button',{name:'다음 평가 페이지',exact:true}).click();
 await expect(region.getByText(/이력 페이지 2/)).toBeVisible();
 const older=await region.locator('[data-run-history-id]').evaluateAll(rows=>rows.map(row=>row.getAttribute('data-run-history-id')));
 expect(older.length).toBeGreaterThan(0);expect(older.some(id=>first.includes(id))).toBe(false);
 await region.getByRole('button',{name:'평가 근거 '+older[0]!.slice(0,8),exact:true}).click();
 await expect(page.locator('.evidence').getByText('실행 '+older[0],{exact:true})).toBeVisible();
 await region.getByRole('button',{name:'이전 평가 페이지',exact:true}).click();
 await expect(region.getByText(/이력 페이지 1/)).toBeVisible();
 expect(await region.locator('[data-run-history-id]').evaluateAll(rows=>rows.map(row=>row.getAttribute('data-run-history-id')))).toEqual(first);
  const snapshot=await (await page.request.get('/backend/run-history')).json();
  await page.route('**/backend/run-history',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...snapshot,projectId:'ffffffff-ffff-4fff-8fff-ffffffffffff'})}));
  await region.getByRole('button',{name:'최신 평가 이력 조회',exact:true}).click();
  await expect(region.getByText('평가 이력을 확인하지 못했습니다. 다시 조회해 주세요.',{exact:true})).toBeVisible();
  await expect(region.locator('[data-run-history-id]')).toHaveCount(0);
 phase('actual read-only browser history returns distinct pages and opens the selected existing evaluation');
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
 await page.getByLabel('합성 시나리오',{exact:true}).selectOption('block');await page.getByRole('button',{name:'평가 실행',exact:true}).click();await expect(page.locator('.evidence .badge.block')).toBeVisible({timeout:20000});await expect(page.getByRole('heading',{name:'관리자 검토',exact:true})).toHaveCount(0);await expect(page.getByText('릴리스 허용 안 됨',{exact:true})).toBeVisible();
});

test('viewer can read own evidence and cannot create evaluations',async({page})=>{
 await login(page,'demo-viewer');await expect(page.getByRole('button',{name:'평가 실행',exact:true})).toBeDisabled();await page.locator('.runs li button').first().click();await expect(page.getByRole('heading',{name:'평가 근거',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'관리자 검토',exact:true})).toHaveCount(0);
});

test('administrator fixes versions, runs a campaign and reviews the aggregate gate',async({page})=>{
 await login(page,'demo-admin');const region=page.getByRole('region',{name:'버전과 평가 캠페인',exact:true}),suffix=Date.now().toString(36);
 await region.getByLabel('에이전트 이름',{exact:true}).fill('browser-agent-'+suffix);await region.getByRole('button',{name:'에이전트 버전 고정',exact:true}).click();phase('agent registration submitted');await expect(region.getByRole('status')).toContainText('고정 버전 확인: browser-agent-'+suffix);
 phase('agent version confirmed');await region.getByLabel('데이터셋 이름',{exact:true}).fill('browser-data-'+suffix);await region.getByRole('button',{name:'사례 추가',exact:true}).click();phase('second case added');await region.getByLabel('사례 시나리오 2',{exact:true}).selectOption('block');await region.getByLabel('사례 2 필수',{exact:true}).uncheck();await region.getByRole('button',{name:'데이터셋 버전 고정',exact:true}).click();phase('dataset registration submitted');await expect(region.getByRole('status')).toContainText('고정 버전 확인: browser-data-'+suffix);
 const agents=await (await page.request.get('/backend/versions/agents')).json() as {id:string;resource_key:string}[],datasets=await (await page.request.get('/backend/versions/datasets')).json() as {id:string;resource_key:string}[];
 await region.getByLabel('캠페인 에이전트 버전',{exact:true}).selectOption(agents.find(v=>v.resource_key==='browser-agent-'+suffix)!.id);await region.getByLabel('캠페인 데이터셋 버전',{exact:true}).selectOption(datasets.find(v=>v.resource_key==='browser-data-'+suffix)!.id);
 await region.getByRole('button',{name:'캠페인 실행',exact:true}).click();await expect(region.getByRole('heading',{name:'캠페인 관리자 검토',exact:true})).toBeVisible({timeout:20000});await expect(region.getByText('캠페인 릴리스 허용 안 됨',{exact:true})).toBeVisible();const first=(await region.locator('.mono').first().textContent())!.replace('캠페인 ','');await expect(region.getByText(/실행 프로필 SHA-256 [a-f0-9]{64}/)).toBeVisible();phase('actual installed evaluator profile bound to agent version');phase('version bound case evidence completed');let archiveHash='';await expect.poll(async()=>{const response=await page.request.get('/backend/campaigns/'+first+'/evidence');if(response.status()===200){archiveHash=(await response.json()).contentSha256;return true}expect(response.status()).toBe(409);return false},{timeout:30000}).toBe(true);await region.getByRole('button',{name:'캠페인 보관 근거 확인',exact:true}).click();await expect(region.getByText('캠페인과 2개 사례의 브라우저 바이트 해시 검증 완료',{exact:true})).toBeVisible();phase('browser verifies frozen parent and both child archive bytes');
 await region.getByLabel('캠페인 검토 사유',{exact:true}).fill('Version-bound browser approval');await region.getByRole('button',{name:'캠페인 검토 저장',exact:true}).click();await expect(region.getByText('캠페인 릴리스 허용',{exact:true})).toBeVisible();await region.getByLabel('서명 기록 메모',{exact:true}).fill('Historical browser approval');await region.getByRole('button',{name:'현재 판정의 서명 기록 저장',exact:true}).click();await expect(region.getByText('브라우저 Ed25519 서명 검증 완료 · 개발용 공개키',{exact:true})).toBeVisible();const historical=(await (await page.request.get('/backend/campaigns/'+first+'/receipts')).json())[0].id;phase('browser verifies actual Ed25519 historical approval');await region.getByLabel('캠페인 검토 결정',{exact:true}).selectOption('rejected');await region.getByRole('button',{name:'캠페인 검토 저장',exact:true}).click();await expect(region.getByText('캠페인 릴리스 허용 안 됨',{exact:true})).toBeVisible();phase('parent approval and latest rejection verified');await region.getByRole('button',{name:'서명 기록 '+historical.slice(0,8)+' 검증',exact:true}).click();await expect(region.getByText('브라우저 Ed25519 서명 검증 완료 · 개발용 공개키',{exact:true})).toBeVisible();await expect(region.getByText('캠페인 릴리스 허용 안 됨',{exact:true})).toBeVisible();await expect(region.getByText(/당시 판정 통과 · 당시 허용 예/)).toBeVisible();phase('old passing signature does not override current rejection');const downloadEvent=page.waitForEvent('download');await region.getByRole('button',{name:'검증된 서명·근거 번들 다운로드',exact:true}).click();const download=await downloadEvent;expect(await download.failure()).toBeNull();const stream=await download.createReadStream();expect(stream).not.toBeNull();let bytes=Buffer.alloc(0);for await(const chunk of stream!){bytes=Buffer.concat([bytes,chunk]);expect(bytes.length).toBeLessThanOrEqual(524288)}const bundle=JSON.parse(bytes.toString('utf8'));expect(bundle.kind).toBe('campaign-observation-bundle');expect(bundle.currentDeploymentAuthority).toBe(false);expect(bundle.receipt.receiptId).toBe(historical);expect(bundle.children.length).toBe(2);await expect(region.getByText('캠페인 릴리스 허용 안 됨',{exact:true})).toBeVisible();phase('browser exports verified signed parent and all child bytes while current rejection remains denied');let unexpectedDownload=false;const noteDownload=()=>{unexpectedDownload=true};page.on('download',noteDownload);try{const altered=structuredClone(bundle);altered.children[0].archive.contentBase64=Buffer.from('altered archive bytes').toString('base64');await page.route('**/backend/campaigns/'+first+'/receipts/'+historical+'/bundle',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(altered)}));await region.getByRole('button',{name:'검증된 서명·근거 번들 다운로드',exact:true}).click();await expect(region.getByRole('status')).toContainText('서명과 모든 보관 바이트의 연결을 검증하지 못해 번들을 내보내지 않았습니다.');expect(unexpectedDownload).toBe(false);phase('browser refuses altered child archive before creating a download')}finally{page.off('download',noteDownload)}expect((await (await page.request.get('/backend/campaigns/'+first+'/evidence')).json()).contentSha256).toBe(archiveHash);
 await region.getByRole('button',{name:'캠페인 실행',exact:true}).click();await expect(region.getByRole('heading',{name:'캠페인 관리자 검토',exact:true})).toBeVisible({timeout:20000});await region.getByLabel('비교 기준 캠페인',{exact:true}).selectOption(first);await region.getByRole('button',{name:'캠페인 회귀 비교',exact:true}).click();await expect(region.getByText('비교 결과 no-regression',{exact:true})).toBeVisible();phase('same dataset comparison remains advisory');await expect(region.getByText('브라우저 Ed25519 서명 검증 완료 · 개발용 공개키',{exact:true})).toHaveCount(0);phase('new selection clears historical proof');
});

test('campaign response with substituted immutable content cannot display evidence or permission',async({page})=>{
 await login(page,'demo-admin');const region=page.getByRole('region',{name:'버전과 평가 캠페인',exact:true}),rows=await (await page.request.get('/backend/campaigns')).json() as {id:string}[];expect(rows.length).toBeGreaterThan(0);const id=rows[0].id,evidence=await (await page.request.get('/backend/campaigns/'+id)).json();
 await page.route('**/backend/campaigns/'+id,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...evidence,agentVersion:{...evidence.agentVersion,definition:{...evidence.agentVersion.definition,description:'substituted content'}}})}));await region.getByRole('button',{name:'캠페인 '+id.slice(0,8),exact:true}).click();await expect(region.getByRole('status')).toContainText('버전과 평가 근거의 연결을 확인하지 못했습니다.');await expect(region.getByRole('heading',{name:'캠페인 평가 근거',exact:true})).toHaveCount(0);await expect(region.getByText('캠페인 릴리스 허용',{exact:true})).toHaveCount(0);phase('actual canonical version hash rejects substituted campaign content');
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
 const running=execFileSync('docker',['inspect',worker,'--format','{{.State.Running}}'],{encoding:'utf8',timeout:15000}).trim();expect(running).toBe('true');
 try{
  execFileSync('docker',['stop','--time','10',worker],{timeout:25000});
  await page.getByRole('button',{name:'평가 실행',exact:true}).click();
  await expect(page.getByLabel('평가 취소 사유',{exact:true})).toBeVisible();
  await page.getByLabel('평가 취소 사유',{exact:true}).fill('Browser synthetic cancellation');
  await page.getByRole('button',{name:'평가 취소',exact:true}).click();
  await expect(page.getByText('평가 취소 결과를 확인했습니다.',{exact:true})).toBeVisible();
  await expect(page.locator('.evidence').getByText(/실행 엔진 java-cancelled/)).toBeVisible();
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
 }finally{execFileSync('docker',['start',worker],{timeout:25000});phase('dedicated worker restored');}
});
