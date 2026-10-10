"""Own Collector interruption must not manufacture permissions or prevent durable evaluation."""
import datetime,json,pathlib,subprocess,sys,time,traceback,uuid
from stack_test_client import StackClient

root=pathlib.Path(__file__).resolve().parent.parent
report={'completed':False,'checks':[],'credentialsRecorded':False,'paidApiCalls':False,
        'actualDeploymentPerformed':False,'legacyServicesChanged':False,
        'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
clients=[];stopped=False;stage='collector-identity'

def command(args,timeout=45):
    return subprocess.run(args,cwd=root,capture_output=True,text=True,
                          encoding='utf-8',errors='replace',timeout=timeout)

def restore():
    assert command(['docker','start','agenttrust-stack-otel-1']).returncode==0
    until=time.monotonic()+35
    while time.monotonic()<until:
        probe=command(['docker','exec','agenttrust-stack-ai-worker-1','python','-c',
            "import urllib.request; urllib.request.urlopen('http://stack-otel:13133/',timeout=2).read(4096)"])
        if probe.returncode==0:return
        time.sleep(.5)
    raise AssertionError('Collector recovery unavailable')

def terminal(client,record):
    until=time.monotonic()+35
    while record['state']=='queued' and time.monotonic()<until:
        time.sleep(.4);record=client.request('runs/'+record['id'])
    assert record['state']=='succeeded'
    return record

try:
    state=json.loads(command(['docker','inspect','agenttrust-stack-otel-1']).stdout)[0]
    assert state['State']['Running'] and state['Config']['Labels']['com.docker.compose.project']=='agenttrust'
    assert state['Config']['Labels']['com.docker.compose.service']=='stack-otel'
    credentials=json.loads((root/'.local/stack/demo-credentials.json').read_text(encoding='utf-8'))
    admin=StackClient('http://127.0.0.1:4320',credentials,report,clients);admin.login('demo-admin')
    stage='collector-interruption';stopped=True
    assert command(['docker','stop','--time','15','agenttrust-stack-otel-1']).returncode==0
    records={}
    for scenario in ['pass','block']:
        stage='evaluation-without-collector-'+scenario
        record=terminal(admin,admin.request('runs','POST',{'scenario':scenario,'requiresApproval':True},
                            {'Idempotency-Key':str(uuid.uuid4())}))
        assert record['decision']==scenario and record['result']['executionEngine']=='python-synthetic'
        gate=admin.request('runs/'+record['id']+'/gate')
        assert gate['policyStatus']=='evaluated' and not gate['deploymentAllowed'] and not gate['signed']
        records[scenario]=record
    report['checks'].append('actual durable pass and required block evaluations finish without Collector; both initially deny pending approval')
    stage='current-policy-without-collector'
    admin.request('runs/'+records['block']['id']+'/reviews','POST',
                  {'decision':'approved','reason':'Required failure cannot be overridden'},expected=409)
    assert not admin.request('runs/'+records['block']['id']+'/gate')['deploymentAllowed']
    admin.request('runs/'+records['pass']['id']+'/reviews','POST',
                  {'decision':'approved','reason':'Bound current approval independent of telemetry'})
    assert admin.request('runs/'+records['pass']['id']+'/gate')['deploymentAllowed']
    admin.request('runs/'+records['pass']['id']+'/reviews','POST',
                  {'decision':'rejected','reason':'Current rejection must still win without telemetry'})
    assert not admin.request('runs/'+records['pass']['id']+'/gate')['deploymentAllowed']
    report['checks'].append('Collector outage cannot override required failure; current administrator approval then rejection remain policy-bound')
    stage='collector-recovery';restore();stopped=False
    assert not admin.request('runs/'+records['pass']['id']+'/gate')['deploymentAllowed']
    assert not admin.request('runs/'+records['block']['id']+'/gate')['deploymentAllowed']
    report['checks'].append('restored Collector leaves both current rejections unchanged')
    stage='fresh-parent-chain'
    proof=command([sys.executable,'scripts/stack-queue-trace-smoke.py'],timeout=130)
    assert proof.returncode==0
    trace=json.loads(proof.stdout)
    assert trace['completed'] and trace['checks']==3
    report['freshQueueTraceReport']=pathlib.Path(trace['reportPath']).name
    report['checks'].append('new evaluation after recovery exports an actual Java producer / Python consumer / Java completion parent chain')
    report['completed']=True
except Exception as error:
    report.update(code='OBSERVABILITY_OUTAGE_UNVERIFIED',failedStage=stage,errorType=type(error).__name__,failureLocations=[{'file':pathlib.Path(item.filename).name,'line':item.lineno} for item in traceback.extract_tb(error.__traceback__)])
finally:
    restored=not stopped
    if stopped:
        try:restore();restored=True
        except Exception:restored=False
    closed=True
    for client in reversed(clients):
        try:client.logout()
        except Exception:closed=False
    report.update(collectorRestored=restored,ownSessionsLoggedOut=closed,
                  finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
    path=root/'.local'/('stack-observability-outage-'+str(uuid.uuid4())+'.json')
    path.open('x',encoding='utf-8').write(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'completed':report['completed'],'checks':len(report['checks']),
                      'collectorRestored':restored,'ownSessionsLoggedOut':closed,
                      'failedStage':report.get('failedStage'),'reportPath':str(path)}))
    if not report['completed'] or not restored or not closed:raise SystemExit(1)
