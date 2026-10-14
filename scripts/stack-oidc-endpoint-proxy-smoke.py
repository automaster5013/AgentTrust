"""Exercise actual HTTPS-profile Next BFF with isolated synthetic HTTP upstream."""
import datetime,json,pathlib,shutil,subprocess,uuid
ROOT=pathlib.Path(__file__).resolve().parent.parent
LOCAL=ROOT/'.local'
NODE='node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1'
IMAGE='agenttrust-stack-console:oidc-endpoint-https-candidate'
CODE=r"""
import http from 'node:http';import assert from 'node:assert/strict';
if(process.argv[2]==='serve'){
 let mode='normal',count=0;
 http.createServer((q,s)=>{if(q.url==='/fixture/control'){mode=q.headers['x-mode'];s.end();return}if(q.url==='/fixture/count'){s.end(String(count));return}count++;
  if(q.url==='/logout/connect/back-channel/keycloak'){
   assert.equal(q.method,'POST');for(const name of ['cookie','authorization','x-csrf-token','idempotency-key','origin'])assert.equal(q.headers[name],undefined);
   assert.equal(q.headers['content-type'],'application/x-www-form-urlencoded');let body='';q.on('data',chunk=>body+=chunk);q.on('end',()=>{assert.equal(body,'logout_token=aaa.bbb.ccc');s.writeHead(204,{'Set-Cookie':'AGENTTRUST_STACK_SESSION=must-not-forward; Path=/; Secure; HttpOnly; SameSite=Lax','Location':'https://evil.example.com/'});s.end()});return;
  }
  if(q.url.startsWith('/oauth2/authorization')){s.writeHead(302,{Location:mode==='evil'?'https://evil.example.com/realms/agenttrust/protocol/openid-connect/auth':'https://identity.example.com/realms/agenttrust/protocol/openid-connect/auth?state=12345678'});s.end();return}
  if(q.url.startsWith('/login/oauth2/code')){s.writeHead(302,{Location:mode==='evil'?'https://evil.example.com/':'https://console.example.com/'});s.end();return}
  let cookie='AGENTTRUST_STACK_SESSION=fixture; Path=/; HttpOnly'+(mode==='insecure'?'':'; Secure')+'; SameSite=Lax';
  if(mode==='domain')cookie+='; Domain=example.com';
  if(mode==='wrong-path')cookie=cookie.replace('Path=/','Path=/backend');
  if(mode==='same-site-none')cookie=cookie.replace('SameSite=Lax','SameSite=None');
  if(mode==='missing-same-site')cookie=cookie.replace('; SameSite=Lax','');
  if(mode==='duplicate-path')cookie+='; Path=/backend';
  if(mode==='expiry')cookie=cookie.replace('=fixture','=')+'; Max-Age=0';
  s.setHeader('Content-Type','application/json');s.setHeader('Set-Cookie',cookie);s.end(JSON.stringify({authenticated:false}));
 }).listen(8080,'0.0.0.0');
}else{
 const base='http://console:3000',headers={Host:'console.example.com'},checks=[];
 const request=(path,extra={},method='GET',body='{}')=>new Promise((resolve,reject)=>{
  const q=http.request(base+'/backend/'+path,{headers:{...headers,...extra},method},r=>{r.resume();resolve({status:r.statusCode,headers:{get:key=>{const value=r.headers[key.toLowerCase()];return Array.isArray(value)?value.join(', '):value??null}}})});
  q.setTimeout(5000,()=>q.destroy(Error('FIXTURE_REQUEST_TIMEOUT')));q.on('error',reject);q.end(method==='POST'?body:undefined);
 });
 const count=async()=>Number(await(await fetch('http://127.0.0.1:8080/fixture/count')).text());
 const mode=async value=>{await fetch('http://127.0.0.1:8080/fixture/control',{headers:{'X-Mode':value}})};
 for(let i=0;i<60;i++){try{if((await fetch(base,{signal:AbortSignal.timeout(1000)})).ok)break}catch{}if(i===59)throw Error('CONSOLE_NOT_READY');await new Promise(r=>setTimeout(r,1000))}
 let r=await request('oauth2/authorization/keycloak');assert.equal(r.status,302);assert.ok(r.headers.get('location').startsWith('https://identity.example.com/realms/agenttrust/protocol/openid-connect/auth?'));checks.push('pinned-authorization-redirect');
 let n=await count();r=await request('oauth2/authorization/keycloak',{Host:'evil.example.com'});assert.equal(r.status,403);assert.equal(await count(),n);checks.push('foreign-host-before-upstream');
 r=await request('oauth2/authorization/keycloak',{'X-Forwarded-Host':'evil.example.com','X-Forwarded-Proto':'http'});assert.equal(r.status,302);assert.ok(r.headers.get('location').startsWith('https://identity.example.com/'));checks.push('forwarded-headers-cannot-select-origin');
 const query=new URLSearchParams({code:'abcdefgh',state:'12345678',iss:'https://identity.example.com/realms/agenttrust'});r=await request('login/oauth2/code/keycloak?'+query);assert.equal(r.status,302);assert.equal(r.headers.get('location'),'https://console.example.com/');checks.push('pinned-callback-redirect');
 query.set('iss','https://identity.example.com/realms/other');n=await count();r=await request('login/oauth2/code/keycloak?'+query);assert.equal(r.status,502);assert.equal(await count(),n);checks.push('foreign-issuer-before-upstream');
 await mode('evil');r=await request('oauth2/authorization/keycloak');assert.equal(r.status,502);checks.push('foreign-upstream-redirect-refused');await mode('normal');
 for(const origin of ['http://console.example.com','https://evil.example.com','https://user@console.example.com','https://console.example.com/']){n=await count();r=await request('logout',{Origin:origin},'POST');assert.equal(r.status,403);assert.equal(await count(),n)}checks.push('foreign-and-ambiguous-post-origins-before-upstream');
 r=await request('logout',{Origin:'https://console.example.com'},'POST');assert.equal(r.status,200);assert.ok(r.headers.get('set-cookie').includes('Secure'));assert.ok(r.headers.get('set-cookie').includes('HttpOnly'));checks.push('pinned-post-origin-and-secure-cookie');
 await mode('insecure');r=await request('logout',{Origin:'https://console.example.com'},'POST');assert.equal(r.status,502);assert.equal(r.headers.get('set-cookie'),null);checks.push('insecure-upstream-cookie-refused');
 for(const invalid of ['domain','wrong-path','same-site-none','missing-same-site','duplicate-path']){await mode(invalid);r=await request('logout',{Origin:'https://console.example.com'},'POST');assert.equal(r.status,502);assert.equal(r.headers.get('set-cookie'),null);checks.push(invalid+'-upstream-cookie-refused')}
 await mode('expiry');r=await request('logout',{Origin:'https://console.example.com'},'POST');assert.equal(r.status,200);assert.ok(r.headers.get('set-cookie').includes('Max-Age=0'));checks.push('valid-session-expiry-cookie-forwarded');
 r=await request('logout/connect/back-channel/keycloak',{'Content-Type':'application/x-www-form-urlencoded',Cookie:'AGENTTRUST_STACK_SESSION=fixture',Authorization:'Bearer fixture','X-CSRF-TOKEN':'fixture','Idempotency-Key':'fixture'},'POST','logout_token=aaa.bbb.ccc');assert.equal(r.status,204);assert.equal(r.headers.get('set-cookie'),null);assert.equal(r.headers.get('location'),null);checks.push('public-provider-form-strips-browser-credentials-and-upstream-cookies-or-redirects');
 n=await count();r=await request('logout/connect/back-channel/keycloak',{Host:'stack-console:3000','Content-Type':'application/x-www-form-urlencoded'},'POST','logout_token=aaa.bbb.ccc');assert.equal(r.status,403);assert.equal(await count(),n);checks.push('https-public-receiver-rejects-local-fixture-host');
 n=await count();r=await request('logout/connect/back-channel/keycloak',{},'GET');assert.equal(r.status,502);assert.equal(await count(),n);checks.push('public-receiver-is-not-a-readable-proxy');
 console.log(JSON.stringify({completed:true,checks}));
}
"""
def run(args,timeout=90):
 return subprocess.run(args,cwd=ROOT,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=timeout,check=True).stdout.strip()
def runtime():
 ids=run(['docker','ps','-q','--filter','label=com.docker.compose.project=agenttrust']).splitlines()
 return json.loads(run(['docker','inspect','--format','{{json .Id}}',*ids])) if len(ids)==1 else {i:run(['docker','inspect','--format','{{.Image}}|{{.RestartCount}}|{{.State.Running}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}',i]) for i in ids}
assert shutil.disk_usage(ROOT).free>=23622320128
token=str(uuid.uuid4());network='agenttrust-oidc-fixture-'+token;stub=network+'-stub';console=network+'-console';directory=LOCAL/('stack-oidc-endpoint-proxy-'+token);directory.mkdir();source=directory/'fixture.mjs';source.write_text(CODE,encoding='utf-8');before=runtime();created=[];network_created=False
report={'completed':False,'kind':'https-oidc-endpoint-proxy-fixture','actualNextServerExercised':True,'upstreamSynthetic':True,'actualHttpsHandshakePerformed':False,'productionDeploymentPerformed':False,'privateInputsMounted':False,'publicPortsExposed':False,'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
try:
 image=run(['docker','image','inspect','--format','{{.Id}}',IMAGE]);report['candidateImageId']=image
 run(['docker','network','create','--internal',network]);network_created=True
 for name,img,extra in [(stub,NODE,['--network-alias','stack-core-api','--mount','type=bind,source='+str(source)+',target=/fixture.mjs,readonly',NODE,'node','/fixture.mjs','serve']),(console,IMAGE,['--network-alias','console','-e','CORE_API_URL=http://stack-core-api:8080',IMAGE])]:
  args=['docker','run','-d','--name',name,'--network',network,'--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','256m','--pids-limit','64','--tmpfs','/tmp:size=32m,mode=1777']
  if name==stub:args+=['--user','1000:1000']
  run(args+extra);created.append(name)
 result=json.loads(run(['docker','exec',stub,'node','/fixture.mjs','check'],120));assert result['completed'] and len(result['checks'])==18;report.update(result)
except Exception as error:
 report.update(errorType=type(error).__name__,code='OIDC_PROXY_FIXTURE_UNVERIFIED')
 if isinstance(error,subprocess.CalledProcessError):
  (directory/'synthetic-fixture-error.log').write_text((error.stderr or '')[-4096:],encoding='utf-8')
  report['syntheticFailureLog']=str(directory/'synthetic-fixture-error.log')
finally:
 cleanup=True
 for name in reversed(created):
  try:run(['docker','rm','-f',name])
  except Exception:cleanup=False
 if network_created:
  try:run(['docker','network','rm',network])
  except Exception:cleanup=False
 report['fixtureResourcesRemoved']=cleanup;report['existingRuntimeUnchanged']=runtime()==before;report['cDriveFreeBytes']=shutil.disk_usage(ROOT).free
 if not cleanup or not report['existingRuntimeUnchanged'] or report['cDriveFreeBytes']<23622320128:report['completed']=False
 report['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();path=directory/'summary.json';path.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print(json.dumps({'completed':report['completed'],'checks':len(report.get('checks',[])),'reportPath':str(path),'existingRuntimeUnchanged':report['existingRuntimeUnchanged'],'fixtureResourcesRemoved':cleanup}))
if not report['completed']:raise SystemExit(1)
