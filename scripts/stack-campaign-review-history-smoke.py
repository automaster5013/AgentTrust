"""Read-only scoped review-history checks using existing campaigns and owned sessions."""
import datetime,json,pathlib,uuid
from stack_test_client import StackClient
ROOT=pathlib.Path(__file__).resolve().parent.parent
report={'completed':False,'checks':[],'businessWritesPerformed':False,'credentialsRecorded':False};clients=[]
def verified(frame,user,campaign):
 assert set(frame)=={'campaignId','organizationId','projectId','entries','limit','deploymentAuthority'}
 assert frame['campaignId']==campaign and frame['organizationId']==user['organizationId'] and frame['projectId']==user['projectId'] and frame['limit']==50 and frame['deploymentAuthority'] is False
 assert isinstance(frame['entries'],list) and len(frame['entries'])<=50
 previous=2**63;seen=set()
 for row in frame['entries']:
  assert set(row)=={'id','decision','reason','actor_id','review_sequence','policy_version','policy_digest','created_at'}
  assert row['id'] not in seen and row['decision'] in ['approved','rejected'] and isinstance(row['reason'],str) and len(row['reason'])<=500 and isinstance(row['review_sequence'],int) and 0<row['review_sequence']<previous
  previous=row['review_sequence'];seen.add(row['id'])
try:
 credentials=json.loads((ROOT/'.local/stack/demo-credentials.json').read_text(encoding='utf-8'))
 viewer=StackClient('http://127.0.0.1:4320',credentials,report,clients);user=viewer.login('demo-viewer');rows=viewer.request('campaigns');assert rows
 campaign=rows[0]['id'];reference=viewer.request('campaigns/'+campaign+'/reviews');verified(reference,user,campaign);report['checks'].append('viewer reads scoped bounded history')
 admin=StackClient('http://127.0.0.1:4320',credentials,report,clients);admin_user=admin.login('demo-admin');frame=admin.request('campaigns/'+campaign+'/reviews');verified(frame,admin_user,campaign);assert frame==reference;report['checks'].append('administrator reads identical existing history')
 foreign=StackClient('http://127.0.0.1:4320',credentials,report,clients);foreign.login('other-admin');foreign.request('campaigns/'+campaign+'/reviews',expected=404);report['checks'].append('foreign organization cannot discover campaign reviews')
 viewer.request('campaigns/'+str(uuid.uuid4())+'/reviews',expected=404);report['checks'].append('unknown campaign fails closed')
 report['completed']=True
except Exception as error:report['errorType']=type(error).__name__
finally:
 closed=True
 for client in clients:
  try:client.logout()
  except Exception:closed=False
 report['ownSessionsClosed']=closed;report['completed']=report['completed'] and closed;report['verifiedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()
 path=ROOT/'.local'/('stack-campaign-review-history-'+str(uuid.uuid4())+'.json');path.open('x',encoding='utf-8').write(json.dumps(report,indent=2)+'\n');print(json.dumps({'completed':report['completed'],'checks':len(report['checks']),'reportPath':str(path),'errorType':report.get('errorType')}))
if not report['completed']:raise SystemExit(1)
