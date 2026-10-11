"""Prepare a new synthetic approval, then verify its natural expiry in a separate call."""
import argparse,datetime,json,pathlib,re,time,uuid
from stack_test_client import StackClient

root=pathlib.Path(__file__).resolve().parent.parent
parser=argparse.ArgumentParser(description=__doc__)
mode=parser.add_mutually_exclusive_group(required=True)
mode.add_argument('--prepare',action='store_true')
mode.add_argument('--verify',type=pathlib.Path,metavar='FIXTURE_JSON')
args=parser.parse_args()
report={'completed':False,'prepared':False,'checks':[],'credentialsRecorded':False,
        'databaseClockChanged':False,'reviewCreationTimeChanged':False,'actualDeploymentPerformed':False,
        'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
client=None;stage='fixture'
def instant(value):
    result=datetime.datetime.fromisoformat(value.replace('Z','+00:00'))
    assert result.tzinfo is not None
    return result.astimezone(datetime.timezone.utc)
try:
    if args.prepare:
        directory=root/'.local'/('stack-approval-clock-'+str(uuid.uuid4()));directory.mkdir()
        fixture_path=directory/'fixture.json'
    else:
        fixture_path=args.verify.resolve(strict=True);directory=fixture_path.parent
        assert directory.parent==root/'.local' and re.fullmatch(r'stack-approval-clock-[a-f0-9-]{36}',directory.name)
        assert fixture_path.name=='fixture.json' and not args.verify.is_symlink() and not directory.is_symlink()
        assert 0<fixture_path.stat().st_size<=4096
        fixture=json.loads(fixture_path.read_text(encoding='utf-8'))
        assert set(fixture)=={'runId','reviewId','reviewSequence','createdAt','dueAt','policyVersion','policyDigest'}
        for key in ['runId','reviewId']:assert str(uuid.UUID(fixture[key]))==fixture[key]
        assert type(fixture['reviewSequence']) is int and fixture['reviewSequence']>0
        assert re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+',fixture['policyVersion'])
        assert re.fullmatch(r'sha256:[a-f0-9]{64}',fixture['policyDigest'])
        assert instant(fixture['dueAt'])==instant(fixture['createdAt'])+datetime.timedelta(hours=1)
        stage='natural-clock-deadline'
        assert datetime.datetime.now(datetime.timezone.utc)>=instant(fixture['dueAt'])+datetime.timedelta(seconds=2)
    stage='own-session'
    credentials=json.loads((root/'.local/stack/demo-credentials.json').read_text(encoding='utf-8'))
    client=StackClient('http://127.0.0.1:4321',credentials,report);client.login('demo-admin')
    if args.prepare:
        stage='new-synthetic-evaluation'
        record=client.request('runs','POST',{'scenario':'pass','requiresApproval':True},{'Idempotency-Key':str(uuid.uuid4())})
        until=time.monotonic()+25
        while record['state']=='queued' and time.monotonic()<until:
            time.sleep(.25);record=client.request('runs/'+record['id'])
        assert record['state']=='succeeded' and record['decision']=='pass'
        assert not client.request('runs/'+record['id']+'/gate')['deploymentAllowed']
        client.request('runs/'+record['id']+'/reviews','POST',{'decision':'approved','reason':'Synthetic natural-clock expiry observation'})
        gate=client.request('runs/'+record['id']+'/gate');assert gate['deploymentAllowed'] and gate['policyStatus']=='evaluated'
        review=client.request('runs/'+record['id']+'/reviews')[0]
        created=instant(review['created_at']);age=(datetime.datetime.now(datetime.timezone.utc)-created).total_seconds()
        assert 0<=age<30 and review['decision']=='approved'
        fixture={'runId':record['id'],'reviewId':review['id'],'reviewSequence':review['review_sequence'],
                 'createdAt':created.isoformat(),'dueAt':(created+datetime.timedelta(hours=1)).isoformat(),
                 'policyVersion':gate['policyVersion'],'policyDigest':gate['policyDigest']}
        fixture_path.open('x',encoding='utf-8').write(json.dumps(fixture,indent=2)+'\n')
        report['prepared']=True;report['verificationDueAt']=fixture['dueAt']
        report['checks'].append('a new real approval permits this synthetic run and remains immutable until a later observation')
    else:
        stage='unchanged-review-and-policy'
        review=client.request('runs/'+fixture['runId']+'/reviews')[0]
        assert review['id']==fixture['reviewId'] and review['review_sequence']==fixture['reviewSequence'] and review['decision']=='approved'
        assert instant(review['created_at'])==instant(fixture['createdAt'])
        assert review['policy_version']==fixture['policyVersion'] and review['policy_digest']==fixture['policyDigest']
        report['checks'].append('the same immutable approval is still the latest review without backdating or clock changes')
        gate=client.request('runs/'+fixture['runId']+'/gate')
        assert gate['policyVersion']==fixture['policyVersion'] and gate['policyDigest']==fixture['policyDigest']
        assert gate['policyStatus']=='evaluated' and gate['decision']=='inconclusive' and not gate['deploymentAllowed'] and 'fresh approval' in gate['reason']
        report['checks'].append('the actual current policy refuses permission after one hour of natural elapsed time')
        report['elapsedSeconds']=(datetime.datetime.now(datetime.timezone.utc)-instant(fixture['createdAt'])).total_seconds()
        report['completed']=True
except Exception:
    report['code']='STACK_NATURAL_APPROVAL_EXPIRY_UNVERIFIED';report['failedStage']=stage
finally:
    closed=False
    if client:
        try:client.logout();closed=not client.logged
        except Exception:pass
    report.update(ownSessionLoggedOut=closed,finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
    path=root/'.local'/('stack-approval-expiry-observation-'+str(uuid.uuid4())+'.json')
    path.open('x',encoding='utf-8').write(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'completed':report['completed'],'prepared':report['prepared'],'checks':len(report['checks']),
                     'verificationDueAt':report.get('verificationDueAt'),'ownSessionLoggedOut':closed,
                     'fixturePath':str(fixture_path) if report['prepared'] else None,'reportPath':str(path)}))
    if not (report['completed'] or report['prepared']) or not closed:raise SystemExit(1)
