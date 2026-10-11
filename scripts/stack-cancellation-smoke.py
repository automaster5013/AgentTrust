"""Real scoped cancellation; only bounded synthetic fixtures, worker restored in finally."""
import datetime,json,pathlib,subprocess,time,urllib.request,urllib.error,uuid
from stack_test_client import StackClient
ROOT=pathlib.Path(__file__).resolve().parent.parent
report={'completed':False,'checks':[],'paidApiCalls':False,'credentialsRecorded':False,'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
clients=[];stopped=False
def docker(*args):
    return subprocess.run(['docker',*args],cwd=ROOT,text=True,capture_output=True,timeout=35,check=True).stdout
def db(sql):return docker('exec','-i','agenttrust-stack-db-1','psql','-U','agenttrust_stack','-d','agenttrust_stack','-At','-c',sql).strip()
def callback(scope,run,result,expected=200,extra=None,path='completions'):
    body={'runId':run['id'],'organizationId':scope['organizationId'],'projectId':scope['projectId'],'scenario':run['scenario'],'provider':run['provider'],**(extra or {})}
    if path=='completions':body['result']=result
    token=(ROOT/'.local/stack/worker-token').read_text(encoding='utf-8')
    request=urllib.request.Request('http://127.0.0.1:4321/internal/'+path,data=json.dumps(body).encode(),headers={'Content-Type':'application/json','X-AgentTrust-Worker-Token':token},method='POST')
    try:response=urllib.request.urlopen(request,timeout=15)
    except urllib.error.HTTPError as error:response=error
    with response:
        assert response.status==expected;raw=response.read(65537);assert len(raw)<=65536
    return json.loads(raw) if raw else None
def create(client,provider='synthetic'):
    return client.request('runs','POST',{'scenario':'pass','requiresApproval':True,'provider':provider},{'Idempotency-Key':str(uuid.uuid4())})
def cancelled(record):assert record['state']=='failed' and record['decision']=='inconclusive' and record['result']['executionEngine']=='java-cancelled'
try:
    credentials=json.loads((ROOT/'.local/stack/demo-credentials.json').read_text(encoding='utf-8'))
    admin=StackClient('http://127.0.0.1:4320',credentials,report,clients);scope=admin.login('demo-admin')
    editor=StackClient(admin.base,credentials,report,clients);editor.login('demo-editor')
    viewer=StackClient(admin.base,credentials,report,clients);viewer.login('demo-viewer')
    foreign=StackClient(admin.base,credentials,report,clients);foreign.login('other-admin')
    assert db("SELECT count(*) FROM stack_runs r LEFT JOIN stack_run_results c ON c.run_id=r.id WHERE c.run_id IS NULL AND r.created_at>now()-interval '2 minutes'")=="0"
    assert json.loads(docker('inspect','agenttrust-stack-ai-worker-1'))[0]['State']['Running'] is True
    docker('stop','--time','10','agenttrust-stack-ai-worker-1');stopped=True
    report['phase']='single-run'
    run=create(admin);path='runs/'+run['id']+'/cancel'
    viewer.request(path,'POST',{'reason':'viewer'},expected=403)
    foreign.request(path,'POST',{'reason':'foreign'},expected=404)
    editor.request(path,'POST',{'reason':'non-owner'},expected=403)
    for reason in ['', 'x'*201]:admin.request(path,'POST',{'reason':reason},expected=400)
    done=admin.request(path,'POST',{'reason':'Requested synthetic cancellation'});cancelled(done)
    assert admin.request(path,'POST',{'reason':'Idempotent repeat'})==done
    assert admin.request('runs/'+run['id']+'/gate')['deploymentAllowed'] is False
    result={'state':'succeeded','decision':'pass','executionEngine':'python-synthetic','rules':[{'id':'required-output','required':True,'status':'pass','reason':'Late synthetic protocol fixture'}]}
    assert callback(scope,run,result)['duplicate'] is True
    assert admin.request('runs/'+run['id'])==done
    assert db("SELECT count(*) FROM stack_audit WHERE resource_id='"+run['id']+"' AND action='evaluation.cancelled'")=='1'
    report['checks'].append('scope, owner, viewer, reason bounds, idempotence, late completion and denied gate')
    own=create(editor);cancelled(editor.request('runs/'+own['id']+'/cancel','POST',{'reason':'Own editor cancellation'}))
    model=create(admin,'ollama');cancelled(admin.request('runs/'+model['id']+'/cancel','POST',{'reason':'Cancel before provider reservation'}))
    callback(scope,model,None,expected=404,path='provider-reservations')
    assert db("SELECT count(*) FROM stack_provider_attempts WHERE run_id='"+model['id']+"'")=='0'
    report['checks'].append('editor cancels own run and cancelled model run reserves no budget')
    report['phase']='campaign'
    suffix=uuid.uuid4().hex[:12]
    agent=admin.request('versions/agents','POST',{'key':'cancel-agent-'+suffix,'version':1,'provider':'synthetic','description':'Cancellation integration fixture'})
    dataset=admin.request('versions/datasets','POST',{'key':'cancel-data-'+suffix,'version':1,'cases':[{'id':'completed','scenario':'pass','required':True},{'id':'pending','scenario':'pass','required':True}]})
    campaign=admin.request('campaigns','POST',{'agentVersionId':agent['id'],'datasetVersionId':dataset['id'],'requiresApproval':True},{'Idempotency-Key':str(uuid.uuid4())})
    child=campaign['cases'][0];record=admin.request('runs/'+child['runId'])
    binding={'campaignId':campaign['id'],'caseId':child['caseId'],'agentVersionId':agent['id'],'datasetVersionId':dataset['id'],'executionProfileSha256':agent['definition'].get('executionProfileSha256')}
    callback(scope,record,result,extra=binding);completed=admin.request('runs/'+record['id'])
    admin.request('runs/'+record['id']+'/cancel','POST',{'reason':'Already complete'},expected=409)
    path='campaigns/'+campaign['id']+'/cancel'
    viewer.request(path,'POST',{'reason':'viewer'},expected=403);editor.request(path,'POST',{'reason':'non-owner'},expected=403);foreign.request(path,'POST',{'reason':'foreign'},expected=404)
    done=admin.request(path,'POST',{'reason':'Cancel pending campaign cases'})
    assert done['state']=='failed' and done['decision']=='inconclusive' and all(c['state']!='queued' for c in done['cases'])
    assert admin.request('runs/'+record['id'])==completed
    cancelled(admin.request('runs/'+campaign['cases'][1]['runId']))
    assert admin.request(path,'POST',{'reason':'Repeat'})==done
    assert admin.request('campaigns/'+campaign['id']+'/gate')['deploymentAllowed'] is False
    assert db("SELECT count(*) FROM stack_audit WHERE resource_id='"+campaign['id']+"' AND action='campaign.cancelled'")=='1'
    report['checks'].append('campaign cancels pending children atomically and preserves completed evidence')
    report['runIds']=[run['id'],own['id'],model['id']];report['campaignId']=campaign['id']
    docker('start','agenttrust-stack-ai-worker-1');stopped=False
    until=time.monotonic()+35
    while time.monotonic()<until:
        state=json.loads(docker('inspect','agenttrust-stack-ai-worker-1'))[0]['State']
        if state.get('Health',{}).get('Status')=='healthy':break
        time.sleep(1)
    assert state.get('Health',{}).get('Status')=='healthy'
    time.sleep(3)
    cancelled(admin.request('runs/'+run['id']))
    assert admin.request('runs/'+record['id'])==completed
    report['checks'].append('real worker restored healthy; cancellation and completed evidence retained')
    report['phase']='archive'
    until=time.monotonic()+35
    while time.monotonic()<until:
        try:
            evidence=admin.request('campaigns/'+campaign['id']+'/evidence');break
        except AssertionError:time.sleep(1)
    code="""import {readFileSync} from 'node:fs';
import {verifiedCampaign,verifiedCampaignArchive} from './apps/console/src/lib/campaign-contracts.ts';
const v=JSON.parse(readFileSync(0,'utf8'));const c=await verifiedCampaign(v.record,v.user,v.record.id);
if(c.state!=='failed'||c.decision!=='inconclusive')throw Error('Invalid cancellation');
await verifiedCampaignArchive(v.evidence,v.user,c);console.log('Verified cancelled campaign bytes');"""
    proof=subprocess.run(['node','--experimental-strip-types','--input-type=module','-e',code],cwd=ROOT,input=json.dumps({'record':done,'user':scope,'evidence':evidence}),text=True,encoding='utf-8',capture_output=True,timeout=15)
    assert proof.returncode==0
    report['checks'].append('TypeScript independently verifies actual MinIO cancelled campaign archive bytes')
    report['completed']=True
except Exception as error:report.update(code='CANCELLATION_UNVERIFIED',errorType=type(error).__name__)
finally:
    restored=not stopped
    if stopped:
        try:docker('start','agenttrust-stack-ai-worker-1');restored=True
        except Exception:restored=False
    closed=True
    for client in reversed(clients):
        try:client.logout()
        except Exception:closed=False
    report.update(workerRestored=restored,ownSessionsLoggedOut=closed,finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
    path=ROOT/'.local'/('stack-cancellation-'+str(uuid.uuid4())+'.json')
    with path.open('x',encoding='utf-8') as stream:stream.write(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'completed':report['completed'],'checks':len(report['checks']),'phase':report.get('phase'),'errorType':report.get('errorType'),'unexpectedHttpStatus':report.get('unexpectedHttpStatus'),'workerRestored':restored,'ownSessionsLoggedOut':closed,'reportPath':str(path)}))
if not report['completed'] or not restored or not closed:raise SystemExit(1)
