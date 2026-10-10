"""Loopback-only synthetic test client; each instance owns and closes its session."""
import http.cookiejar,json,urllib.request,urllib.error,urllib.parse
class StackClient:
 def __init__(self,base,credentials,report=None,clients=None):
  assert base in ['http://127.0.0.1:4321','http://127.0.0.1:4320'];self.base=base;self.prefix='/backend/' if base.endswith('4320') else '/api/';self.credentials=credentials;self.report={} if report is None else report;self.jar=http.cookiejar.CookieJar();self.opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar));self.token=None;self.logged=False
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
  self.csrf();u=next(x for x in self.credentials if x['username']==name);self.request('login','POST',urllib.parse.urlencode({'username':name,'password':u['password']}));self.logged=True;self.csrf();me=self.request('me');assert me['organizationId']==u['organizationId'] and me['projectId']==u['projectId'] and me['role']==u['role'];return me
 def logout(self):
  if self.logged:self.csrf();self.request('logout','POST',{});self.logged=False;self.request('me',expected=401)
