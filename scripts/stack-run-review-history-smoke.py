"""Read only existing evaluation reviews through scoped pages; own sessions only."""
import base64,datetime,json,pathlib,struct,uuid
from stack_test_client import StackClient
ROOT=pathlib.Path(__file__).resolve().parent.parent
report={'completed':False,'checks':[],'businessWritesPerformed':False,'credentialsRecorded':False};clients=[]
def cursor(user,run,sequence,domain=b'RRV'):
 return base64.urlsafe_b64encode(domain+uuid.UUID(user['organizationId']).bytes+uuid.UUID(user['projectId']).bytes+uuid.UUID(run).bytes+struct.pack('>q',sequence)).decode().rstrip('=')
def validate(page,user,run,boundary=None):
 assert set(page)=={'runId','organizationId','projectId','entries','limit','deploymentAuthority','ordering','nextCursor'}
 assert page['runId']==run and page['organizationId']==user['organizationId'] and page['projectId']==user['projectId'] and page['limit']==50 and page['deploymentAuthority'] is False and page['ordering']=='review-sequence-desc'
 assert isinstance(page['entries'],list) and len(page['entries'])<=50
 previous=boundary or 2**53;seen=set()
 for row in page['entries']:
  assert set(row)=={'id','actor_id','decision','reason','created_at','review_sequence','policy_version','policy_digest'}
  assert row['id'] not in seen and row['decision'] in ['approved','rejected'] and isinstance(row['reason'],str) and len(row['reason'])<=500 and isinstance(row['review_sequence'],int) and 0<row['review_sequence']<previous
  seen.add(row['id']);previous=row['review_sequence']
 if page['nextCursor'] is not None:assert len(page['entries'])==50 and page['nextCursor']==cursor(user,run,page['entries'][-1]['review_sequence'])
try:
 credentials=json.loads((ROOT/'.local/stack/demo-credentials.json').read_text(encoding='utf-8'))
 viewer=StackClient('http://127.0.0.1:4320',credentials,report,clients);user=viewer.login('demo-viewer');runs=viewer.request('runs');assert runs;run=runs[0]['id']
 frame=viewer.request('runs/'+run+'/reviews/page');validate(frame,user,run);assert frame['entries']==viewer.request('runs/'+run+'/reviews');report['checks'].append('scoped page preserves exact existing latest evaluation reviews')
 boundary=frame['entries'][-1]['review_sequence'] if frame['entries'] else 1
 older=viewer.request('runs/'+run+'/reviews/page/'+cursor(user,run,boundary));validate(older,user,run,boundary);assert not {r['id'] for r in frame['entries']} & {r['id'] for r in older['entries']};report['checks'].append('actual lower sequence request excludes earlier records')
 for token in [cursor(user,run,1,b'CRV'),cursor(user,str(uuid.uuid4()),1),cursor(user,run,0),cursor(user,run,2**53)]:viewer.request('runs/'+run+'/reviews/page/'+token,expected=400)
 report['checks'].append('campaign domain foreign evaluation zero and unsafe sequence refused')
 admin=StackClient('http://127.0.0.1:4320',credentials,report,clients);admin_user=admin.login('demo-admin');same=admin.request('runs/'+run+'/reviews/page');validate(same,admin_user,run);assert same==frame;report['checks'].append('administrator and viewer observe identical existing records')
 foreign=StackClient('http://127.0.0.1:4320',credentials,report,clients);foreign.login('other-admin');foreign.request('runs/'+run+'/reviews/page',expected=404);foreign.request('runs/'+run+'/reviews/page/'+cursor(user,run,1),expected=400);report['checks'].append('foreign organization cannot discover reviews or reuse boundary')
 viewer.request('runs/'+str(uuid.uuid4())+'/reviews/page',expected=404);report['checks'].append('missing evaluation fails closed')
 anonymous=StackClient('http://127.0.0.1:4320',credentials,report,clients);anonymous.request('runs/'+run+'/reviews/page',expected=401);report['checks'].append('anonymous history read requires identity')
 viewer.request('runs/'+run+'/reviews','POST',{'decision':'approved','reason':'Unauthorized synthetic boundary probe'},expected=403);report['checks'].append('viewer cannot write review through preserved POST path')
 report['completed']=True
except Exception as error:report['errorType']=type(error).__name__
finally:
 closed=True
 for client in clients:
  try:client.logout()
  except Exception:closed=False
 report['ownSessionsClosed']=closed;report['completed']=report['completed'] and closed;report['verifiedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();path=ROOT/'.local'/('stack-run-review-history-'+str(uuid.uuid4())+'.json');path.open('x',encoding='utf-8').write(json.dumps(report,indent=2)+'\n');print(json.dumps({'completed':report['completed'],'checks':len(report['checks']),'reportPath':str(path),'errorType':report.get('errorType')}))
if not report['completed']:raise SystemExit(1)
