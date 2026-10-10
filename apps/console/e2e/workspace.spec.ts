import {test,expect,type Page} from '@playwright/test';
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

test('administrator creates evaluation, approves, rejects and cannot override required failure',async({page})=>{
 await login(page,'demo-admin');phase('authenticated');await page.getByRole('button',{name:'평가 실행',exact:true}).click();phase('evaluation submitted');
 await expect(page.getByRole('heading',{name:'관리자 검토',exact:true})).toBeVisible({timeout:20000});phase('worker completed');await expect(page.getByText('릴리스 허용 안 됨',{exact:true})).toBeVisible();
 await page.getByLabel('검토 사유',{exact:true}).fill('Synthetic browser approval');await page.getByRole('button',{name:'검토 저장·게이트 확인',exact:true}).click();await expect(page.getByText('합성 릴리스 허용',{exact:true})).toBeVisible();phase('approval allows');
 await page.getByLabel('결정',{exact:true}).selectOption('rejected');await page.getByRole('button',{name:'검토 저장·게이트 확인',exact:true}).click();await expect(page.getByText('릴리스 허용 안 됨',{exact:true})).toBeVisible();phase('rejection denies');
 await page.getByLabel('합성 시나리오',{exact:true}).selectOption('block');await page.getByRole('button',{name:'평가 실행',exact:true}).click();await expect(page.locator('.evidence .badge.block')).toBeVisible({timeout:20000});await expect(page.getByRole('heading',{name:'관리자 검토',exact:true})).toHaveCount(0);await expect(page.getByText('릴리스 허용 안 됨',{exact:true})).toBeVisible();
});

test('viewer can read own evidence and cannot create evaluations',async({page})=>{
 await login(page,'demo-viewer');await expect(page.getByRole('button',{name:'평가 실행',exact:true})).toBeDisabled();await page.locator('.runs li button').first().click();await expect(page.getByRole('heading',{name:'평가 근거',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'관리자 검토',exact:true})).toHaveCount(0);
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
