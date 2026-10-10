"""Loopback-only synthetic test client; each instance owns and closes its session."""
import http.cookiejar,json,urllib.request,urllib.error,urllib.parse,html.parser
class LoopbackCookiePolicy(http.cookiejar.DefaultCookiePolicy):
 def return_ok_secure(self,cookie,request):
  # Browsers treat loopback as trustworthy; never extend this exception to any remote host.
  return urllib.parse.urlsplit(request.full_url).netloc=='127.0.0.1:4322' or super().return_ok_secure(cookie,request)
class FixedRedirects(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,req,fp,code,msg,headers,newurl):
  parsed=urllib.parse.urlsplit(newurl);assert parsed.scheme=='http' and parsed.netloc in ['127.0.0.1:4320','127.0.0.1:4321','127.0.0.1:4322'] and not parsed.username and not parsed.password and len(newurl)<8192
  return super().redirect_request(req,fp,code,msg,headers,newurl)
class IdentityForm(html.parser.HTMLParser):
 def __init__(self):super().__init__();self.action=None;self.fields={};self.active=False
 def handle_starttag(self,tag,attrs):
  values=dict(attrs)
  if tag=='form' and (values.get('id')=='kc-form-login' or urllib.parse.urlsplit(values.get('action','')).path=='/realms/agenttrust/protocol/openid-connect/logout/logout-confirm'):self.action=values.get('action');self.active=True
  if tag=='input' and self.active and values.get('name') and values.get('type') in ['hidden','submit']:self.fields[values['name']]=values.get('value','')
 def handle_endtag(self,tag):
  if tag=='form':self.active=False
class StackClient:
 def __init__(self,base,credentials,report=None,clients=None):
  assert base in ['http://127.0.0.1:4321','http://127.0.0.1:4320'];self.base=base;self.prefix='/backend/' if base.endswith('4320') else '/api/';self.credentials=credentials;self.report={} if report is None else report;self.jar=http.cookiejar.CookieJar(policy=LoopbackCookiePolicy());self.opener=urllib.request.build_opener(FixedRedirects(),urllib.request.HTTPCookieProcessor(self.jar));self.token=None;self.logged=False;self.provider=None
  if clients is not None:clients.append(self)
 def request(self,path,method='GET',data=None,headers=None,expected=200):
  hs={'Accept':'application/json',**(headers or {})};body=None
  if method=='POST':
   hs.setdefault('Origin',self.base)
   if self.token:hs['X-CSRF-TOKEN']=self.token
   if isinstance(data,dict):body=json.dumps(data).encode();hs['Content-Type']='application/json'
   elif data is not None:body=data.encode();hs['Content-Type']='application/x-www-form-urlencoded'
  req=urllib.request.Request(self.base+self.prefix+path,data=body,headers=hs,method=method)
  try:response=self.opener.open(req,timeout=15)
  except urllib.error.HTTPError as error:response=error
  status=response.status;raw=response.read(1048577);response.close()
  if status!=expected:
   self.report['unexpectedHttpStatus']=status;self.report['expectedHttpStatus']=expected
   try:
    code=json.loads(raw).get('code');self.report['responseCode']=code if isinstance(code,str) and code.isascii() and code.replace('_','').isalpha() else None
   except Exception:pass
  assert status==expected,f'Unexpected HTTP status at {path}: {status}';assert len(raw)<=1048576
  return json.loads(raw) if raw else None
 def csrf(self):self.token=self.request('csrf')['token'];assert len(self.token)<=2048
 def login(self,name):
  self.provider=self.request('auth-info')['identityProvider'];u=next(x for x in self.credentials if x['username']==name)
  if self.provider=='keycloak':
   with self.opener.open('http://127.0.0.1:4320/backend/oauth2/authorization/keycloak',timeout=15) as response:
    url=urllib.parse.urlsplit(response.url);query=urllib.parse.parse_qs(url.query);raw=response.read(1048577);assert len(raw)<=1048576
   assert url.netloc=='127.0.0.1:4322' and url.path=='/realms/agenttrust/protocol/openid-connect/auth';assert query['client_id']==['agenttrust-console'] and query['redirect_uri']==['http://127.0.0.1:4320/backend/login/oauth2/code/keycloak'] and query['code_challenge_method']==['S256'] and len(query['state'][0])>=16 and len(query['nonce'][0])>=16
   form=IdentityForm();form.feed(raw.decode('utf-8'));assert form.action
   target=urllib.parse.urlsplit(form.action);assert target.scheme=='http' and target.netloc=='127.0.0.1:4322' and target.path.startswith('/realms/agenttrust/login-actions/')
   body=urllib.parse.urlencode({**form.fields,'username':name,'password':u['password'],'credentialId':''}).encode()
   with self.opener.open(urllib.request.Request(form.action,data=body,headers={'Content-Type':'application/x-www-form-urlencoded','Origin':'http://127.0.0.1:4322'}),timeout=15) as response:assert response.url=='http://127.0.0.1:4320/'
   self.report['oidcAuthorizationCodePkceVerified']=True
  else:
   assert self.provider=='local-demo';self.csrf();self.request('login','POST',urllib.parse.urlencode({'username':name,'password':u['password']}))
  self.logged=True;self.csrf();me=self.request('me');assert me['organizationId']==u['organizationId'] and me['projectId']==u['projectId'] and me['actorId']==u['actorId'] and me['role']==u['role'] and me['identityProvider']==self.provider;return me
 def logout(self):
  if self.logged:
   self.csrf();value=self.request('logout','POST',{});self.request('me',expected=401)
   if self.provider=='keycloak':
    url='http://127.0.0.1:4322/realms/agenttrust/protocol/openid-connect/logout?client_id=agenttrust-console&post_logout_redirect_uri=http%3A%2F%2F127.0.0.1%3A4320%2F';assert value['logoutUrl']==url
    with self.opener.open(url,timeout=15) as response:raw=response.read(1048577);assert len(raw)<=1048576;at=response.url
    if at!='http://127.0.0.1:4320/':
     form=IdentityForm();form.feed(raw.decode('utf-8'));assert form.action;form.action=urllib.parse.urljoin(url,form.action)
     target=urllib.parse.urlsplit(form.action);assert target.scheme=='http' and target.netloc=='127.0.0.1:4322' and target.path=='/realms/agenttrust/protocol/openid-connect/logout/logout-confirm'
     with self.opener.open(urllib.request.Request(form.action,data=urllib.parse.urlencode(form.fields).encode(),headers={'Content-Type':'application/x-www-form-urlencoded','Origin':'http://127.0.0.1:4322'}),timeout=15) as response:assert response.url=='http://127.0.0.1:4320/'
    self.report['ownIdentityProviderSessionClosed']=True
   self.logged=False
