"""Conditional review race in isolated CI only; default mode never submits a review."""
import argparse,concurrent.futures,datetime,json,pathlib,subprocess,sys,threading,time,urllib.error,urllib.request,uuid
from stack_test_client import StackClient
ROOT=pathlib.Path(__file__).resolve().parent.parent
parser=argparse.ArgumentParser();parser.add_argument('--allow-synthetic-writes',action='store_true');args=parser.parse_args()
report={'completed':False,'checks':[],'businessWritesPerformed':False,'providerCallsPerformed':False,'credentialsRecorded':False,'isolatedSyntheticWriteMode':args.allow_synthetic_writes};clients=[]

def race_request(client,path,body,barrier):
    barrier.wait(timeout=15)
    request=urllib.request.Request(client.base+client.prefix+path,data=json.dumps(body).encode(),headers={'Content-Type':'application/json','Origin':client.base,'X-CSRF-TOKEN':client.token},method='POST')
    try:response=client.opener.open(request,timeout=15)
    except urllib.error.HTTPError as error:response=error
    with response:status=response.status;raw=response.read(1048577)
    assert status in [200,409] and len(raw)<=1048576
    if status==200:
        receipt=json.loads(raw);assert set(receipt)=={'id','decision'} and receipt['decision']==body['decision'];uuid.UUID(receipt['id'])
    return status

try:
    if args.allow_synthetic_writes:
        assert pathlib.Path('/home/runner/work/AgentTrust/AgentTrust').resolve()==ROOT.resolve(), 'Synthetic writes require the isolated GitHub Actions checkout'
        import os
        assert os.environ.get('GITHUB_ACTIONS')=='true' and os.environ.get('GITHUB_REPOSITORY')=='automaster5013/AgentTrust'
        window=subprocess.run([sys.executable,str(ROOT/'scripts/stack-test-quota-window.py')],cwd=ROOT,capture_output=True,text=True,encoding='utf-8',timeout=75,check=True)
        assert json.loads(window.stdout)=={'naturalQuotaWindowElapsed':True,'quotaLimitsChanged':False,'redisEntriesDeleted':False}
        report['naturalQuotaWindowBeforeFixture']=True
    credentials=json.loads((ROOT/'.local/stack/demo-credentials.json').read_text(encoding='utf-8'))
    admin=StackClient('http://127.0.0.1:4320',credentials,report,clients);admin.login('demo-admin')
    viewer=StackClient('http://127.0.0.1:4320',credentials,report,clients);viewer.login('demo-viewer')
    candidates={}
    for resource in ['runs','campaigns']:
        rows=admin.request(resource);assert rows
        # Viewer-only write probes are independently refused even by a pre-feature server.
        identifier=rows[0]['id'];viewer.request(resource+'/'+identifier+'/reviews','POST',{'decision':'approved','reason':'Unauthorized synthetic guard probe','expectedReviewSequence':0},expected=403)
        report['checks'].append(resource+' viewer cannot submit a conditional review')
    if args.allow_synthetic_writes:
        report['businessWritesPerformed']=True
        run=admin.request('runs','POST',{'scenario':'pass','requiresApproval':True,'provider':'synthetic'},{'Idempotency-Key':str(uuid.uuid4())})
        for _ in range(40):
            run=admin.request('runs/'+run['id'])
            if run['state']!='queued':break
            time.sleep(.5)
        assert run['decision']=='pass';candidates['runs']=run['id']
        for row in admin.request('campaigns'):
            value=admin.request('campaigns/'+row['id'])
            if value['decision']=='pass' and value['agentVersion']['definition']['provider']=='synthetic' and all(v['state']=='active' for v in admin.request('campaigns/'+row['id']+'/version-lifecycle')['versions']):
                campaign=admin.request('campaigns','POST',{'agentVersionId':value['agent_version_id'],'datasetVersionId':value['dataset_version_id'],'requiresApproval':True},{'Idempotency-Key':str(uuid.uuid4())})
                for _ in range(40):
                    campaign=admin.request('campaigns/'+campaign['id'])
                    if campaign['state']!='queued':break
                    time.sleep(.5)
                assert campaign['decision']=='pass';candidates['campaigns']=campaign['id'];break
        assert 'campaigns' in candidates
        second=StackClient('http://127.0.0.1:4320',credentials,report,clients);second.login('demo-admin')
        for resource,identifier in candidates.items():
            path=resource+'/'+identifier+'/reviews';before=admin.request(path+'/page');entries=before['entries'];sequence=entries[0]['review_sequence'] if entries else 0
            invalid=[None,'0',True,0.0,-1,2**53,[],{}]
            for expected in invalid:admin.request(path,'POST',{'decision':'rejected','reason':'Synthetic invalid conditional boundary','expectedReviewSequence':expected},expected=400)
            assert admin.request(path+'/page')==before;report['checks'].append(resource+' rejects null coercion fractions unsafe numbers and malformed preconditions without appending')
            barrier=threading.Barrier(2)
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
                futures=[executor.submit(race_request,client,path,{'decision':decision,'reason':'Isolated synthetic concurrent review','expectedReviewSequence':sequence},barrier) for client,decision in [(admin,'approved'),(second,'rejected')]]
                statuses=sorted(f.result(timeout=25) for f in futures)
            assert statuses==[200,409]
            after=admin.request(path+'/page');added=[row for row in after['entries'] if row['id'] not in {row['id'] for row in entries}]
            assert len(added)==1 and added[0]['review_sequence']>sequence
            admin.request(path,'POST',{'decision':'approved','reason':'Stale isolated approval must not supersede the winner','expectedReviewSequence':sequence},expected=409)
            assert admin.request(path+'/page')==after
            report['checks'].append(resource+' concurrent identical bases admit exactly one review and refuse later stale approval')
            # Fresh explicit submission uses the newly observed winner and remains subject to policy.
            receipt=admin.request(path,'POST',{'decision':'rejected','reason':'Fresh explicit isolated rejection','expectedReviewSequence':added[0]['review_sequence']});assert receipt['decision']=='rejected'
            gate=admin.request(resource+'/'+identifier+'/gate');assert gate['deploymentAllowed'] is False
            report['checks'].append(resource+' explicit fresh basis records rejection and cannot permit release')
    report['completed']=True
except Exception as error:report['errorType']=type(error).__name__
finally:
    closed=True
    for client in clients:
        try:client.logout()
        except Exception:closed=False
    report['ownSessionsClosed']=closed;report['completed']=report['completed'] and closed;report['verifiedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()
    path=ROOT/'.local'/('stack-review-precondition-'+str(uuid.uuid4())+'.json');path.open('x',encoding='utf-8').write(json.dumps(report,indent=2)+'\n');print(json.dumps({'completed':report['completed'],'checks':len(report['checks']),'reportPath':str(path),'errorType':report.get('errorType')}))
if not report['completed']:raise SystemExit(1)
