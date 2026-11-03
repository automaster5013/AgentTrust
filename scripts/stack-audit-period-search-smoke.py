"""Read-only UTC audit-period search compared against disposable fixture PostgreSQL."""
import argparse,datetime,json,pathlib,subprocess,uuid
from stack_test_client import StackClient
from stack_business_fingerprint import fingerprint,sql
ROOT=pathlib.Path(__file__).resolve().parent.parent
p=argparse.ArgumentParser();p.add_argument('--execute',action='store_true');args=p.parse_args()
if not args.execute:raise SystemExit('Explicit --execute required; use disposable hosted fixtures only.')
report={'completed':False,'businessDataWrites':False,'paidApiCalls':False,'credentialsRecorded':False,'actualOperatingDeploymentPerformed':False,'checks':[]};clients=[]
def verify(value,user,start,end,actor,filters,token):
 code="import {readFileSync} from 'node:fs';import {auditPeriod,auditPeriodSearchPage} from './apps/console/src/lib/audit-period-search.ts';const v=JSON.parse(readFileSync(0,'utf8'));const p=auditPeriod(v.start,v.end,v.actor,v.filters);const rows=await auditPeriodSearchPage(v.page,v.user,p,v.token);console.log(JSON.stringify({ids:rows.entries.map(x=>x.id),nextCursor:rows.nextCursor}));"
 result=subprocess.run(['node','--experimental-strip-types','--input-type=module','-e',code],cwd=ROOT,input=json.dumps({'page':value,'user':user,'start':start,'end':end,'actor':actor,'filters':filters,'token':token}),capture_output=True,text=True,encoding='utf-8',timeout=20,check=True);return json.loads(result.stdout)
try:
 before=fingerprint();assert len(before)==21,'Disposable hosted schema required; operating historical schema must not be used'
 credentials=json.loads((ROOT/'.local/stack/demo-credentials.json').read_text(encoding='utf-8'));anonymous=StackClient('http://127.0.0.1:4320',[],report,clients)
 today=datetime.datetime.now(datetime.timezone.utc).date();start=end=today.isoformat();tomorrow=(today+datetime.timedelta(days=1)).isoformat()
 base='audit-period-search/'+start+'/'+end+'/all/all/all';anonymous.request(base,expected=401)
 viewer=StackClient(anonymous.base,credentials,report,clients);user=viewer.login('demo-viewer');admin=StackClient(anonymous.base,credentials,report,clients);admin_user=admin.login('demo-admin');foreign=StackClient(anonymous.base,credentials,report,clients);foreign_user=foreign.login('other-admin')
 scoped="organization_id='"+str(uuid.UUID(user['organizationId']))+"' AND project_id='"+str(uuid.UUID(user['projectId']))+"'"
 supported=viewer.request('audit-search/version.agents.retired/all');entry=supported['entries'][0];actor=str(uuid.UUID(entry['actorId']));resource=str(uuid.UUID(entry['resourceId']));action='version.agents.retired';total_rows=total_pages=0;first_period=None
 cases=[(start,end,None,None,None),(start,end,actor,None,None),(start,end,actor,action,resource),('1970-01-01','1970-01-01',None,None,None)]
 for a,b,who,kind,target in cases:
  report['phase']='sql-and-api-period-comparison';exclusive=(datetime.date.fromisoformat(b)+datetime.timedelta(days=1)).isoformat();where=scoped+" AND created_at>='"+a+"T00:00:00Z'::timestamptz AND created_at<'"+exclusive+"T00:00:00Z'::timestamptz"
  if who:where+=" AND actor_id='"+who+"'"
  if kind:where+=" AND action='"+kind+"'"
  if target:where+=" AND resource_id='"+target+"'"
  expected=sql('SELECT id FROM stack_audit WHERE '+where+' ORDER BY created_at DESC,id DESC;').splitlines();seen=[];token=None;path='audit-period-search/'+a+'/'+b+'/'+(who or 'all')+'/'+(kind or 'all')+'/'+(target or 'all');pages=0
  for _ in range(100):
   value=viewer.request(path+('/'+token if token else ''));checked=verify(value,user,a,b,who,{'action':kind,'resourceId':target},token);seen+=checked['ids'];token=checked['nextCursor'];pages+=1
   if first_period is None:first_period=value
   if token is None:break
  else:raise AssertionError('Fixture period exceeds bounded pages')
  assert seen==expected;total_rows+=len(seen);total_pages+=pages
  if who is None and a==start:assert len(seen)>=502 and pages>=21,'Real multi-page date range required'
 report['checks'].append('date-only, actor and exact action/resource combinations match all independent scoped SQL IDs and order across real pages')
 report['phase']='negative-period-boundaries';token=first_period['nextCursor'];assert token
 viewer.request('audit-period-search/'+start+'/'+tomorrow+'/all/all/all/'+token,expected=400)
 viewer.request('audit-period-search/'+start+'/'+end+'/'+actor+'/all/all/'+token,expected=400)
 foreign.request(base+'/'+token,expected=400);foreign_page=foreign.request(base);verify(foreign_page,foreign_user,start,end,None,{'action':None,'resourceId':None},None);assert not foreign_page['entries']
 legacy=viewer.request('audit-search/all/all')['nextCursor'];viewer.request(base+'/'+legacy,expected=400)
 for a,b in [('2023-02-29','2023-03-01'),(tomorrow,start),('2024-01-01','2025-01-01')]:viewer.request('audit-period-search/'+a+'/'+b+'/all/all/all',expected=400)
 admin_page=admin.request(base);verify(admin_page,admin_user,start,end,None,{'action':None,'resourceId':None},None);assert [x['id'] for x in admin_page['entries']]==[x['id'] for x in first_period['entries']]
 report['checks'].append('changed dates/actor/tenant and legacy schema cursors, invalid calendar/reversed/over366 days are rejected; administrator reads same scoped page')
 assert fingerprint()==before;report.update(completed=True,businessTablesUnchanged=21,searchesCompared=len(cases),rowsCompared=total_rows,pagesCompared=total_pages,actualMultiPageDateSearch=True)
except Exception as error:report.update(errorType=type(error).__name__,code='AUDIT_PERIOD_SEARCH_UNVERIFIED')
finally:
 closed=True
 for client in reversed(clients):
  try:client.logout()
  except Exception:closed=False
 report['ownSessionsLoggedOut']=closed;report['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();path=ROOT/'.local'/('stack-audit-period-search-'+str(uuid.uuid4())+'.json');path.open('x',encoding='utf-8').write(json.dumps(report,indent=2)+'\n');print(json.dumps({'completed':report['completed'],'errorType':report.get('errorType'),'phase':report.get('phase'),'ownSessionsLoggedOut':closed,'reportPath':str(path)}))
if not report['completed'] or not closed:raise SystemExit(1)
