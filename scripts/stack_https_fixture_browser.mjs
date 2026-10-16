// Fixed CI-only browser acceptance. Never print credentials, raw errors or URLs.
import {createRequire} from 'node:module';
import {readFileSync,existsSync,mkdirSync,realpathSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {homedir} from 'node:os';
import {isIP} from 'node:net';
import https from 'node:https';

const CONSOLE='https://console.example.com', IDENTITY='https://identity.example.com', ENTERPRISE='https://enterprise.example.net';
const ISSUER=IDENTITY+'/realms/agenttrust';
const allowed=new Set([CONSOLE,IDENTITY,'https://enterprise.example.net']);
let phase='execution-guard';
let caseIndex=0;
const requireCondition=value=>{if(!value)throw Error('SYNTHETIC_HTTPS_BROWSER_UNVERIFIED')};
const isFixedUrl=value=>{try{const u=new URL(value);return allowed.has(u.origin)&&!u.username&&!u.password&&!u.hash}catch{return false}};

async function main(){
 requireCondition(process.platform==='linux'&&process.getuid()!==0&&process.env.CI==='true'&&process.env.GITHUB_ACTIONS==='true');
 requireCondition(process.argv.length===3&&!process.env.DEBUG&&!process.env.PWDEBUG&&!process.env.NODE_DEBUG&&!existsSync(join(homedir(),'.pki/nssdb')));
 const fixture=realpathSync(process.argv[2]);
 requireCondition(/[/]\.local[/]stack-https-identity-[a-f0-9-]{36}$/.test(fixture));
 const config=JSON.parse(readFileSync(join(fixture,'browser.json'),'utf8'));
 requireCondition(Array.isArray(config.accounts)&&config.accounts.length===4&&config.enterpriseManifest?.linkedAccounts?.length===4);
 requireCondition(isIP(config.edgeAddress)===4&&/^172\.(1[6-9]|2\d|3[01])\./.test(config.edgeAddress));
 const ca=join(fixture,'certificates/ca.crt');requireCondition(existsSync(ca));
 const observations=()=>new Promise((resolve,reject)=>{
  const request=https.get(CONSOLE+'/fixture/observations',{ca:readFileSync(ca),rejectUnauthorized:true,
   lookup:(_hostname,options,done)=>options.all?done(null,[{address:config.edgeAddress,family:4}]):done(null,config.edgeAddress,4)},response=>{
    let raw='';response.on('data',chunk=>{raw+=chunk;if(raw.length>16384)request.destroy(Error('BOUNDED_OBSERVATION_REFUSED'))});
    response.on('end',()=>{try{requireCondition(response.statusCode===200);resolve(JSON.parse(raw))}catch(error){reject(error)}});
   });request.setTimeout(5000,()=>request.destroy(Error('BOUNDED_OBSERVATION_TIMEOUT')));request.on('error',reject);
 });
 const root=resolve(fixture,'../..'), load=createRequire(join(root,'apps/console/package.json'));
 requireCondition(typeof process.env.GITHUB_WORKSPACE==='string'&&realpathSync(process.env.GITHUB_WORKSPACE)===root);
 const ownedTemporaryDirectory=join(fixture,'browser-owned-tmp');mkdirSync(ownedTemporaryDirectory,{mode:0o700});
 process.env.TMPDIR=ownedTemporaryDirectory;
 const {chromium,expect}=load('@playwright/test');
 const launch=async(name,trust)=>{
  const xdg=join(fixture,'browser-'+name);mkdirSync(xdg,{mode:0o700});
  const db=join(xdg,'pki/nssdb');mkdirSync(db,{recursive:true,mode:0o700});
  for(const name of ['config','cache'])mkdirSync(join(xdg,name),{mode:0o700});
  execFileSync('certutil',['-N','-d','sql:'+db,'--empty-password'],{stdio:'pipe',timeout:10000});
  if(trust)execFileSync('certutil',['-A','-d','sql:'+db,'-n','owned-ephemeral-fixture-ca','-t','C,,','-i',ca],{stdio:'pipe',timeout:10000});
  const browser=await chromium.launch({headless:true,env:{...process.env,XDG_DATA_HOME:xdg,XDG_CONFIG_HOME:join(xdg,'config'),XDG_CACHE_HOME:join(xdg,'cache')},args:[
   '--host-resolver-rules=MAP console.example.com '+config.edgeAddress+', MAP identity.example.com '+config.edgeAddress+', MAP enterprise.example.net '+config.edgeAddress+', MAP wrong-fixture.invalid '+config.edgeAddress+', MAP * ~NOTFOUND',
   '--no-proxy-server','--disable-quic','--disable-background-networking','--disable-component-update','--disable-domain-reliability']});
  if(Number(browser.version().split('.')[0])<146){await browser.close();requireCondition(false)}
  return browser;
 };
 phase='untrusted-ca-negative-control';
 const initialCounts=await observations();
 let browser=await launch('untrusted',false);
 try{
  const page=await browser.newPage({ignoreHTTPSErrors:false,serviceWorkers:'block'});
  let refused=false;
  try{await page.goto(CONSOLE,{waitUntil:'domcontentloaded',timeout:15000})}catch(error){refused=String(error.message).includes('net::ERR_CERT_AUTHORITY_INVALID')}
  requireCondition(refused);
 }finally{await browser.close()}
 requireCondition(JSON.stringify(await observations())===JSON.stringify(initialCounts));
 phase='trusted-browser-and-hostname-negative-control';
 browser=await launch('trusted',true);
 try{
  const negativeContext=await browser.newContext({ignoreHTTPSErrors:false,serviceWorkers:'block',acceptDownloads:false});
  let refusedOutside=0;
  await negativeContext.route('**/*',route=>{if(isFixedUrl(route.request().url())||new URL(route.request().url()).origin==='https://wrong-fixture.invalid')return route.continue();refusedOutside++;return route.abort('blockedbyclient')});
  try{
   const page=await negativeContext.newPage();let refused=false;
   try{await page.goto('https://wrong-fixture.invalid',{waitUntil:'domcontentloaded',timeout:15000})}catch(error){refused=String(error.message).includes('net::ERR_CERT_COMMON_NAME_INVALID')}
   requireCondition(refused);
   let blocked=false;
   try{await page.goto('https://outside-fixture.invalid/public-control',{waitUntil:'domcontentloaded',timeout:15000})}catch(error){blocked=String(error.message).includes('net::ERR_BLOCKED_BY_CLIENT')}
   requireCondition(blocked&&refusedOutside===1);
  }finally{await negativeContext.close()}
  requireCondition(JSON.stringify(await observations())===JSON.stringify(initialCounts));
  const scenarios=[...config.accounts.map(account=>({account,credentials:account,broker:false})),
   ...config.accounts.map(account=>{const link=config.enterpriseManifest.linkedAccounts.find(a=>a.nativeActorId===account.actorId);requireCondition(!!link);return {account,credentials:{username:link.enterpriseUsername,password:link.enterprisePassword},broker:true}})];
  for(const {account,credentials,broker} of scenarios){
   caseIndex++;
   phase=broker?'actual-browser-enterprise-login':'actual-browser-native-login';
   const context=await browser.newContext({ignoreHTTPSErrors:false,serviceWorkers:'block',acceptDownloads:false});
   let outside=0,logged=false,providerOwned=false;
   await context.route('**/*',route=>{if(isFixedUrl(route.request().url()))return route.continue();outside++;return route.abort('blockedbyclient')});
   const page=await context.newPage();
   const api=async path=>page.evaluate(async path=>{const response=await fetch('/backend/'+path,{redirect:'error'});return {status:response.status,body:await response.json()}},path);
   try{
    await page.goto(CONSOLE,{waitUntil:'domcontentloaded'});
    await page.getByRole('button',{name:'Keycloak으로 로그인',exact:true}).click();
    await expect(page.locator('#username')).toBeVisible();
    requireCondition(new URL(page.url()).origin===IDENTITY);
    if(broker){await page.locator('#social-enterprise').click();await page.waitForURL(url=>url.origin===ENTERPRISE);await expect(page.locator('#username')).toBeVisible()}
    requireCondition(new URL(page.url()).origin===(broker?ENTERPRISE:IDENTITY));
    await page.locator('#username').fill(credentials.username);await page.locator('#password').fill(credentials.password);
    providerOwned=true;await page.locator('#kc-login').click();await page.waitForURL(CONSOLE+'/');
    await expect(page.getByRole('button',{name:'로그아웃',exact:true})).toBeVisible();logged=true;
    const me=await api('me');requireCondition(me.status===200&&['actorId','organizationId','projectId','role'].every(k=>me.body[k]===account[k]));
    const cookies=(await context.cookies(CONSOLE)).filter(c=>c.name==='AGENTTRUST_STACK_SESSION');
    requireCondition(cookies.length===1&&cookies[0].secure&&cookies[0].httpOnly&&cookies[0].sameSite==='Lax'&&cookies[0].domain==='console.example.com'&&cookies[0].path==='/');
    phase='actual-browser-scope-and-viewer-control';
    const own=await api('runs/'+account.ownedRunId);requireCondition(own.status===200&&own.body.id===account.ownedRunId);
    const foreign=config.accounts.find(a=>a.organizationId!==account.organizationId);
    requireCondition((await api('runs/'+foreign.ownedRunId)).status===404);
    if(account.role==='viewer'){
     await expect(page.getByRole('button',{name:'평가 실행',exact:true})).toBeDisabled();
     const csrf=await api('csrf');requireCondition(csrf.status===200&&typeof csrf.body.token==='string');
     const status=await page.evaluate(async token=>(await fetch('/backend/runs',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-TOKEN':token,'Idempotency-Key':'synthetic-browser-viewer-refusal-0001'},body:JSON.stringify({scenario:'pass',requiresApproval:true,provider:'synthetic'}),redirect:'error'})).status,csrf.body.token);
   requireCondition(status===403);
    }
    phase='actual-browser-logout';
    await page.getByRole('button',{name:'로그아웃',exact:true}).click();
    await page.waitForURL(url=>url.origin===IDENTITY);
    requireCondition(new URL(page.url()).pathname==='/realms/agenttrust/protocol/openid-connect/logout');
    await page.locator('#kc-logout').click();await page.waitForURL(CONSOLE+'/');
    await expect(page.getByRole('button',{name:'Keycloak으로 로그인',exact:true})).toBeVisible();
    requireCondition((await api('me')).status===401);logged=false;providerOwned=false;
    requireCondition(outside===0);
   }finally{
    // Cleanup on failure must never be reported as a successful logout test.
    if(logged){try{const token=(await api('csrf')).body.token;await page.evaluate(async token=>{await fetch('/backend/logout',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-TOKEN':token},body:'{}'})},token)}catch{}}
    if(providerOwned){try{await page.goto(ISSUER+'/protocol/openid-connect/logout?client_id=agenttrust-console&post_logout_redirect_uri='+encodeURIComponent(CONSOLE+'/'));if(new URL(page.url()).origin===IDENTITY)await page.locator('#kc-logout').click()}catch{}}
    await context.close();
   }
  }
  phase='actual-browser-unlinked-enterprise-refusal';
  caseIndex=9;
  const context=await browser.newContext({ignoreHTTPSErrors:false,serviceWorkers:'block',acceptDownloads:false});
  let refused=false,outside=0,externalOwned=false;
  await context.route('**/*',route=>{if(isFixedUrl(route.request().url()))return route.continue();outside++;return route.abort('blockedbyclient')});
  context.on('response',response=>{const u=new URL(response.url());if(response.request().isNavigationRequest()&&u.origin===IDENTITY&&['/realms/agenttrust/broker/enterprise/endpoint','/realms/agenttrust/login-actions/first-broker-login'].includes(u.pathname)&&response.status()===401)refused=true});
  const page=await context.newPage(),unknown=config.enterpriseManifest.unlinkedAccount;
  try{
   await page.goto(CONSOLE,{waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'Keycloak으로 로그인',exact:true}).click();
   await page.locator('#social-enterprise').click();await page.waitForURL(url=>url.origin===ENTERPRISE);
   await page.locator('#username').fill(unknown.username);await page.locator('#password').fill(unknown.password);
   externalOwned=true;await page.locator('#kc-login').click();await page.waitForURL(url=>url.origin===IDENTITY);
   requireCondition(refused);
   await page.goto(CONSOLE,{waitUntil:'domcontentloaded'});
   await expect(page.getByRole('button',{name:'Keycloak으로 로그인',exact:true})).toBeVisible();
   requireCondition(await page.evaluate(async()=>(await fetch('/backend/me',{redirect:'error'})).status)===401);
   requireCondition(outside===0);
   phase='unlinked-external-session-cleanup';
   await page.goto(ENTERPRISE+'/realms/enterprise-synthetic/protocol/openid-connect/logout?client_id=agenttrust-enterprise-bridge&post_logout_redirect_uri='+encodeURIComponent(IDENTITY+'/realms/agenttrust/broker/enterprise/endpoint/logout_response'));
   await page.locator('#kc-logout').click();await page.waitForURL(url=>url.origin===IDENTITY);externalOwned=false;
  }finally{
   // All server sessions and native identity state are independently checked
   // after this process. Context closure alone cannot establish SSO logout.
   if(externalOwned){try{await page.goto(ENTERPRISE+'/realms/enterprise-synthetic/protocol/openid-connect/logout?client_id=agenttrust-enterprise-bridge');await page.locator('#kc-logout').click()}catch{}}
   await context.close();
  }
 }finally{await browser.close()}
 return {completed:true,actualChromiumTlsLoginVerified:true,nativeAccountsVerified:4,linkedEnterpriseBrowserLogins:4,
  unlinkedEnterpriseBrowserLoginRefused:true,certificateVerificationDisabled:false,untrustedCaAndWrongHostRefused:true,
  outsideFixtureNavigationBlockedBeforeNetwork:true,allEightApplicationSessionsLoggedOut:true,
  hostTrustStoreChanged:false,enterpriseBrowserVerified:true,productionDeploymentPerformed:false};
}
try{console.log(JSON.stringify(await main()))}catch(error){
 const failureLines=[...String(error?.stack??'').matchAll(/stack_https_fixture_browser\.mjs:(\d+):\d+/g)].slice(0,8).map(value=>Number(value[1])).filter(value=>Number.isInteger(value)&&value>0&&value<=20000);
 console.log(JSON.stringify({completed:false,code:'SYNTHETIC_HTTPS_BROWSER_UNVERIFIED',phase,caseIndex,errorType:error?.name==='TimeoutError'?'TimeoutError':'Error',failureLines}));process.exitCode=1;
}
