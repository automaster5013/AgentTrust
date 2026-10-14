"""Resolve existing owned campaign admissions without creating business records or provider calls."""
import datetime,json,pathlib,subprocess,uuid
from stack_test_client import StackClient
ROOT=pathlib.Path(__file__).resolve().parent.parent
report={'completed':False,'checks':[],'businessWritesPerformed':False,'providerCallsPerformed':False,'requestKeysRecorded':False,'credentialsRecorded':False};clients=[]
def validate(frame,user,key,run):
 assert set(frame)=={'requestKey','organizationId','projectId','actorId','campaignId','deploymentAuthority'}
 assert frame['requestKey']==key and frame['organizationId']==user['organizationId'] and frame['projectId']==user['projectId'] and frame['actorId']==user['actorId'] and frame['campaignId']==run and frame['deploymentAuthority'] is False
try:
 credentials=json.loads((ROOT/'.local/stack/demo-credentials.json').read_text(encoding='utf-8'));admin=StackClient('http://127.0.0.1:4320',credentials,report,clients);user=admin.login('demo-admin')
 org=str(uuid.UUID(user['organizationId']));project=str(uuid.UUID(user['projectId']));actor=str(uuid.UUID(user['actorId']))
 statement="BEGIN READ ONLY;SET LOCAL statement_timeout='2s';SELECT id::text||'|'||idempotency_key FROM stack_campaigns WHERE organization_id='"+org+"'::uuid AND project_id='"+project+"'::uuid AND actor_id='"+actor+"'::uuid ORDER BY created_at DESC,id DESC LIMIT 1;ROLLBACK;"
 result=subprocess.run(['docker','exec','-i','agenttrust-stack-db-1','psql','-U','agenttrust_stack','-d','agenttrust_stack','-v','ON_ERROR_STOP=1','-At'],input=statement,cwd=ROOT,capture_output=True,text=True,encoding='utf-8',timeout=15,check=True)
 records=[line for line in result.stdout.splitlines() if '|' in line];assert len(records)==1;run,key=records[0].split('|');assert str(uuid.UUID(run))==run and 8<=len(key)<=100
 frame=admin.request('campaign-requests/'+key);validate(frame,user,key,run);detail=admin.request('campaigns/'+run);assert detail['organization_id']==org and detail['project_id']==project;report['checks'].append('existing owned key resolves to the exact scoped campaign without provider or business writes')
 assert admin.request('campaign-requests/'+key)==frame;report['checks'].append('repeated read preserves exact admission and metadata')
 viewer=StackClient('http://127.0.0.1:4320',credentials,report,clients);viewer.login('demo-viewer');viewer.request('campaign-requests/'+key,expected=404);report['checks'].append('same organization different actor cannot resolve another admission')
 foreign=StackClient('http://127.0.0.1:4320',credentials,report,clients);foreign.login('other-admin');foreign.request('campaign-requests/'+key,expected=404);report['checks'].append('foreign organization cannot discover admission')
 admin.request('campaign-requests/'+str(uuid.uuid4()),expected=404);report['checks'].append('unknown admission is a read-only not-found observation')
 anonymous=StackClient('http://127.0.0.1:4320',credentials,report,clients);anonymous.request('campaign-requests/'+key,expected=401);report['checks'].append('anonymous request resolution requires identity')
 for token in ['short','a'*101,'aaaaaaaa%2fother']:admin.request('campaign-requests/'+token,expected=502)
 report['checks'].append('proxy refuses malformed keys before forwarding')
 admin.request('campaign-requests/'+key,'POST',{},expected=502);report['checks'].append('new resolution path does not add a mutation method')
 report['completed']=True
except Exception as error:report['errorType']=type(error).__name__
finally:
 closed=True
 for client in clients:
  try:client.logout()
  except Exception:closed=False
 report['ownSessionsClosed']=closed;report['completed']=report['completed'] and closed;report['verifiedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();path=ROOT/'.local'/('stack-campaign-request-resolution-'+str(uuid.uuid4())+'.json');path.open('x',encoding='utf-8').write(json.dumps(report,indent=2)+'\n');print(json.dumps({'completed':report['completed'],'checks':len(report['checks']),'reportPath':str(path),'errorType':report.get('errorType')}))
if not report['completed']:raise SystemExit(1)
