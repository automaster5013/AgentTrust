"""Read-only tenant/filter navigation and browser-contract checks using existing audits."""
import json,pathlib,subprocess,uuid
from stack_test_client import StackClient
from stack_business_fingerprint import fingerprint
ROOT=pathlib.Path(__file__).resolve().parent.parent
report={'completed':False,'checks':[],'businessDataWrites':False,'paidProviderCalls':False,'credentialsRecorded':False};clients=[]
def verified(value,user,filters,token=None):
 code="import {readFileSync} from 'node:fs';import {auditSearchPage,auditFilters} from './apps/console/src/lib/audit-search.ts';const v=JSON.parse(readFileSync(0,'utf8'));await auditSearchPage(v.page,v.user,v.filters,v.token);const changed=structuredClone(v.page);changed.filters.resourceId=v.filters.resourceId===null?v.user.actorId:null;let refused=false;try{await auditSearchPage(changed,v.user,v.filters,v.token)}catch{refused=true}if(!refused)throw Error('FILTER_SUBSTITUTION_ACCEPTED');const searchable=v.page.entries.filter(entry=>{try{auditFilters(entry.action,entry.resourceId);return true}catch{return false}});console.log(JSON.stringify({verified:true,changedFiltersRefused:true,searchable}));"
 result=subprocess.run(['node','--experimental-strip-types','--input-type=module','-e',code],input=json.dumps({'page':value,'user':user,'filters':filters,'token':token}),cwd=ROOT,capture_output=True,text=True,encoding='utf-8',timeout=20)
 assert result.returncode==0 and json.loads(result.stdout)['verified']
 return json.loads(result.stdout)['searchable']
try:
 before=fingerprint();assert len(before)==18
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
 assert fingerprint()==before;report.update(completed=True,businessTablesUnchanged=18)
 report['checks'].append('all eighteen existing business table fingerprints remain unchanged')
except Exception as error:report.update(errorType=type(error).__name__,code='AUDIT_SEARCH_SMOKE_UNVERIFIED')
finally:
 closed=True
 for client in reversed(clients):
  try:client.logout()
  except Exception:closed=False
 report['ownSessionsLoggedOut']=closed;path=ROOT/'.local'/('stack-audit-search-'+str(uuid.uuid4())+'.json');path.open('x',encoding='utf-8').write(json.dumps(report,indent=2)+'\n');print(json.dumps({'completed':report['completed'],'checks':len(report['checks']),'ownSessionsLoggedOut':closed,'reportPath':str(path),'errorType':report.get('errorType')}))
if not report['completed'] or not closed:raise SystemExit(1)
