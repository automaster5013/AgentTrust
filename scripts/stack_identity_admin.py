"""Private, loopback-only administration of the isolated synthetic realm."""
import json,pathlib,subprocess,urllib.request,urllib.parse
class IdentityAdmin:
 def __init__(self,root):self.root=root;self.token=None;self.refresh=None
 def __enter__(self):
  state=json.loads(subprocess.run(['docker','inspect','agenttrust-stack-identity-1'],cwd=self.root,capture_output=True,text=True,check=True).stdout)[0]
  assert state['Config']['Labels']['com.docker.compose.project']=='agenttrust' and state['Config']['Labels']['com.docker.compose.service']=='stack-identity'
  settings=dict(line.split('=',1) for line in (self.root/'.local/stack/identity.env').read_text(encoding='utf-8').splitlines())
  body=urllib.parse.urlencode({'client_id':'admin-cli','grant_type':'password','username':'stack-admin','password':settings['STACK_IDENTITY_ADMIN_PASSWORD']}).encode()
  with urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:4322/realms/master/protocol/openid-connect/token',data=body,method='POST'),timeout=10) as response:
   raw=response.read(65537);assert len(raw)<=65536;tokens=json.loads(raw)
  self.token=tokens['access_token'];self.refresh=tokens['refresh_token'];return self
 def request(self,path,method='GET',body=None):
  assert path.startswith('/users') or path.startswith('/clients') or path.startswith('/sessions/');assert '..' not in path and not path.startswith('//')
  url='http://127.0.0.1:4322/admin/realms/agenttrust'+path;headers={'Authorization':'Bearer '+self.token,'Content-Type':'application/json'}
  with urllib.request.urlopen(urllib.request.Request(url,headers=headers,data=json.dumps(body).encode() if body is not None else (b'' if method=='POST' else None),method=method),timeout=10) as response:
   raw=response.read(1048577);assert len(raw)<=1048576;return json.loads(raw) if raw else None
 def __exit__(self,*args):
  try:
   body=urllib.parse.urlencode({'client_id':'admin-cli','refresh_token':self.refresh}).encode()
   with urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:4322/realms/master/protocol/openid-connect/logout',data=body,method='POST'),timeout=10) as response:assert response.status==204
  finally:self.token=None;self.refresh=None
