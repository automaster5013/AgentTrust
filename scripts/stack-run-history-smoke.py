"""Read existing run pages through OIDC/BFF and independently compare scoped DB order."""
import base64,datetime,json,pathlib,struct,subprocess,uuid
from stack_test_client import StackClient
ROOT=pathlib.Path(__file__).resolve().parent.parent
report={'completed':False,'checks':[],'businessDataWrites':False,'paidApiCalls':False,'credentialsRecorded':False};clients=[]
def sql(query):
    p=subprocess.run(['docker','exec','-i','agenttrust-stack-db-1','psql','-U','agenttrust_stack','-d','agenttrust_stack','-At','-v','ON_ERROR_STOP=1'],input=query,cwd=ROOT,capture_output=True,text=True,encoding='utf-8',timeout=20,check=True)
    return p.stdout.strip()
def verify(value,user,token):
    code="""import {readFileSync} from 'node:fs';import {runHistoryPage} from './apps/console/src/lib/run-history.ts';const v=JSON.parse(readFileSync(0,'utf8'));const p=runHistoryPage(v.page,v.user,v.token);console.log(JSON.stringify({ids:p.entries.map(x=>x.id),nextCursor:p.nextCursor}));"""
    p=subprocess.run(['node','--experimental-strip-types','--input-type=module','-e',code],cwd=ROOT,input=json.dumps({'page':value,'user':user,'token':token}),text=True,encoding='utf-8',capture_output=True,timeout=15,check=True)
    return json.loads(p.stdout)
try:
    anonymous=StackClient('http://127.0.0.1:4320',[],report,clients);anonymous.request('run-history',expected=401)
    credentials=json.loads((ROOT/'.local/stack/demo-credentials.json').read_text(encoding='utf-8'))
    admin=StackClient(anonymous.base,credentials,report,clients);user=admin.login('demo-admin')
    org=str(uuid.UUID(user['organizationId']));project=str(uuid.UUID(user['projectId']))
    # Only identifiers are exported; no results or model text in this DB comparison.
    expected=sql("SELECT id FROM stack_runs WHERE organization_id='"+org+"' AND project_id='"+project+"' ORDER BY created_at DESC,id DESC LIMIT 75").splitlines()
    token=None;seen=[];pages=[]
    for _ in range(3):
        page=admin.request('run-history'+('/'+token if token else ''));checked=verify(page,user,token);seen+=checked['ids'];pages.append(page);token=checked['nextCursor']
        if token is None:break
    assert seen==expected and len(set(seen))==len(seen)
    report['checks'].append('actual first three pages match PostgreSQL order and TypeScript boundary verification')
    first=pages[0];assert first['nextCursor'] is not None
    viewer=StackClient(admin.base,credentials,report,clients);viewer.login('demo-viewer');assert viewer.request('run-history/'+first['nextCursor'])==pages[1]
    foreign=StackClient(admin.base,credentials,report,clients);foreign.login('other-admin');foreign.request('run-history/'+first['nextCursor'],expected=400)
    assert not set(seen)&{row['id'] for row in foreign.request('run-history')['entries']}
    report['checks'].append('viewer reads same scope; foreign organization cannot reuse the boundary')
    raw=bytearray(base64.urlsafe_b64decode(first['nextCursor']));assert len(raw)==63 and raw[:3]==b'RUN'
    raw[:3]=b'BAD';admin.request('run-history/'+base64.urlsafe_b64encode(raw).decode(),expected=400)
    raw[:3]=b'RUN';struct.pack_into('>i',raw,43,1);admin.request('run-history/'+base64.urlsafe_b64encode(raw).decode(),expected=400)
    admin.request('run-history/short',expected=502);admin.request('run-history','POST',{},expected=502)
    report['checks'].append('invalid domain, submicrosecond boundary and write route are refused')
    assert admin.request('run-history')==first
    report.update(completed=True,rowsCompared=len(seen),pagesCompared=len(pages))
except Exception as error:report.update(code='RUN_HISTORY_UNVERIFIED',errorType=type(error).__name__)
finally:
    closed=True
    for client in reversed(clients):
        try:client.logout()
        except Exception:closed=False
    report.update(ownSessionsLoggedOut=closed,finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
    path=ROOT/'.local'/('stack-run-history-'+str(uuid.uuid4())+'.json')
    with path.open('x',encoding='utf-8') as stream:stream.write(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'completed':report['completed'],'checks':len(report['checks']),'rowsCompared':report.get('rowsCompared'),'errorType':report.get('errorType'),'unexpectedHttpStatus':report.get('unexpectedHttpStatus'),'ownSessionsLoggedOut':closed,'reportPath':str(path)}))
if not report['completed'] or not closed:raise SystemExit(1)
