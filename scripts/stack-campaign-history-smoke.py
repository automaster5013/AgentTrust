"""Read existing campaign history through OIDC/BFF and compare scoped PostgreSQL order."""
import base64,datetime,json,pathlib,struct,subprocess,uuid
from stack_test_client import StackClient
ROOT=pathlib.Path(__file__).resolve().parent.parent
report={'completed':False,'checks':[],'businessDataWrites':False,'paidApiCalls':False,'credentialsRecorded':False};clients=[]
def sql(query):
    result=subprocess.run(['docker','exec','-i','agenttrust-stack-db-1','psql','-U','agenttrust_stack','-d','agenttrust_stack','-At','-v','ON_ERROR_STOP=1'],input=query,cwd=ROOT,capture_output=True,text=True,encoding='utf-8',timeout=20,check=True)
    return result.stdout.strip().splitlines()
def verify(page,user,dataset,token):
    code="""import {readFileSync} from 'node:fs';import {campaignHistoryPage} from './apps/console/src/lib/campaign-history.ts';const v=JSON.parse(readFileSync(0,'utf8'));const p=campaignHistoryPage(v.page,v.user,v.dataset,v.token);console.log(JSON.stringify({ids:p.entries.map(x=>x.id),nextCursor:p.nextCursor}));"""
    result=subprocess.run(['node','--experimental-strip-types','--input-type=module','-e',code],cwd=ROOT,input=json.dumps({'page':page,'user':user,'dataset':dataset,'token':token}),text=True,encoding='utf-8',capture_output=True,timeout=15,check=True)
    return json.loads(result.stdout)
def cursor(entry,user,dataset=None):
    raw=bytearray(80);raw[:3]=b'CMP';raw[3:19]=uuid.UUID(user['organizationId']).bytes;raw[19:35]=uuid.UUID(user['projectId']).bytes;raw[35]=int(dataset is not None)
    if dataset:raw[36:52]=uuid.UUID(dataset).bytes
    at=datetime.datetime.fromisoformat(entry['createdAt'].replace('Z','+00:00'));struct.pack_into('>qi',raw,52,int(at.timestamp()),at.microsecond*1000);raw[64:80]=uuid.UUID(entry['id']).bytes
    return base64.urlsafe_b64encode(raw).decode().rstrip('=')
try:
    anonymous=StackClient('http://127.0.0.1:4320',[],report,clients);anonymous.request('campaign-history',expected=401)
    credentials=json.loads((ROOT/'.local/stack/demo-credentials.json').read_text(encoding='utf-8'))
    admin=StackClient(anonymous.base,credentials,report,clients);user=admin.login('demo-admin')
    org=str(uuid.UUID(user['organizationId']));project=str(uuid.UUID(user['projectId']))
    where="organization_id='"+org+"' AND project_id='"+project+"'"
    expected=sql('SELECT id FROM stack_campaigns WHERE '+where+' ORDER BY created_at DESC,id DESC')
    seen=[];token=None;pages=[]
    for _ in range(9):
        page=admin.request('campaign-history'+('/page/'+token if token else ''));checked=verify(page,user,None,token);seen+=checked['ids'];pages.append(page);token=checked['nextCursor']
        if token is None:break
    assert token is None and seen==expected and len(set(seen))==len(seen) and seen
    report['checks'].append('all existing campaign pages match independent scoped PostgreSQL order and TypeScript verification')
    first=pages[0];boundary=cursor(first['entries'][-1],user)
    viewer=StackClient(admin.base,credentials,report,clients);viewer_user=viewer.login('demo-viewer')
    continued=viewer.request('campaign-history/page/'+boundary);checked=verify(continued,viewer_user,None,boundary)
    assert checked['ids']==expected[len(first['entries']):len(first['entries'])+25]
    foreign=StackClient(admin.base,credentials,report,clients);foreign_user=foreign.login('other-admin');foreign.request('campaign-history/page/'+boundary,expected=400)
    other=verify(foreign.request('campaign-history'),foreign_user,None,None);assert not set(seen)&set(other['ids'])
    report['checks'].append('same-scope viewer navigation and foreign-scope boundary rejection')
    dataset=first['entries'][0]['datasetVersionId'];filtered=admin.request('campaign-history/dataset/'+dataset)
    checked=verify(filtered,user,dataset,None);filtered_expected=sql("SELECT id FROM stack_campaigns WHERE "+where+" AND dataset_version_id='"+str(uuid.UUID(dataset))+"' ORDER BY created_at DESC,id DESC LIMIT 25")
    assert checked['ids']==filtered_expected
    admin.request('campaign-history/dataset/'+dataset+'/page/'+boundary,expected=400)
    filtered_boundary=cursor(filtered['entries'][0],user,dataset);admin.request('campaign-history/page/'+filtered_boundary,expected=400)
    filtered_next=admin.request('campaign-history/dataset/'+dataset+'/page/'+filtered_boundary);verify(filtered_next,user,dataset,filtered_boundary)
    assert not foreign.request('campaign-history/dataset/'+dataset)['entries']
    report['checks'].append('dataset-filtered actual rows and cursor binding; foreign dataset reveals no entries')
    raw=bytearray(base64.urlsafe_b64decode(boundary+'='));raw[:3]=b'BAD';admin.request('campaign-history/page/'+base64.urlsafe_b64encode(raw).decode().rstrip('='),expected=400)
    raw[:3]=b'CMP';struct.pack_into('>i',raw,60,1);admin.request('campaign-history/page/'+base64.urlsafe_b64encode(raw).decode().rstrip('='),expected=400)
    alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';noncanonical=boundary[:-1]+alphabet[alphabet.index(boundary[-1])+1];admin.request('campaign-history/page/'+noncanonical,expected=400)
    admin.request('campaign-history/page/short',expected=502);admin.request('campaign-history','POST',{},expected=502)
    assert admin.request('campaign-history')==first
    report['checks'].append('invalid domain noncanonical encoding microsecond boundary and write route refused')
    report.update(completed=True,rowsCompared=len(seen),pagesCompared=len(pages))
except Exception as error:report.update(code='CAMPAIGN_HISTORY_UNVERIFIED',errorType=type(error).__name__)
finally:
    closed=True
    for client in reversed(clients):
        try:client.logout()
        except Exception:closed=False
    report.update(ownSessionsLoggedOut=closed,finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
    path=ROOT/'.local'/('stack-campaign-history-'+str(uuid.uuid4())+'.json')
    with path.open('x',encoding='utf-8') as stream:stream.write(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'completed':report['completed'],'checks':len(report['checks']),'rowsCompared':report.get('rowsCompared'),'errorType':report.get('errorType'),'unexpectedHttpStatus':report.get('unexpectedHttpStatus'),'ownSessionsLoggedOut':closed,'reportPath':str(path)}))
if not report['completed'] or not closed:raise SystemExit(1)
