"""Bounded real metadata load; own sessions, no evaluations, no paid inference."""
import argparse,concurrent.futures,datetime,hashlib,json,math,pathlib,shutil,statistics,time,uuid
from stack_test_client import StackClient
from stack_business_fingerprint import fingerprint
ROOT=pathlib.Path(__file__).resolve().parent.parent
parser=argparse.ArgumentParser();parser.add_argument('--minutes',type=int,default=15);parser.add_argument('--readers',type=int,default=20);args=parser.parse_args()
if not 1<=args.minutes<=180 or not 2<=args.readers<=20 or args.readers%2:raise SystemExit('Unsupported bounded load')
directory=ROOT/'.local'/('stack-readonly-soak-'+str(uuid.uuid4()));directory.mkdir()
report={'completed':False,'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'requestedMinutes':args.minutes,'readers':args.readers,'businessDataWrites':False,'paidApiCalls':False,'credentialsRecorded':False,'customerSlaVerified':False,'rounds':0,'requests':0,'requestFailures':0}
clients=[];observations={path:[] for path in ['me','runs','run-history','provider-usage','campaigns','audit']}
def save():
    temporary=directory/'summary.next.json';temporary.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');temporary.replace(directory/'summary.json')
def sample(client):
    readings=[]
    for path in observations:
        started=time.monotonic();value=client.request(path);elapsed=(time.monotonic()-started)*1000
        if path in ['run-history','provider-usage','audit']:assert value['organizationId']==client.expectedScope['organizationId'] and value['projectId']==client.expectedScope['projectId'] and value['deploymentAuthority'] is False
        if path in ['run-history','audit']:assert len(value['entries'])<=25
        if path in ['runs','campaigns']:assert isinstance(value,list) and len(value)<=50
        if path=='me':assert value['organizationId']==client.expectedScope['organizationId'] and value['projectId']==client.expectedScope['projectId'] and value['role']==client.expectedScope['role']
        if path=='provider-usage':assert value['billableUsageMeasured'] is False and value['reservedAttempts']+value['remainingAttempts']==100
        readings.append((path,elapsed))
    return readings
try:
    if shutil.disk_usage(ROOT).free<22*1073741824:raise ValueError('Insufficient development headroom')
    credentials=json.loads((ROOT/'.local/stack/demo-credentials.json').read_text(encoding='utf-8'))
    report['phase']='baseline';before=fingerprint();report['businessTables']=len(before)
    for index in range(args.readers):
        client=StackClient('http://127.0.0.1:4320',credentials,clients=clients);client.expectedScope=client.login('demo-viewer' if index%2==0 else 'other-admin')
    report['phase']='load';started=time.monotonic();deadline=started+args.minutes*60
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.readers) as pool:
        while time.monotonic()<deadline:
            if shutil.disk_usage(ROOT).free<22*1073741824:raise ValueError('Insufficient development headroom')
            began=time.monotonic();futures=[pool.submit(sample,client) for client in clients]
            for future in futures:
                try:readings=future.result(timeout=120)
                except Exception:report['requestFailures']+=1;raise
                for path,elapsed in readings:observations[path].append(elapsed);report['requests']+=1
            report['rounds']+=1;report['elapsedSeconds']=round(time.monotonic()-started,3);report['minimumCDriveFreeBytes']=min(report.get('minimumCDriveFreeBytes',shutil.disk_usage(ROOT).free),shutil.disk_usage(ROOT).free)
            report['latencyMs']={path:{'samples':len(values),'p50':round(statistics.median(values),3),'p95':round(sorted(values)[max(0,math.ceil(len(values)*.95)-1)],3),'max':round(max(values),3)} for path,values in observations.items()}
            save()
            # 60 requests per project per round stays below the existing 240/minute quota.
            while time.monotonic()<min(began+60,deadline):time.sleep(max(0,min(1,min(began+60,deadline)-time.monotonic())))
    report['phase']='preservation';after=fingerprint();assert before==after
    report['allBusinessRowsUnchanged']=True;report['businessFingerprintSha256']=hashlib.sha256(json.dumps(after,sort_keys=True).encode()).hexdigest();report['observedSeconds']=round(time.monotonic()-started,3);report['completed']=True
except Exception as error:report.update(errorType=type(error).__name__,code='READONLY_SOAK_UNVERIFIED')
finally:
    closed=True
    for client in reversed(clients):
        try:client.logout()
        except Exception:closed=False
    report.update(ownSessionsLoggedOut=closed,finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat());save()
    print(json.dumps({'completed':report['completed'],'rounds':report['rounds'],'requests':report['requests'],'requestFailures':report['requestFailures'],'ownSessionsLoggedOut':closed,'errorType':report.get('errorType'),'reportPath':str(directory/'summary.json')}))
if not report['completed'] or not closed:raise SystemExit(1)
