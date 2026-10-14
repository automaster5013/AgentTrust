"""Real signed provider logout through the public BFF, only in an owned clone."""
import http.cookiejar,json,pathlib,time,urllib.error,urllib.parse,urllib.request,uuid
from stack_recovery_transport import fixture_opener
from stack_test_client import StackClient,FixedRedirects

def require(value):
    if not value:raise ValueError('PUBLIC_IDENTITY_PROBE_REFUSED')

def main():
    report={'completed':False,'checks':[],'sourceIdentityConfigurationChanged':False,
            'productionDeploymentPerformed':False,'paidProviderCallsPerformed':False}
    credentials=json.loads(pathlib.Path('/credentials.json').read_bytes())
    admin=json.loads(pathlib.Path('/identity-probe-input.json').read_bytes())
    opener=fixture_opener(http.cookiejar.CookieJar(),FixedRedirects())
    clients=[];tokens=None;original=None;client_id=None;revoked=None
    def wire(url,method='GET',body=None,headers=None,expected=200):
        request=urllib.request.Request(url,data=body,headers=headers or {},method=method)
        try:response=opener.open(request,timeout=15)
        except urllib.error.HTTPError as error:response=error
        with response:
            raw=response.read(1048577);require(len(raw)<=1048576 and response.status==expected)
            return json.loads(raw) if raw else None
    identity='http://127.0.0.1:4322'
    def api(path,method='GET',body=None,expected=200):
        require(path.startswith(('/clients','/users','/sessions/')) and '..' not in path)
        return wire(identity+'/admin/realms/agenttrust'+path,method,
                    None if body is None else json.dumps(body).encode(),
                    {'Authorization':'Bearer '+tokens['access_token'],'Content-Type':'application/json'},expected)
    def user_sessions(user):
        rows=api('/users?'+urllib.parse.urlencode({'username':user,'exact':'true'}));require(len(rows)==1)
        key=str(uuid.UUID(rows[0]['id']));return {row['id'] for row in api('/users/'+key+'/sessions')}
    def login(user):
        c=StackClient('http://127.0.0.1:4320',credentials,{},clients)
        c.opener=fixture_opener(c.jar,FixedRedirects());c.login(user);return c
    try:
        report['stage']='owned-clone-client-configuration'
        tokens=wire(identity+'/realms/master/protocol/openid-connect/token','POST',
                    urllib.parse.urlencode({'client_id':'admin-cli','grant_type':'password',
                        'username':admin['username'],'password':admin['password']}).encode(),
                    {'Content-Type':'application/x-www-form-urlencoded'})
        rows=api('/clients?clientId=agenttrust-console');require(len(rows)==1 and rows[0]['clientId']=='agenttrust-console')
        client_id=str(uuid.UUID(rows[0]['id']));original=api('/clients/'+client_id)
        changed={**original,'attributes':{**original.get('attributes',{}),
            'backchannel.logout.url':'http://stack-console:3000/backend/logout/connect/back-channel/keycloak',
            'backchannel.logout.session.required':'true'}}
        api('/clients/'+client_id,'PUT',changed,204)
        before=user_sessions('demo-admin');own=login('demo-admin');after=user_sessions('demo-admin')
        require(len(after-before)==1);revoked=next(iter(after-before));str(uuid.UUID(revoked))
        foreign=login('other-admin')
        report['stage']='unsigned-public-logout-refused'
        wire('http://127.0.0.1:4320/backend/logout/connect/back-channel/keycloak','POST',
             b'logout_token=eyJhbGciOiJub25lIn0.eyJzaWQiOiJmYWtlIn0.a',
             {'Content-Type':'application/x-www-form-urlencoded'},400)
        own.request('me');foreign.request('me')
        report['checks'].append('unsigned public form without browser Origin or cookies cannot revoke either authenticated session')
        report['stage']='provider-signed-public-backchannel'
        api('/sessions/'+revoked,'DELETE',expected=204)
        until=time.monotonic()+20
        while True:
            try:own.request('me',expected=401);break
            except AssertionError:
                if time.monotonic()>=until:raise
                time.sleep(.5)
        foreign.request('me');own.logged=False
        report['checks'].append('real Keycloak signed logout crosses Console BFF and Gateway into Core and revokes only its matching provider session')
        report['completed']=True
    except Exception as error:
        report.update(errorType=type(error).__name__,code='PUBLIC_IDENTITY_ACCEPTANCE_UNVERIFIED')
    finally:
        closed=True;restored=original is None
        for c in reversed(clients):
            try:c.logout()
            except Exception:closed=False
        if original is not None:
            try:api('/clients/'+client_id,'PUT',original,204);restored=api('/clients/'+client_id).get('attributes',{})==original.get('attributes',{})
            except Exception:restored=False
        if tokens is not None:
            try:wire(identity+'/realms/master/protocol/openid-connect/logout','POST',
                     urllib.parse.urlencode({'client_id':'admin-cli','refresh_token':tokens['refresh_token']}).encode(),
                     {'Content-Type':'application/x-www-form-urlencoded'},204)
            except Exception:closed=False
        report.update(ownSessionsClosed=closed,fixtureClientConfigurationRestored=restored)
    print(json.dumps(report));return 0 if report['completed'] and report['ownSessionsClosed'] and report['fixtureClientConfigurationRestored'] else 1

if __name__=='__main__':raise SystemExit(main())
