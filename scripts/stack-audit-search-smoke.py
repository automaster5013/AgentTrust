"""Read-only tenant/filter navigation and browser-contract checks using existing audits."""
if not __debug__:
    raise SystemExit("Audit search smoke test requires Python assertions to be enabled")

import os,json,pathlib,subprocess,uuid
from stack_test_client import StackClient
from stack_business_fingerprint import fingerprint,sql
ROOT=pathlib.Path(__file__).resolve().parent.parent
report={'completed':False,'checks':[],'businessDataWrites':False,'paidProviderCalls':False,'credentialsRecorded':False};clients=[]
def verified(value,user,filters,token=None):
 code="import {readFileSync} from 'node:fs';import {auditSearchPage,auditFilters} from './apps/console/src/lib/audit-search.ts';const v=JSON.parse(readFileSync(0,'utf8'));await auditSearchPage(v.page,v.user,v.filters,v.token);const changed=structuredClone(v.page);changed.filters.resourceId=v.filters.resourceId===null?v.user.actorId:null;let refused=false;try{await auditSearchPage(changed,v.user,v.filters,v.token)}catch{refused=true}if(!refused)throw Error('FILTER_SUBSTITUTION_ACCEPTED');const searchable=v.page.entries.filter(entry=>{try{auditFilters(entry.action,entry.resourceId);return true}catch{return false}});console.log(JSON.stringify({verified:true,changedFiltersRefused:true,searchable}));"
 result=subprocess.run(['node','--experimental-strip-types','--input-type=module','-e',code],input=json.dumps({'page':value,'user':user,'filters':filters,'token':token}),cwd=ROOT,capture_output=True,text=True,encoding='utf-8',timeout=20)
 assert result.returncode==0 and json.loads(result.stdout)['verified']
 return json.loads(result.stdout)['searchable']
try:
 before=fingerprint();expected_tables=18 if os.getenv("GITHUB_ACTIONS")=="true" and os.getenv("AGENTTRUST_AUDIT_V17_FIXTURE")=="1" else 21;anonymous=StackClient('http://127.0.0.1:4320',[],report,clients);anonymous.request('audit-actor-search/'+str(uuid.uuid4())+'/all/all',expected=401);assert len(before)==expected_tables  and ({'stack_project_settings','stack_access_keys','stack_access_key_revocations'}<=before.keys())==(expected_tables==21)
 credentials=json.loads((ROOT/'.local/stack/demo-credentials.json').read_text(encoding='utf-8'))
 viewer=StackClient('http://127.0.0.1:4320',credentials,report,clients);user=viewer.login('demo-viewer')
 first=viewer.request('audit-search/all/all');assert len(first['entries'])==25 and first['nextCursor'];eligible=verified(first,user,{'action':None,'resourceId':None})
 token=first['nextCursor'];second=viewer.request('audit-search/all/all/'+token);eligible+=verified(second,user,{'action':None,'resourceId':None},token);assert not {v['id'] for v in first['entries']}&{v['id'] for v in second['entries']}
 report['checks'].append('viewer verifies two distinct actual keyset pages and their exact microsecond tenant boundary')
 # Export/navigation tests can prepend over 500 unsupported fixture actions.
 # Read a known completed lifecycle event directly; never rewrite that history.
 supported=viewer.request('audit-search/version.agents.retired/all');eligible=verified(supported,user,{'action':'version.agents.retired','resourceId':None})
 assert eligible,'Existing lifecycle smoke must supply a retired agent audit'
 entry=eligible[0];report['selectedAction']=entry['action'];action=entry['action'];resource=entry['resourceId'];filters={'action':action,'resourceId':resource}
 matching=viewer.request('audit-search/'+action+'/'+resource);verified(matching,user,filters);assert matching['entries'] and any(v['id']==entry['id'] for v in matching['entries']) and all(v['action']==action and v['resourceId']==resource for v in matching['entries'])
 viewer.request('audit-search/'+action+'/'+resource+'/'+token,expected=400)
 viewer.request('audit-search/review.deleted/all',expected=400)
 empty=viewer.request('audit-search/all/'+str(uuid.uuid4()));verified(empty,user,{'action':None,'resourceId':empty['filters']['resourceId']});assert empty['entries']==[] and empty['nextCursor'] is None
 report['checks'].append('exact action and resource filtering; changed filters, unknown action and unknown resource cannot broaden the result')
 admin=StackClient('http://127.0.0.1:4320',credentials,report,clients);admin_user=admin.login('demo-admin');verified(admin.request('audit-search/'+action+'/'+resource),admin_user,filters)
 foreign=StackClient('http://127.0.0.1:4320',credentials,report,clients);foreign_user=foreign.login('other-admin');foreign_page=foreign.request('audit-search/all/'+resource);verified(foreign_page,foreign_user,{'action':None,'resourceId':resource});assert not foreign_page['entries'];foreign.request('audit-search/all/all/'+token,expected=400)
 report['checks'].append('administrator can read; foreign tenant sees no matching resource and cannot reuse the viewer cursor')
 # Actor search uses the complete stored history, independently compared with SQL; no writes.
 scope="organization_id='"+str(uuid.UUID(user['organizationId']))+"' AND project_id='"+str(uuid.UUID(user['projectId']))+"'"
 actors=sql('SELECT actor_id FROM stack_audit WHERE '+scope+' GROUP BY actor_id ORDER BY count(*) DESC,actor_id LIMIT 2;').splitlines();assert actors
 actor_pages=0;actor_rows=0
 for actor in actors:
  actor=str(uuid.UUID(actor));path='audit-actor-search/'+actor+'/all/all'
  expected=sql("SELECT id FROM stack_audit WHERE "+scope+" AND actor_id='"+actor+"' ORDER BY created_at DESC,id DESC;").splitlines();seen=[];actor_token=None;first_actor=None
  for _ in range(100):
   value=viewer.request(path+('/'+actor_token if actor_token else ''))
   code="import {readFileSync} from 'node:fs';import {auditActorSearchPage} from './apps/console/src/lib/audit-search.ts';const v=JSON.parse(readFileSync(0,'utf8'));await auditActorSearchPage(v.page,v.user,v.actor,{action:null,resourceId:null},v.token);console.log('verified');"
   checked=subprocess.run(['node','--experimental-strip-types','--input-type=module','-e',code],input=json.dumps({'page':value,'user':user,'actor':actor,'token':actor_token}),cwd=ROOT,capture_output=True,text=True,encoding='utf-8',timeout=20);assert checked.returncode==0
   assert value['actorId']==actor and all(v['actorId']==actor for v in value['entries']);seen.extend(v['id'] for v in value['entries']);actor_pages+=1
   if first_actor is None:first_actor=value
   actor_token=value['nextCursor']
   if actor_token is None:break
  else:raise AssertionError('Actor history exceeded bounded fixture pages')
  assert seen==expected;actor_rows+=len(seen)
  foreign_actor=foreign.request(path);assert foreign_actor['entries']==[]
  if first_actor['nextCursor']:
   foreign.request(path+'/'+first_actor['nextCursor'],expected=400)
   viewer.request('audit-actor-search/'+str(uuid.uuid4())+'/all/all/'+first_actor['nextCursor'],expected=400)
   viewer.request('audit-actor-search/'+actor+'/review.approved/all/'+first_actor['nextCursor'],expected=400)
  combined_path='audit-actor-search/'+actor+'/'+action+'/'+resource
  combined=viewer.request(combined_path);assert all(v['actorId']==actor and v['action']==action and v['resourceId']==resource for v in combined['entries'])
  expected_combined=sql("SELECT id FROM stack_audit WHERE "+scope+" AND actor_id='"+actor+"' AND action='"+action+"' AND resource_id='"+str(uuid.UUID(resource))+"' ORDER BY created_at DESC,id DESC LIMIT 25;").splitlines();assert [v['id'] for v in combined['entries']]==expected_combined
  admin_page=admin.request(path);assert [v['id'] for v in admin_page['entries']]==expected[:25] and admin_page['actorId']==actor
  empty_actor=viewer.request('audit-actor-search/'+str(uuid.uuid4())+'/all/all');assert empty_actor['entries']==[] and empty_actor['nextCursor'] is None
  viewer.request('audit-actor-search/------------------------------------/all/all',expected=400)
  report['phase']='reject-legacy-cursor-at-bff'
  refused=viewer.request(path+'/'+token,expected=502);assert refused=={'code':'REQUEST_UNAVAILABLE'}
  report['phase']='actor-search-comparison'
 assert actor_pages>len(actors),'Hosted fixture must prove real actor pagination'
 report['phase']='actor-search-compared'
 report.update(actorSearchSqlComparedRows=actor_rows,actorSearchPages=actor_pages,actorSearchActors=len(actors))
 report['checks'].append('whole stored actor history equals independent scoped SQL; actual multi-page filters, legacy and changed actor/filter/tenant cursors rejected')
 assert fingerprint()==before;report.update(completed=True,businessTablesUnchanged=len(before))
 report['checks'].append('all observed business tables including project settings, access keys and revocations remain unchanged')
except Exception as error:report.update(errorType=type(error).__name__,code='AUDIT_SEARCH_SMOKE_UNVERIFIED')
finally:
 closed=True
 for client in reversed(clients):
  try:client.logout()
  except Exception:closed=False
 report['ownSessionsLoggedOut']=closed;path=ROOT/'.local'/('stack-audit-search-'+str(uuid.uuid4())+'.json');path.open('x',encoding='utf-8').write(json.dumps(report,indent=2)+'\n');print(json.dumps({'completed':report['completed'],'checks':len(report['checks']),'ownSessionsLoggedOut':closed,'reportPath':str(path),'errorType':report.get('errorType')}))
if not report['completed'] or not closed:raise SystemExit(1)
