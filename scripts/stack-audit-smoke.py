"""Scoped immutable audit navigation over real API, Gateway, RLS and tied timestamps."""
import datetime,json,pathlib,re,subprocess,uuid,base64,struct
from stack_test_client import StackClient
root=pathlib.Path(__file__).resolve().parent.parent
report={'completed':False,'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'checks':[],'credentialsRecorded':False,'existingBusinessRowsChanged':False,'actualDeploymentPerformed':False};clients=[]
def checked(message):report['checks'].append(message)
def sql(text,success=True):
 result=subprocess.run(['docker','exec','-i','agenttrust-stack-db-1','psql','-U','agenttrust_stack','-d','agenttrust_stack','-v','ON_ERROR_STOP=1','-At'],input=text,cwd=root,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=20)
 assert (result.returncode==0)==success
 return result.stdout
def scope(org,project):return f"BEGIN;SET LOCAL ROLE agenttrust_stack_api;SELECT set_config('agenttrust.organization_id','{org}',true);SELECT set_config('agenttrust.project_id','{project}',true);"
def page(client,token=None):return client.request('audit'+('/'+token if token else ''))
try:
 anonymous=StackClient('http://127.0.0.1:4320',[],report,clients);anonymous.request('audit',expected=401);anonymous.request('audit/'+'A'*80,expected=401)
 credentials=json.loads((root/'.local/stack/demo-credentials.json').read_text(encoding='utf-8'));admin=StackClient('http://127.0.0.1:4320',credentials,report,clients);owner=admin.login('demo-admin')
 state=json.loads(subprocess.check_output(['docker','inspect','agenttrust-stack-db-1'],text=True,cwd=root))[0];assert state['Config']['Labels']['com.docker.compose.project']=='agenttrust' and state['Config']['Labels']['com.docker.compose.service']=='stack-db'
 org=owner['organizationId'];project=owner['projectId'];actor=owner['actorId'];fixture=uuid.uuid4().hex[:20];resource=str(uuid.uuid4());peer_project=str(uuid.uuid4());peer_org=str(uuid.uuid4())
 for value in [org,project,actor,resource,peer_project,peer_org]:assert str(uuid.UUID(value))==value
 ids=[str(uuid.UUID(fixture+f'{i:012x}')) for i in range(1,28)];report['ownFixtureRowsCreated']=32
 # One statement deliberately gives every own row the identical PostgreSQL timestamp.
 values=','.join(f"('{id}','{org}','{project}','{actor}','test.fixture.audit-navigation','{resource}')" for id in ids)
 sql(scope(org,project)+f"INSERT INTO stack_audit(id,organization_id,project_id,actor_id,action,resource_id) VALUES {values};COMMIT;")
 for foreign_org,foreign_project in [(org,peer_project),(peer_org,project)]:
  values=','.join(f"('{uuid.uuid4()}','{foreign_org}','{foreign_project}','{actor}','test.fixture.audit-isolation','{resource}')" for _ in range(2));sql(scope(foreign_org,foreign_project)+f"INSERT INTO stack_audit(id,organization_id,project_id,actor_id,action,resource_id) VALUES {values};COMMIT;")
 report['phase']='navigation';first=page(admin);assert first['organizationId']==org and first['projectId']==project and first['limit']==25 and first['ordering']=='created-at-id-desc' and first['deploymentAuthority'] is False
 assert [row['id'] for row in first['entries']]==sorted(ids,reverse=True)[:25] and len({row['createdAt'] for row in first['entries']})==1
 token=first['nextCursor'];assert re.fullmatch('[A-Za-z0-9_-]{80}',token);raw=base64.urlsafe_b64decode(token);assert len(raw)==60 and str(uuid.UUID(bytes=raw[:16]))==org and str(uuid.UUID(bytes=raw[16:32]))==project and str(uuid.UUID(bytes=raw[44:]))==first['entries'][-1]['id']
 second=page(admin,token);assert [row['id'] for row in second['entries'][:2]]==sorted(ids,reverse=True)[25:] and not set(row['id'] for row in first['entries'])&set(row['id'] for row in second['entries'])
 checked('same-timestamp keyset navigation returns exactly 25 rows without duplicate or missing own records')
 new_id=str(uuid.uuid4());sql(scope(org,project)+f"INSERT INTO stack_audit(id,organization_id,project_id,actor_id,action,resource_id) VALUES('{new_id}','{org}','{project}','{actor}','test.fixture.audit-newer','{resource}');COMMIT;")
 assert page(admin,token)==second;new_first=page(admin);assert new_first['entries'][0]['id']==new_id
 checked('new records appear on refresh without shifting an existing older-page boundary')
 report['phase']='isolation';viewer=StackClient('http://127.0.0.1:4320',credentials,report,clients);viewer.login('demo-viewer');assert page(viewer,token)==second
 foreign_name=next(row['username'] for row in credentials if row['organizationId']!=org);foreign=StackClient('http://127.0.0.1:4320',credentials,report,clients);foreign.login(foreign_name);foreign.request('audit/'+token,expected=400)
 assert all(row['resourceId']!=resource for row in page(foreign)['entries'])
 count=sql(scope(org,peer_project)+f"SELECT count(*) FROM stack_audit WHERE id IN ({','.join(repr(id) for id in ids)});ROLLBACK;");assert '0' in count.splitlines()
 checked('viewer reads scoped history while foreign organization and project boundaries remain isolated')
 report['phase']='route-boundaries';direct=StackClient('http://127.0.0.1:4321',credentials,report,clients);direct.login('demo-admin');direct.request('audit/short',expected=400);admin.request('audit/short',expected=502)
 bad=bytearray(raw);struct.pack_into('>i',bad,40,1);direct.request('audit/'+base64.urlsafe_b64encode(bad).decode(),expected=400)
 # Both API and Gateway refuse writes; no audit event is created by navigation.
 direct.request('audit','POST',{},expected=405);admin.request('audit','POST',{},expected=502)
 checked('malformed and impossible cursors and writable audit routes are refused without arbitrary queries')
 report['phase']='immutability';sql(scope(org,project)+f"UPDATE stack_audit SET action='test.changed' WHERE id='{ids[0]}';ROLLBACK;",False);sql(scope(org,project)+f"DELETE FROM stack_audit WHERE id='{ids[0]}';ROLLBACK;",False)
 assert page(admin)==new_first and page(admin,token)==second
 checked('API database role cannot update or delete audit history; reads retain exact original page contents')
 report['completed']=True
except Exception as error:report['errorType']=type(error).__name__;report['failedStage']=report.get('phase')
finally:
 for client in reversed(clients):
  try:client.logout()
  except Exception:report['completed']=False;report['ownSessionLogoutFailed']=True
 report['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();path=root/'.local'/('stack-audit-smoke-'+str(uuid.uuid4())+'.json');path.open('x',encoding='utf-8').write(json.dumps(report,indent=2)+'\n');print(json.dumps({**report,'reportPath':str(path)}))
if not report['completed']:raise SystemExit(1)
