"""A cancelled baseline cannot be approved away by a successful candidate; own fixtures only."""
import datetime,json,pathlib,secrets,subprocess,time,uuid
from stack_compose import stack_compose
from stack_business_fingerprint import sql
from stack_test_client import StackClient
ROOT=pathlib.Path(__file__).resolve().parent.parent;clients=[];stopped=False
report={'completed':False,'checks':[],'credentialsRecorded':False,'paidProviderCalled':False,'actualDeploymentPerformed':False,'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
def command(args):
    value=subprocess.run(args,cwd=ROOT,capture_output=True,text=True,encoding='utf-8',timeout=90)
    assert value.returncode==0;return value.stdout
def restore():command(stack_compose(ROOT)+['up','-d','--no-build','--no-deps','--wait','stack-ai-worker'])
try:
    assert sql("SELECT count(*) FROM stack_runs r LEFT JOIN stack_run_results c ON c.run_id=r.id WHERE r.state='queued' AND c.run_id IS NULL;")=='0'
    state=json.loads(command(['docker','inspect','agenttrust-stack-ai-worker-1']))[0]
    assert state['Config']['Labels']['com.docker.compose.project']=='agenttrust' and state['Config']['Labels']['com.docker.compose.service']=='stack-ai-worker'
    credentials=json.loads((ROOT/'.local/stack/demo-credentials.json').read_text(encoding='utf-8'))
    admin=StackClient('http://127.0.0.1:4320',credentials,report,clients);user=admin.login('demo-admin');suffix=uuid.uuid4().hex[:12]
    agent=admin.request('versions/agents','POST',{'key':'unresolved-agent-'+suffix,'version':1,'provider':'synthetic','description':'Cancelled baseline does not grant release'})
    dataset=admin.request('versions/datasets','POST',{'key':'unresolved-data-'+suffix,'version':1,'cases':[{'id':'required','scenario':'pass','required':True}]})
    body={'agentVersionId':agent['id'],'datasetVersionId':dataset['id'],'requiresApproval':True}
    stopped=True;command(['docker','stop','agenttrust-stack-ai-worker-1'])
    baseline=admin.request('campaigns','POST',body,{'Idempotency-Key':str(uuid.uuid4())});assert baseline['state']=='queued'
    baseline=admin.request('campaigns/'+baseline['id']+'/cancel','POST',{'reason':'Own unresolved baseline fixture'})
    assert baseline['state']=='failed' and baseline['decision']=='inconclusive';cancelled=admin.request('runs/'+baseline['cases'][0]['runId']);assert cancelled['result']['executionEngine']=='java-cancelled'
    restore();stopped=False
    candidate=admin.request('campaigns','POST',{**body,'baselineCampaignId':baseline['id'],'evidenceMaxAgeSeconds':3600},{'Idempotency-Key':str(uuid.uuid4())})
    until=time.monotonic()+35
    while candidate['state']=='queued' and time.monotonic()<until:time.sleep(.4);candidate=admin.request('campaigns/'+candidate['id'])
    assert candidate['state']=='succeeded' and candidate['decision']=='pass'
    requirements=admin.request('campaigns/'+candidate['id']+'/release-requirements');assert requirements['comparison']['status']=='inconclusive' and requirements['comparison']['unresolvedRequiredCases']==['required']
    admin.request('campaigns/'+candidate['id']+'/reviews','POST',{'decision':'approved','reason':'Successful candidate cannot override cancelled baseline'})
    gate=admin.request('campaigns/'+candidate['id']+'/gate');assert gate['policyStatus']=='evaluated' and gate['decision']=='inconclusive' and not gate['deploymentAllowed']
    assert admin.request('runs/'+baseline['cases'][0]['runId'])==cancelled
    report['checks'].append('actual worker interruption and cancellation freeze unresolved baseline; successful Python candidate and fresh admin approval remain inconclusive')
    until=time.monotonic()+20
    while time.monotonic()<until:
        try:
            neighbors=admin.request('runs/'+candidate['cases'][0]['runId']+'/similar');assert neighbors['searchEngine']=='pgvector-cosine';break
        except AssertionError:
            assert report.get('unexpectedHttpStatus')==409
            for key in ['unexpectedHttpStatus','expectedHttpStatus','responseCode']:report.pop(key,None)
            time.sleep(.5)
    else:raise AssertionError('Valid feature indexing did not progress after cancellation')
    report['checks'].append('cancelled evidence stays unchanged while later valid completion becomes searchable through actual Python features and pgvector')
    report.update(completed=True,baselineCampaignId=baseline['id'],candidateCampaignId=candidate['id'])
except Exception as error:report.update(code='UNRESOLVED_BASELINE_UNVERIFIED',errorType=type(error).__name__)
finally:
    restored=True
    if stopped:
        try:restore()
        except Exception:restored=False
    closed=True
    for client in reversed(clients):
        try:client.logout()
        except Exception:closed=False
    report.update(workerRestored=restored,ownSessionsLoggedOut=closed,finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
    path=ROOT/'.local'/('stack-baseline-unresolved-'+str(uuid.uuid4())+'.json');path.open('x',encoding='utf-8').write(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'completed':report['completed'],'checks':len(report['checks']),'workerRestored':restored,'ownSessionsLoggedOut':closed,'unexpectedHttpStatus':report.get('unexpectedHttpStatus'),'errorType':report.get('errorType'),'reportPath':str(path)}))
if not report['completed'] or not restored or not closed:raise SystemExit(1)
