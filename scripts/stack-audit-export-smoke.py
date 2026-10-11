"""Bounded metadata export over actual OIDC, BFF, WebFlux, Java and RLS."""
import datetime,hashlib,json,pathlib,subprocess,uuid
from stack_test_client import StackClient
ROOT=pathlib.Path(__file__).resolve().parent.parent
report={'completed':False,'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'checks':[],'existingBusinessRowsChanged':False,'credentialsRecorded':False,'actualDeploymentPerformed':False};clients=[]
def sql(statement):
 p=subprocess.run(['docker','exec','-i','agenttrust-stack-db-1','psql','-U','agenttrust_stack','-d','agenttrust_stack','-v','ON_ERROR_STOP=1','-At'],input=statement,cwd=ROOT,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=20);assert p.returncode==0;return p.stdout
def scope(org,project):return f"BEGIN;SET LOCAL ROLE agenttrust_stack_api;SELECT set_config('agenttrust.organization_id','{org}',true);SELECT set_config('agenttrust.project_id','{project}',true);"
def verify(frame,owner):
 assert set(frame)=={'contentJson','contentSha256','contentBytes','organizationId','projectId','signed','currentDeploymentAuthority'}
 raw=frame['contentJson'].encode('utf-8');assert 1<=len(raw)<=262144 and len(raw)==frame['contentBytes'] and hashlib.sha256(raw).hexdigest()==frame['contentSha256']
 assert frame['organizationId']==owner['organizationId'] and frame['projectId']==owner['projectId'] and frame['signed'] is False and frame['currentDeploymentAuthority'] is False
 doc=json.loads(raw);assert len(doc)==14 and doc['schemaVersion']==1 and doc['kind']=='project-audit-export' and doc['organizationId']==owner['organizationId'] and doc['projectId']==owner['projectId'] and doc['limit']==500 and doc['ordering']=='created-at-id-desc' and doc['signed'] is False and doc['currentDeploymentAuthority'] is False
 assert doc['recordCount']==len(doc['entries'])<=500 and doc['entireProjectHistory']==(not doc['hasOlderRecords'])
 coordinates=[(r['createdAt'],r['id']) for r in doc['entries']];assert coordinates==sorted(coordinates,reverse=True) and len({r['id'] for r in doc['entries']})==len(coordinates)
 return doc
try:
 anonymous=StackClient('http://127.0.0.1:4320',[],report,clients);anonymous.request('audit-export',expected=401)
 credentials=json.loads((ROOT/'.local/stack/demo-credentials.json').read_text(encoding='utf-8'));viewer=StackClient('http://127.0.0.1:4320',credentials,report,clients);owner=viewer.login('demo-viewer');org=owner['organizationId'];project=owner['projectId'];actor=owner['actorId'];resource=str(uuid.uuid4())
 for value in [org,project,actor,resource]:assert str(uuid.UUID(value))==value
 state=json.loads(subprocess.check_output(['docker','inspect','agenttrust-stack-db-1'],cwd=ROOT,text=True))[0];assert state['Config']['Labels']['com.docker.compose.project']=='agenttrust' and state['Config']['Labels']['com.docker.compose.service']=='stack-db'
 fixture=uuid.uuid4().hex[:20];ids=[str(uuid.UUID(fixture+f'{i:012x}')) for i in range(1,502)]
 values=','.join(f"('{id}','{org}','{project}','{actor}','test.fixture.audit-export','{resource}')" for id in ids)
 sql(scope(org,project)+f"INSERT INTO stack_audit(id,organization_id,project_id,actor_id,action,resource_id) VALUES {values};COMMIT;");report['ownFixtureRowsCreated']=501
 frame=viewer.request('audit-export');doc=verify(frame,owner);assert doc['hasOlderRecords'] and not doc['entireProjectHistory'] and [r['id'] for r in doc['entries']]==sorted(ids,reverse=True)[:500];assert len({r['createdAt'] for r in doc['entries']})==1
 report['checks'].append('viewer export returns exactly latest 500 own equal-timestamp fixture rows with bounded UTF-8 hash and explicit older-history marker')
 foreign_name=next(row['username'] for row in credentials if row['organizationId']!=org);foreign=StackClient('http://127.0.0.1:4320',credentials,report,clients);other=foreign.login(foreign_name);other_doc=verify(foreign.request('audit-export'),other);assert all(r['resourceId']!=resource for r in other_doc['entries'])
 foreign_project=str(uuid.uuid4());count=sql(scope(org,foreign_project)+f"SELECT count(*) FROM stack_audit WHERE resource_id='{resource}';ROLLBACK;");assert '0' in count.splitlines()
 report['checks'].append('actual authenticated foreign organization and RLS foreign project cannot export own project fixture records')
 direct=StackClient('http://127.0.0.1:4321',credentials,report,clients);direct.login('demo-viewer');direct.request('audit-export','POST',{},expected=405);viewer.request('audit-export','POST',{},expected=502);viewer.request('audit-export?organizationId='+org,expected=502)
 assert viewer.request('audit-export')==frame
 report['checks'].append('read-only export does not append audit events; writes and arbitrary scope query are refused')
 new_id=str(uuid.uuid4());sql(scope(org,project)+f"INSERT INTO stack_audit(id,organization_id,project_id,actor_id,action,resource_id) VALUES('{new_id}','{org}','{project}','{actor}','test.fixture.audit-export-newer','{resource}');COMMIT;");report['ownFixtureRowsCreated']+=1
 fresh=viewer.request('audit-export');assert verify(fresh,owner)['entries'][0]['id']==new_id and fresh['contentSha256']!=frame['contentSha256'];assert verify(frame,owner)==doc
 report['checks'].append('later own audit append changes a fresh export without changing previously captured JSON bytes or claiming a current full-history guarantee')
 report['completed']=True
except Exception as error:report['errorType']=type(error).__name__
finally:
 closed=True
 for client in reversed(clients):
  try:client.logout()
  except Exception:closed=False
 report.update(ownSessionsLoggedOut=closed,finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat());path=ROOT/'.local'/('stack-audit-export-'+str(uuid.uuid4())+'.json');path.open('x',encoding='utf-8').write(json.dumps(report,indent=2)+'\n');print(json.dumps({'completed':report['completed'],'checks':len(report['checks']),'ownSessionsLoggedOut':closed,'reportPath':str(path),'errorType':report.get('errorType'),'unexpectedHttpStatus':report.get('unexpectedHttpStatus')}))
if not report['completed'] or not closed:raise SystemExit(1)
