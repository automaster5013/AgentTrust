"""Read-only reservation usage through real OIDC and scoped PostgreSQL counts."""
import datetime,json,pathlib,subprocess,uuid
from stack_test_client import StackClient
ROOT=pathlib.Path(__file__).resolve().parent.parent
report={'completed':False,'checks':[],'businessDataWrites':False,'paidApiCalls':False,'billableUsageMeasured':False,'credentialsRecorded':False};clients=[]
def db(query):
    p=subprocess.run(['docker','exec','-i','agenttrust-stack-db-1','psql','-U','agenttrust_stack','-d','agenttrust_stack','-At','-v','ON_ERROR_STOP=1'],input=query,text=True,encoding='utf-8',capture_output=True,cwd=ROOT,timeout=20,check=True);return p.stdout.strip()
try:
    anonymous=StackClient('http://127.0.0.1:4320',[],report,clients);anonymous.request('provider-usage',expected=401)
    credentials=json.loads((ROOT/'.local/stack/demo-credentials.json').read_text(encoding='utf-8'))
    for name in ['demo-admin','demo-viewer','other-admin']:
        client=StackClient(anonymous.base,credentials,report,clients);user=client.login(name);value=client.request('provider-usage')
        code="""import {readFileSync} from 'node:fs';import {providerUsage} from './apps/console/src/lib/provider-usage.ts';const v=JSON.parse(readFileSync(0,'utf8'));const p=providerUsage(v.value,v.user);console.log(JSON.stringify(p));"""
        p=subprocess.run(['node','--experimental-strip-types','--input-type=module','-e',code],cwd=ROOT,input=json.dumps({'value':value,'user':user}),capture_output=True,text=True,encoding='utf-8',timeout=15,check=True);checked=json.loads(p.stdout)
        org=str(uuid.UUID(user['organizationId']));project=str(uuid.UUID(user['projectId']));day=checked['budgetDay'];assert datetime.date.fromisoformat(day).isoformat()==day
        where="a.organization_id='"+org+"' AND a.project_id='"+project+"' AND a.budget_day='"+day+"'::date"
        expected={row.split('|')[0]:[int(x) for x in row.split('|')[1:]] for row in db("SELECT a.provider,count(*),count(*) FILTER(WHERE c.state='succeeded'),count(*) FILTER(WHERE c.state='failed'),count(*) FILTER(WHERE c.run_id IS NULL) FROM stack_provider_attempts a LEFT JOIN stack_run_results c ON c.run_id=a.run_id WHERE "+where+" GROUP BY a.provider").splitlines() if row}
        for provider in checked['providers']:
            assert [provider[k] for k in ['reservedAttempts','succeededRuns','failedRuns','pendingRuns']]==expected.get(provider['provider'],[0,0,0,0])
        assert checked['remainingAttempts']==100-checked['reservedAttempts']
        client.request('provider-usage','POST',{},expected=502)
        report['checks'].append(name+' independently verifies own scoped immutable reservation counts and read-only route')
    assert db("SELECT count(*) FROM stack_provider_attempts WHERE provider='synthetic'")=='0'
    report['checks'].append('synthetic evaluations have no provider reservation entries')
    report['completed']=True
except Exception as error:report.update(errorType=type(error).__name__,code='PROVIDER_USAGE_UNVERIFIED')
finally:
    closed=True
    for client in reversed(clients):
        try:client.logout()
        except Exception:closed=False
    report.update(ownSessionsLoggedOut=closed,finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
    path=ROOT/'.local'/('stack-provider-usage-'+str(uuid.uuid4())+'.json')
    with path.open('x',encoding='utf-8') as stream:stream.write(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'completed':report['completed'],'checks':len(report['checks']),'errorType':report.get('errorType'),'unexpectedHttpStatus':report.get('unexpectedHttpStatus'),'ownSessionsLoggedOut':closed,'reportPath':str(path)}))
if not report['completed'] or not closed:raise SystemExit(1)
