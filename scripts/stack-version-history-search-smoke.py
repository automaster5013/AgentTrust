"""Read-only exact-name search compared with independent scoped PostgreSQL rows."""
import argparse,base64,datetime,hashlib,json,pathlib,re,struct,subprocess,uuid
from stack_test_client import StackClient
from stack_business_fingerprint import fingerprint,sql
ROOT=pathlib.Path(__file__).resolve().parent.parent
parser=argparse.ArgumentParser();parser.add_argument('--execute',action='store_true');args=parser.parse_args()
if not args.execute:raise SystemExit('Explicit --execute required; use disposable hosted fixtures only.')
report={'completed':False,'businessDataWrites':False,'paidApiCalls':False,'credentialsRecorded':False,'checks':[]};clients=[]
def verify(page,user,kind,key,token):
 code="import {readFileSync} from 'node:fs';import {versionHistorySearchPage} from './apps/console/src/lib/version-history-search.ts';const v=JSON.parse(readFileSync(0,'utf8'));const p=await versionHistorySearchPage(v.page,v.user,v.kind,v.key,v.token);console.log(JSON.stringify({ids:p.entries.map(x=>x.id),nextCursor:p.nextCursor}));"
 result=subprocess.run(['node','--experimental-strip-types','--input-type=module','-e',code],cwd=ROOT,input=json.dumps({'page':page,'user':user,'kind':kind,'key':key,'token':token}),text=True,encoding='utf-8',capture_output=True,timeout=15,check=True);return json.loads(result.stdout)
def boundary(entry,user,kind,key):
 raw=bytearray(63);raw[:3]=b'AGS' if kind=='agents' else b'DTS';raw[3:19]=uuid.UUID(user['organizationId']).bytes;raw[19:35]=uuid.UUID(user['projectId']).bytes
 at=datetime.datetime.fromisoformat(entry['createdAt'].replace('Z','+00:00'));struct.pack_into('>qi',raw,35,int(at.timestamp()),at.microsecond*1000);raw[47:63]=uuid.UUID(entry['id']).bytes
 return base64.urlsafe_b64encode(b'\x01'+hashlib.sha256(('version-resource-key='+key).encode()).digest()+raw).decode().rstrip('=')
try:
 before=fingerprint();anonymous=StackClient('http://127.0.0.1:4320',[],report,clients);anonymous.request('version-history-search/agents/agent-test',expected=401)
 credentials=json.loads((ROOT/'.local/stack/demo-credentials.json').read_text(encoding='utf-8'));admin=StackClient(anonymous.base,credentials,report,clients);user=admin.login('demo-admin');viewer=StackClient(admin.base,credentials,report,clients);viewer_user=viewer.login('demo-viewer');foreign=StackClient(admin.base,credentials,report,clients);foreign_user=foreign.login('other-admin')
 compared=0;row_count=0;page_count=0;multi_page_kinds=set()
 for kind,table in [('agents','stack_agent_versions'),('datasets','stack_dataset_versions')]:
  scope="organization_id='"+str(uuid.UUID(user['organizationId']))+"' AND project_id='"+str(uuid.UUID(user['projectId']))+"'"
  keys=sql('SELECT resource_key FROM '+table+' WHERE '+scope+' GROUP BY resource_key ORDER BY count(*) DESC,resource_key LIMIT 3;').splitlines();assert keys
  absent='missing-'+uuid.uuid4().hex[:16]
  for key in keys+[absent]:
   assert re.fullmatch('[a-z][a-z0-9-]{2,63}',key)
   rows=sql("SELECT id,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') FROM "+table+' WHERE '+scope+" AND resource_key='"+key+"' ORDER BY created_at DESC,id DESC;").splitlines();expected=[x.split('|')[0] for x in rows];times={x.split('|')[0]:datetime.datetime.fromisoformat(x.split('|')[1].replace('Z','+00:00')) for x in rows}
   seen=[];token=None;pages=[];path='version-history-search/'+kind+'/'+key
   for _ in range(100):
    page=viewer.request(path+('/'+token if token else ''));checked=verify(page,viewer_user,kind,key,token);seen+=checked['ids'];pages.append(page);page_count+=1
    for entry in page['entries']:assert datetime.datetime.fromisoformat(entry['createdAt'].replace('Z','+00:00'))==times[entry['id']]
    token=checked['nextCursor']
    if token is None:break
   assert token is None and seen==expected and len(seen)==len(set(seen));
   if len(pages)>1:multi_page_kinds.add(kind)
   compared+=1;row_count+=len(seen)
   other=verify(foreign.request(path),foreign_user,kind,key,None);assert not set(seen)&set(other['ids'])
   if seen:
    edge=boundary(pages[0]['entries'][-1],user,kind,key);checked=verify(admin.request(path+'/'+edge),user,kind,key,edge);assert checked['ids']==expected[len(pages[0]['entries']):len(pages[0]['entries'])+25]
    foreign.request(path+'/'+edge,expected=400);admin.request('version-history-search/'+kind+'/'+absent+'/'+edge,expected=400);admin.request('version-history-search/'+('datasets' if kind=='agents' else 'agents')+'/'+key+'/'+edge,expected=400)
    for entry in [pages[0]['entries'][0],pages[-1]['entries'][-1]]:
     detail=viewer.request('versions/'+kind+'/'+entry['id']);assert detail['resource_key']==key and detail['content_sha256']==entry['contentSha256'] and detail['version']==entry['version'];foreign.request('versions/'+kind+'/'+entry['id'],expected=404)
   admin.request(path,'POST',{},expected=502)
  report['checks'].append(kind+' exact names, empty results, full scoped order, microseconds, cross-tenant/kind/name cursor refusal and immutable detail')
 assert multi_page_kinds=={'agents','datasets'}
 assert fingerprint()==before
 report.update(completed=True,searchesCompared=compared,rowsCompared=row_count,pagesCompared=page_count,scopedDatabaseOrderVerified=True,actualMultiPageKinds=sorted(multi_page_kinds),foreignAndChangedNameBoundariesRejected=True,businessTablesUnchanged=len(before))
except Exception as error:report.update(code='VERSION_HISTORY_SEARCH_UNVERIFIED',errorType=type(error).__name__)
finally:
 closed=True
 for client in reversed(clients):
  try:client.logout()
  except Exception:closed=False
 report.update(ownSessionsLoggedOut=closed,finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat());path=ROOT/'.local'/('stack-version-history-search-'+str(uuid.uuid4())+'.json')
 with path.open('x',encoding='utf-8') as stream:stream.write(json.dumps(report,indent=2)+'\n')
 print(json.dumps({'completed':report['completed'],'searchesCompared':report.get('searchesCompared'),'rowsCompared':report.get('rowsCompared'),'errorType':report.get('errorType'),'unexpectedHttpStatus':report.get('unexpectedHttpStatus'),'ownSessionsLoggedOut':closed,'reportPath':str(path)}))
if not report['completed'] or not closed:raise SystemExit(1)
