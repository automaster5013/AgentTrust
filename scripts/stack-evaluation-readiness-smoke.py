"""Actual OIDC read-only dependency observation, optionally with owned worker interruption."""
import argparse,datetime,json,pathlib,subprocess,time,uuid
from stack_test_client import StackClient
from stack_business_fingerprint import fingerprint,sql
ROOT=pathlib.Path(__file__).resolve().parent.parent
parser=argparse.ArgumentParser();parser.add_argument('--worker-interruption',action='store_true');args=parser.parse_args()
report={'completed':False,'checks':[],'businessDataWrites':False,'paidApiCalls':False,'credentialsRecorded':False};clients=[];stopped=False

def validate(value,user,status):
 code="import {readFileSync} from 'node:fs';import {evaluationReadiness} from './apps/console/src/lib/evaluation-readiness.ts';const v=JSON.parse(readFileSync(0,'utf8'));console.log(JSON.stringify(evaluationReadiness(v.value,v.user,v.status)));"
 result=subprocess.run(['node','--experimental-strip-types','--input-type=module','-e',code],cwd=ROOT,input=json.dumps({'value':value,'user':user,'status':status}),capture_output=True,text=True,encoding='utf-8',timeout=15,check=True)
 return json.loads(result.stdout)

def worker(command):
 subprocess.run(['docker',command,'agenttrust-stack-ai-worker-1'],cwd=ROOT,capture_output=True,text=True,encoding='utf-8',timeout=40,check=True)

def recovered(client,user):
 for attempt in range(15):
  try:
   value=validate(client.request('evaluation-readiness'),user,200)
   if value['ready']:
    for key in ['unexpectedHttpStatus','expectedHttpStatus','responseCode']:report.pop(key,None)
    return
  except (AssertionError,subprocess.CalledProcessError):
   report['recoveryRetryCount']=report.get('recoveryRetryCount',0)+1
  time.sleep(2)
 raise ValueError('Worker recovery unverified')

try:
 before=fingerprint()
 anonymous=StackClient('http://127.0.0.1:4320',[],report,clients);anonymous.request('evaluation-readiness',expected=401)
 credentials=json.loads((ROOT/'.local/stack/demo-credentials.json').read_text(encoding='utf-8'))
 for name in ['demo-admin','demo-viewer','other-admin']:
  client=StackClient(anonymous.base,credentials,report,clients);user=client.login(name)
  value=validate(client.request('evaluation-readiness'),user,200);assert value['ready']
  client.request('evaluation-readiness','POST',{},expected=502)
  client.request('evaluation-readiness?projectId='+user['projectId'],expected=502)
  report['checks'].append(name+' checks own authenticated dependency scope and GET-only route')
 if args.worker_interruption:
  assert sql("SELECT count(*) FROM stack_runs r LEFT JOIN stack_run_results c ON c.run_id=r.id WHERE r.state='queued' AND c.run_id IS NULL;").splitlines()[-1]=='0'
  worker('stop');stopped=True
  try:
   value=validate(client.request('evaluation-readiness',expected=503),user,503)
   assert {d['name']:d['available'] for d in value['dependencies']}=={'database':True,'worker-queue':False,'policy':True}
   report['checks'].append('stopped worker produces scoped structured 503 while database and policy remain available')
  finally:
   worker('start');stopped=False
  recovered(client,user);report['checks'].append('restored worker returns independently validated ready observation')
 assert fingerprint()==before
 report.update(completed=True,businessTablesUnchanged=len(before),workerInterruption=args.worker_interruption)
except Exception as error:report.update(errorType=type(error).__name__,code='EVALUATION_READINESS_UNVERIFIED')
finally:
 if stopped:
  try:worker('start')
  except Exception:report['workerRecoveryUnverified']=True
 closed=True
 for client in reversed(clients):
  try:client.logout()
  except Exception:closed=False
 report.update(ownSessionsLoggedOut=closed,finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
 path=ROOT/'.local'/('stack-evaluation-readiness-'+str(uuid.uuid4())+'.json')
 with path.open('x',encoding='utf-8') as stream:stream.write(json.dumps(report,indent=2)+'\n')
 print(json.dumps({'completed':report['completed'],'checks':len(report['checks']),'errorType':report.get('errorType'),'unexpectedHttpStatus':report.get('unexpectedHttpStatus'),'ownSessionsLoggedOut':closed,'reportPath':str(path)}))
if not report['completed'] or not closed:raise SystemExit(1)
