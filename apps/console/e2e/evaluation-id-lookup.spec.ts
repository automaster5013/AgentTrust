import {test,expect,type Page} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const users=JSON.parse(readFileSync(resolve(process.cwd(),'../../.local/stack/demo-credentials.json'),'utf-8')) as {username:string;password:string}[];
async function login(page:Page,username:string){
 await page.route('**/*',route=>{const r=route.request(),u=new URL(r.url());if(!['http://127.0.0.1:4320','http://127.0.0.1:4322'].includes(u.origin))return route.abort();if(u.origin==='http://127.0.0.1:4320'&&u.pathname.startsWith('/backend/')&&r.method()!=='GET'&&!['/backend/login','/backend/logout'].includes(u.pathname))return route.abort();return route.continue()});
 await page.goto('/');const response=await page.request.get('/backend/auth-info');expect(response.status()).toBe(200);const info=await response.json(),user=users.find(x=>x.username===username)!;
 if(info.identityProvider==='keycloak'){
  await page.getByRole('button',{name:'Keycloak으로 로그인',exact:true}).click();await expect(page.locator('#username')).toBeVisible();
  await page.evaluate(u=>{document.querySelector<HTMLInputElement>('#username')!.value=u.username;document.querySelector<HTMLInputElement>('#password')!.value=u.password;document.querySelector<HTMLFormElement>('#kc-form-login')!.requestSubmit(document.querySelector<HTMLButtonElement>('#kc-login')!)},user);await page.waitForURL('http://127.0.0.1:4320/');
 }else{await page.evaluate(u=>{const input=document.querySelector<HTMLInputElement>('input[name="username"]')!;input.value=u.username;document.querySelector<HTMLInputElement>('input[name="password"]')!.value=u.password;input.form!.requestSubmit()},user)}
 await expect(page.getByRole('button',{name:'로그아웃',exact:true})).toBeVisible();
}
async function logout(page:Page){
 const csrf=await page.request.get('/backend/csrf');const response=await page.request.post('/backend/logout',{headers:{'X-CSRF-TOKEN':(await csrf.json()).token,Origin:'http://127.0.0.1:4320'},data:{}});expect(response.status()).toBe(200);expect((await page.request.get('/backend/me')).status()).toBe(401);const v=await response.json();if(v.logoutUrl){expect(v.logoutUrl).toBe('http://127.0.0.1:4322/realms/agenttrust/protocol/openid-connect/logout?client_id=agenttrust-console&post_logout_redirect_uri=http%3A%2F%2F127.0.0.1%3A4320%2F');await page.goto(v.logoutUrl);if(new URL(page.url()).port==='4322'){await page.locator('#kc-logout').click();await page.waitForURL('http://127.0.0.1:4320/')}}
}
test('known evaluation ID opens actual evidence without history paging and failed lookup clears old evidence',async({page})=>{
 await login(page,'demo-viewer');try{
  const response=await page.request.get('/backend/runs');expect(response.status()).toBe(200);const rows=await response.json() as {id:string;state:string}[];const own=rows.find(x=>x.state!=='queued')!;expect(own).toBeTruthy();
  const form=page.getByRole('form',{name:'평가 ID로 근거 바로 열기'}),input=form.getByLabel('전체 평가 ID');
  await input.fill('../runs');await form.getByRole('button',{name:'평가 ID로 근거 확인'}).click();await expect(form).toContainText('전체 평가 ID를 입력해 주세요.');
  await input.fill(' '+own.id.toUpperCase()+' ');await form.getByRole('button',{name:'평가 ID로 근거 확인'}).click();await expect(form).toContainText('평가 근거와 현재 게이트를 확인했습니다.');const evidence=page.getByRole('region',{name:'선택한 평가 근거',exact:true});await expect(evidence).toContainText('실행 '+own.id);await expect(evidence).toContainText('현재 릴리스 게이트');
  await page.screenshot({path:test.info().outputPath('evaluation-id-lookup.png'),fullPage:true});
  await page.route('**/backend/runs/'+own.id,route=>route.fulfill({status:503,contentType:'application/json',body:'{}'}));await form.getByRole('button',{name:'평가 ID로 근거 확인'}).click();await expect(form).toContainText('평가를 확인하지 못했습니다.');await expect(evidence).toHaveCount(0);
 }finally{await logout(page)}
});
test('known foreign evaluation ID remains inaccessible and does not leave previously selected evidence',async({page,browser})=>{
 const context=await browser.newContext(),foreign=await context.newPage();let foreignId='';
 try{await login(foreign,'other-admin');try{const response=await foreign.request.get('/backend/runs');expect(response.status()).toBe(200);const rows=await response.json() as {id:string}[];expect(rows.length).toBeGreaterThan(0);foreignId=rows[0].id}finally{await logout(foreign)}}finally{await context.close()}
 await login(page,'demo-viewer');try{const form=page.getByRole('form',{name:'평가 ID로 근거 바로 열기'});await form.getByLabel('전체 평가 ID').fill(foreignId);await form.getByRole('button',{name:'평가 ID로 근거 확인'}).click();await expect(form).toContainText('평가를 확인하지 못했습니다.');await expect(page.getByRole('region',{name:'선택한 평가 근거',exact:true})).toHaveCount(0)}finally{await logout(page)}
});
