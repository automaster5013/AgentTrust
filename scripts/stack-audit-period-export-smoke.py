"""Read-only paginated metadata export beyond latest500; disposable hosted fixture only."""
if not __debug__:
    raise SystemExit("Audit period export smoke test requires Python assertions to be enabled")

import os,argparse,datetime,hashlib,json,pathlib,subprocess,uuid
from stack_test_client import StackClient
from stack_business_fingerprint import fingerprint,sql
ROOT=pathlib.Path(__file__).resolve().parent.parent
p=argparse.ArgumentParser();p.add_argument('--execute',action='store_true');args=p.parse_args()
if not args.execute:raise SystemExit('Explicit --execute required; hosted fixture only.')
report={'completed':False,'businessDataWrites':False,'paidApiCalls':False,'credentialsRecorded':False,'actualOperatingDeploymentPerformed':False,'checks':[]};clients=[]
def verify(frame,user,start,end,actor,filters,token):
 raw=frame['contentJson'].encode('utf-8');assert len(raw)==frame['contentBytes']<=262144 and hashlib.sha256(raw).hexdigest()==frame['contentSha256']
 code="import {readFileSync} from 'node:fs';import {auditPeriod} from './apps/console/src/lib/audit-period-search.ts';import {auditPeriodExportChunk} from './apps/console/src/lib/audit-period-export.ts';const v=JSON.parse(readFileSync(0,'utf8'));const p=auditPeriod(v.start,v.end,v.actor,v.filters);const checked=await auditPeriodExportChunk(v.frame,v.user,p,v.token);const doc=JSON.parse(checked.contentJson);console.log(JSON.stringify({ids:doc.entries.map(x=>x.id),nextCursor:checked.nextCursor}));"
 result=subprocess.run(['node','--experimental-strip-types','--input-type=module','-e',code],cwd=ROOT,input=json.dumps({'frame':frame,'user':user,'start':start,'end':end,'actor':actor,'filters':filters,'token':token}),capture_output=True,text=True,encoding='utf-8',timeout=20,check=True);doc=json.loads(frame['contentJson']);assert doc['entireProjectHistory'] is False and doc['singleStatementSnapshot'] is True and doc['signed'] is False and doc['currentDeploymentAuthority'] is False;return json.loads(result.stdout)
try:
 before=fingerprint();expected_tables=18 if os.getenv("GITHUB_ACTIONS")=="true" and os.getenv("AGENTTRUST_AUDIT_V17_FIXTURE")=="1" else 21;assert len(before)==expected_tables,'Disposable hosted schema required'
 credentials=json.loads((ROOT/'.local/stack/demo-credentials.json').read_text(encoding='utf-8'));anonymous=StackClient('http://127.0.0.1:4320',[],report,clients);today=datetime.datetime.now(datetime.timezone.utc).date();start=end=today.isoformat();tomorrow=(today+datetime.timedelta(days=1)).isoformat();base='audit-period-export/'+start+'/'+end+'/all/all/all';anonymous.request(base,expected=401)
 viewer=StackClient(anonymous.base,credentials,report,clients);user=viewer.login('demo-viewer');admin=StackClient(anonymous.base,credentials,report,clients);admin_user=admin.login('demo-admin');foreign=StackClient(anonymous.base,credentials,report,clients);foreign_user=foreign.login('other-admin');scope="organization_id='"+str(uuid.UUID(user['organizationId']))+"' AND project_id='"+str(uuid.UUID(user['projectId']))+"'"
 entry=viewer.request('audit-search/version.agents.retired/all')['entries'][0];actor=str(uuid.UUID(entry['actorId']));resource=str(uuid.UUID(entry['resourceId']));first=None;total_rows=total_files=0
 cases=[(start,end,None,None,None),(start,end,actor,None,None),(start,end,actor,'version.agents.retired',resource),('1970-01-01','1970-01-01',None,None,None)]
 for a,b,who,kind,target in cases:
  report['phase']='export-chunks-and-independent-sql';exclusive=(datetime.date.fromisoformat(b)+datetime.timedelta(days=1)).isoformat();where=scope+" AND created_at>='"+a+"T00:00:00Z'::timestamptz AND created_at<'"+exclusive+"T00:00:00Z'::timestamptz"
  if who:where+=" AND actor_id='"+who+"'"
  if kind:where+=" AND action='"+kind+"'"
  if target:where+=" AND resource_id='"+target+"'"
  expected=sql('SELECT id FROM stack_audit WHERE '+where+' ORDER BY created_at DESC,id DESC;').splitlines();seen=[];token=None;path='audit-period-export/'+a+'/'+b+'/'+(who or 'all')+'/'+(kind or 'all')+'/'+(target or 'all');files=0
  for _ in range(40):
   frame=viewer.request(path+('/'+token if token else ''));checked=verify(frame,user,a,b,who,{'action':kind,'resourceId':target},token);seen+=checked['ids'];files+=1;token=checked['nextCursor']
   if first is None:first=frame
   if token is None:break
  else:raise AssertionError('Fixture export exceeded40 bounded chunks')
  assert seen==expected;total_rows+=len(seen);total_files+=files
  if a==start and who is None:assert len(seen)>500 and files>=3;report['actualMoreThan500Exported']=True
 report['phase']='changed-boundary-and-tenant-rejection';doc=json.loads(first['contentJson']);token=doc['nextCursor'];assert token and doc['hasOlderRecords']
 viewer.request('audit-period-export/'+start+'/'+tomorrow+'/all/all/all/'+token,expected=400);viewer.request('audit-period-export/'+start+'/'+end+'/'+actor+'/all/all/'+token,expected=400);foreign.request(base+'/'+token,expected=400)
 other=foreign.request(base);checked=verify(other,foreign_user,start,end,None,{'action':None,'resourceId':None},None);assert checked['ids']==[]
 admin_frame=admin.request(base);assert admin_frame==first;verify(admin_frame,admin_user,start,end,None,{'action':None,'resourceId':None},None)
 assert fingerprint()==before;report.update(completed=True,businessTablesUnchanged=expected_tables,searchesCompared=len(cases),rowsCompared=total_rows,filesCompared=total_files,maximumChunkRecords=250,multipleFilesAreNotSingleSnapshot=True)
 report['checks'].append('actual more-than500 metadata records exported across bounded hash-verified chunks equal independent scoped SQL order with date/actor/action/resource and empty ranges')
 report['checks'].append('changed cursor dates/actor/tenant rejected, foreign range empty and administrator exact first file matches; original business bytes unchanged')
except Exception as error:report.update(errorType=type(error).__name__,code='AUDIT_PERIOD_EXPORT_UNVERIFIED')
finally:
 closed=True
 for client in reversed(clients):
  try:client.logout()
  except Exception:closed=False
 report['ownSessionsLoggedOut']=closed;report['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();path=ROOT/'.local'/('stack-audit-period-export-'+str(uuid.uuid4())+'.json');path.open('x',encoding='utf-8').write(json.dumps(report,indent=2)+'\n');print(json.dumps({'completed':report['completed'],'errorType':report.get('errorType'),'phase':report.get('phase'),'ownSessionsLoggedOut':closed,'reportPath':str(path)}))
if not report['completed'] or not closed:raise SystemExit(1)
