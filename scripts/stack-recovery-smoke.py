"""Fault tests against new stack only. Restores stopped services and closes its own session."""
import argparse,datetime,json,pathlib,subprocess,time,uuid
from stack_test_client import StackClient
from stack_compose import stack_compose
p=argparse.ArgumentParser();p.add_argument('--mode',choices=['worker-restart','nats-restart','jetstream-persistence','core-restart','deadline'],required=True);args=p.parse_args()
root=pathlib.Path(__file__).resolve().parent.parent;compose=stack_compose(root);report={'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'mode':args.mode,'synthetic':True,'completed':False,'legacyServicesChanged':False,'checks':[]};restore=[];client=None
def command(arguments):return subprocess.run(arguments,cwd=root,capture_output=True,text=True,check=True).stdout
def check(name):report['checks'].append(name)
def stream_state():
 value=json.loads(command(['docker','exec','agenttrust-stack-nats-1','wget','-q','-O','-','http://127.0.0.1:8222/jsz?streams=true&consumers=true']))
 return next(stream for account in value['account_details'] for stream in account['stream_detail'] if stream['name']=='STACK_EVALUATIONS')
try:
 for service in ['stack-core-api','stack-ai-worker','stack-nats']:
  state=json.loads(command(['docker','inspect','agenttrust-'+service+'-1']))[0];assert state['Config']['Labels']['com.docker.compose.project']=='agenttrust' and state['Config']['Labels']['com.docker.compose.service']==service
 client=StackClient('http://127.0.0.1:4321',json.loads((root/'.local/stack/demo-credentials.json').read_text(encoding='utf-8')),report);client.login('demo-admin')
 service='stack-nats' if args.mode=='nats-restart' else 'stack-ai-worker';restore=[service,'stack-ai-worker'];command(compose+['stop',service]);key=str(uuid.uuid4());body={'scenario':'pass','requiresApproval':False};record=client.request('runs','POST',body,{'Idempotency-Key':key});run_id=record['id'];report['runId']=run_id;assert record['state']=='queued' and not client.request('runs/'+run_id+'/gate')['deploymentAllowed'];check('admission persists while dependency is unavailable; queued gate refuses release')
 if args.mode=='jetstream-persistence':
  until=time.monotonic()+10;before=stream_state()
  while before['state']['messages']<1 and time.monotonic()<until:time.sleep(.25);before=stream_state()
  assert before['state']['messages']>=1;restore=['stack-nats','stack-ai-worker'];command(compose+['restart','stack-nats']);command(compose+['up','-d','--wait','stack-nats']);after=stream_state();assert before['created']==after['created'] and after['state']['messages']>=1 and after['state']['last_seq']>=before['state']['last_seq'];check('JetStream file storage retains stream identity and undelivered message across restart');command(compose+['up','-d','--wait','stack-ai-worker']);restore=[]
 elif args.mode=='core-restart':
  command(compose+['restart','stack-core-api']);command(compose+['up','-d','--wait','stack-core-api','stack-ai-worker']);restore=[]
  # The restarted API invalidates its in-memory session; authenticate a fresh session.
  client.logout();client.login('demo-admin')
 elif args.mode!='deadline':
  time.sleep(3);command(compose+['up','-d','--wait',*dict.fromkeys(restore)]);restore=[]
 limit=time.monotonic()+(145 if args.mode=='deadline' else 30)
 while record['state']=='queued' and time.monotonic()<limit:
  time.sleep(.5);record=client.request('runs/'+run_id)
 if args.mode=='deadline':
  assert record['state']=='failed' and record['decision']=='inconclusive' and record['result']['executionEngine']=='python-unavailable';check('two-minute execution deadline persists an inconclusive failure')
  command(compose+['up','-d','--wait',*dict.fromkeys(restore)]);restore=[];time.sleep(4);record=client.request('runs/'+run_id);assert record['state']=='failed' and not client.request('runs/'+run_id+'/gate')['deploymentAllowed'];check('late worker delivery cannot overwrite final failure or enable release')
 else:
  assert record['state']=='succeeded' and record['result']['executionEngine']=='python-synthetic';assert client.request('runs/'+run_id+'/gate')['deploymentAllowed'];check('durable delivery resumes and confirms Python completion after dependency restoration')
 assert client.request('runs','POST',body,{'Idempotency-Key':key})['id']==run_id;report['runId']=run_id;check('repeated admission retains the same persisted run')
 report['completed']=True
except Exception:
 report['code']='STACK_RECOVERY_UNVERIFIED'
finally:
 restored=True
 if restore:
  try:command(compose+['up','-d','--wait',*dict.fromkeys(restore)])
  except Exception:restored=False
 logged_out=False
 if client is not None:
  try:client.logout();logged_out=not client.logged
  except Exception:pass
 report.update(dependenciesRestored=restored,ownSessionLoggedOut=logged_out,finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat());path=root/'.local'/('stack-recovery-'+str(uuid.uuid4())+'.json');path.open('x',encoding='utf-8').write(json.dumps(report,indent=2)+'\n');print(json.dumps({'completed':report['completed'],'mode':args.mode,'checks':len(report['checks']),'dependenciesRestored':restored,'ownSessionLoggedOut':logged_out,'reportPath':str(path)}))
 if not report['completed'] or not restored or not logged_out:raise SystemExit(1)
