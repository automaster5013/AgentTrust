"""Read-only registry pagination compared with actual scoped PostgreSQL rows."""
import base64,datetime,json,pathlib,struct,subprocess,uuid
from stack_test_client import StackClient
from stack_business_fingerprint import fingerprint,sql
ROOT=pathlib.Path(__file__).resolve().parent.parent
report={'completed':False,'checks':[],'businessDataWrites':False,'paidApiCalls':False,'credentialsRecorded':False};clients=[]

def verify(page,user,kind,token):
 code="import {readFileSync} from 'node:fs';import {versionHistoryPage} from './apps/console/src/lib/version-history.ts';const v=JSON.parse(readFileSync(0,'utf8'));const p=versionHistoryPage(v.page,v.user,v.kind,v.token);console.log(JSON.stringify({ids:p.entries.map(x=>x.id),nextCursor:p.nextCursor}));"
 result=subprocess.run(['node','--experimental-strip-types','--input-type=module','-e',code],cwd=ROOT,input=json.dumps({'page':page,'user':user,'kind':kind,'token':token}),text=True,encoding='utf-8',capture_output=True,timeout=15,check=True)
 return json.loads(result.stdout)

def cursor(entry,user,kind):
 raw=bytearray(63);raw[:3]=b'AGS' if kind=='agents' else b'DTS';raw[3:19]=uuid.UUID(user['organizationId']).bytes;raw[19:35]=uuid.UUID(user['projectId']).bytes
 at=datetime.datetime.fromisoformat(entry['createdAt'].replace('Z','+00:00'));struct.pack_into('>qi',raw,35,int(at.timestamp()),at.microsecond*1000);raw[47:63]=uuid.UUID(entry['id']).bytes
 return base64.urlsafe_b64encode(raw).decode().rstrip('=')

try:
 before=fingerprint();anonymous=StackClient('http://127.0.0.1:4320',[],report,clients);anonymous.request('version-history/agents',expected=401)
 credentials=json.loads((ROOT/'.local/stack/demo-credentials.json').read_text(encoding='utf-8'))
 admin=StackClient(anonymous.base,credentials,report,clients);user=admin.login('demo-admin')
 viewer=StackClient(admin.base,credentials,report,clients);viewer_user=viewer.login('demo-viewer')
 foreign=StackClient(admin.base,credentials,report,clients);foreign_user=foreign.login('other-admin')
 totals={}
 for kind,table in [('agents','stack_agent_versions'),('datasets','stack_dataset_versions')]:
  org=str(uuid.UUID(user['organizationId']));project=str(uuid.UUID(user['projectId']))
  coordinates=sql("SELECT id,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') FROM "+table+" WHERE organization_id='"+org+"' AND project_id='"+project+"' ORDER BY created_at DESC,id DESC;").splitlines()
  expected=[line.split('|',1)[0] for line in coordinates];timestamps={line.split('|',1)[0]:datetime.datetime.fromisoformat(line.split('|',1)[1].replace('Z','+00:00')) for line in coordinates}
  seen=[];token=None;pages=[]
  for _ in range(9):
   page=admin.request('version-history/'+kind+('/'+token if token else ''));checked=verify(page,user,kind,token);seen+=checked['ids'];pages.append(page);token=checked['nextCursor']
   if token is None:break
  assert token is None and seen==expected and len(seen)==len(set(seen)) and seen
  for page in pages:
   for entry in page['entries']:assert datetime.datetime.fromisoformat(entry['createdAt'].replace('Z','+00:00'))==timestamps[entry['id']]
  boundary=cursor(pages[0]['entries'][-1],user,kind)
  other_kind='datasets' if kind=='agents' else 'agents'
  checked=verify(viewer.request('version-history/'+kind+'/'+boundary),viewer_user,kind,boundary);assert checked['ids']==expected[len(pages[0]['entries']):len(pages[0]['entries'])+25]
  foreign.request('version-history/'+kind+'/'+boundary,expected=400);admin.request('version-history/'+other_kind+'/'+boundary,expected=400)
  other=verify(foreign.request('version-history/'+kind),foreign_user,kind,None);assert not set(seen)&set(other['ids'])
  admin.request('version-history/'+kind,'POST',{},expected=502);admin.request('version-history/'+kind+'/short',expected=502)
  raw=bytearray(base64.urlsafe_b64decode(boundary));raw[:3]=b'BAD';admin.request('version-history/'+kind+'/'+base64.urlsafe_b64encode(raw).decode(),expected=400)
  for entry in [pages[0]['entries'][0],pages[-1]['entries'][-1]]:
   detail=viewer.request('versions/'+kind+'/'+entry['id']);assert detail['content_sha256']==entry['contentSha256'] and detail['resource_key']==entry['resourceKey'] and detail['version']==entry['version']
   assert datetime.datetime.fromisoformat(detail['created_at'].replace('Z','+00:00'))==timestamps[entry['id']]
   code="import {readFileSync} from 'node:fs';import {verifyVersionHistoryBinding} from './apps/console/src/lib/version-history.ts';import {verifiedAgentVersion,verifiedDatasetVersion} from './apps/console/src/lib/campaign-contracts.ts';const v=JSON.parse(readFileSync(0,'utf8'));const detail=await (v.kind==='agents'?verifiedAgentVersion:verifiedDatasetVersion)(v.detail,v.user);verifyVersionHistoryBinding({id:v.entry.id,resource_key:v.entry.resourceKey,version:v.entry.version,content_sha256:v.entry.contentSha256,created_at:v.entry.createdAt},detail);"
   subprocess.run(['node','--experimental-strip-types','--input-type=module','-e',code],cwd=ROOT,input=json.dumps({'detail':detail,'entry':entry,'user':viewer_user,'kind':kind}),capture_output=True,text=True,encoding='utf-8',timeout=15,check=True)
   foreign.request('versions/'+kind+'/'+entry['id'],expected=404)
  totals[kind]={'rows':len(seen),'pages':len(pages)}
  report['checks'].append(kind+' full scoped pagination, kind/tenant boundary rejection and actual oldest/newest byte-hash and independent PostgreSQL microsecond verification')
 assert fingerprint()==before
 report.update(completed=True,businessTablesUnchanged=len(before),registries=totals)
except Exception as error:report.update(code='VERSION_HISTORY_UNVERIFIED',errorType=type(error).__name__)
finally:
 closed=True
 for client in reversed(clients):
  try:client.logout()
  except Exception:closed=False
 report.update(ownSessionsLoggedOut=closed,finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
 path=ROOT/'.local'/('stack-version-history-'+str(uuid.uuid4())+'.json')
 with path.open('x',encoding='utf-8') as stream:stream.write(json.dumps(report,indent=2)+'\n')
 print(json.dumps({'completed':report['completed'],'checks':len(report['checks']),'registries':report.get('registries'),'errorType':report.get('errorType'),'unexpectedHttpStatus':report.get('unexpectedHttpStatus'),'ownSessionsLoggedOut':closed,'reportPath':str(path)}))
if not report['completed'] or not closed:raise SystemExit(1)
