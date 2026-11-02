"""Hosted-only read-only history search; compare actual API pages with scoped DB outcomes."""
import argparse,base64,datetime,json,pathlib,struct,subprocess,uuid
from stack_ci_return_guard import require_hosted
from stack_test_client import StackClient
ROOT=pathlib.Path(__file__).resolve().parent.parent

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--execute',action='store_true');args=parser.parse_args()
    if not args.execute:
        print(json.dumps({'completed':True,'executed':False,'requires':'disposable GitHub-hosted --execute','businessDataWrites':False}));return 0
    try: require_hosted(ROOT)
    except ValueError:
        print(json.dumps({'completed':False,'executed':False,'code':'HOSTED_SYNTHETIC_HISTORY_SEARCH_ONLY','businessDataWrites':False}));return 1
    report={'completed':False,'checks':[],'businessDataWrites':False,'paidApiCalls':False,'credentialsRecorded':False};clients=[]
    def sql(query):
        process=subprocess.run(['docker','exec','-i','agenttrust-stack-db-1','psql','-X','-q','-U','agenttrust_stack','-d','agenttrust_stack','-At','-v','ON_ERROR_STOP=1'],input="BEGIN READ ONLY;SET LOCAL statement_timeout='3s';"+query+';ROLLBACK;',cwd=ROOT,capture_output=True,text=True,encoding='utf-8',timeout=20,check=True)
        return process.stdout.strip().splitlines()
    def path(filters,token=None): return 'run-history-search/'+'/'.join(filters)+(('/'+token) if token else '')
    def verify(page,user,filters,token):
        code="""import {readFileSync} from 'node:fs';import {runHistorySearchPage} from './apps/console/src/lib/run-history-search.ts';const input=JSON.parse(readFileSync(0,'utf8'));const value=await runHistorySearchPage(input.page,input.user,input.filters,input.token);console.log(JSON.stringify({ids:value.entries.map(row=>row.id),nextCursor:value.nextCursor}));"""
        value=dict(zip(('scenario','approval','state','decision','provider'),filters))
        process=subprocess.run(['node','--experimental-strip-types','--input-type=module','-e',code],cwd=ROOT,input=json.dumps({'page':page,'user':user,'filters':value,'token':token}),capture_output=True,text=True,encoding='utf-8',timeout=15,check=True)
        return json.loads(process.stdout)
    try:
        all_filters=('all',)*5
        anonymous=StackClient('http://127.0.0.1:4320',[],report,clients);anonymous.request(path(all_filters),expected=401)
        credentials=json.loads((ROOT/'.local/stack/demo-credentials.json').read_text(encoding='utf-8'))
        admin=StackClient(anonymous.base,credentials,report,clients);user=admin.login('demo-admin')
        org=str(uuid.UUID(user['organizationId']));project=str(uuid.UUID(user['projectId']))
        combinations=[all_filters,('pass','all','all','all','all'),('all','not-required','all','all','all'),('all','all','failed','all','all'),('all','all','all','block','all'),('all','all','all','all','synthetic'),('pass','required','succeeded','pass','synthetic'),('error','all','failed','inconclusive','synthetic')]
        total=0;pages=0;first=None
        report['phase']='postgresql-and-api-pages'
        for filter_index,filters in enumerate(combinations):
            report['filterIndex']=filter_index
            conditions=["r.organization_id='"+org+"'","r.project_id='"+project+"'"]
            for field,value in zip(('r.scenario','r.requires_approval','COALESCE(c.state,r.state)','COALESCE(c.decision,r.decision)','r.provider'),filters):
                if value=='all':continue
                conditions.append(field+'='+('true' if value=='required' else 'false') if field=='r.requires_approval' else field+"='"+value+"'")
            expected=sql('SELECT r.id FROM stack_runs r LEFT JOIN stack_run_results c ON c.run_id=r.id WHERE '+' AND '.join(conditions)+' ORDER BY r.created_at DESC,r.id DESC LIMIT 75')
            token=None;seen=[]
            for _ in range(3):
                page=admin.request(path(filters,token));checked=verify(page,user,filters,token)
                if first is None:first=page
                seen+=checked['ids'];token=checked['nextCursor'];pages+=1
                if token is None:break
            report.update(lastExpectedRowCount=len(expected),lastActualRowCount=len(seen))
            assert seen==expected and len(seen)==len(set(seen));total+=len(seen)
        assert first is not None and first['nextCursor'] is not None
        assert len(sql("SELECT r.id FROM stack_runs r JOIN stack_run_results c ON c.run_id=r.id WHERE r.organization_id='"+org+"' AND r.project_id='"+project+"' AND r.state='queued' AND c.state<>'queued' LIMIT 1"))==1
        report['checks'].append('all five conditions intersect against PostgreSQL outcomes, including completed immutable queued admissions; up to three matching pages compared')
        report['phase']='viewer-and-scope-binding'
        viewer=StackClient(admin.base,credentials,report,clients);viewer.login('demo-viewer');assert [row['id'] for row in viewer.request(path(all_filters))['entries']]==[row['id'] for row in first['entries']]
        token=first['nextCursor'];viewer.request(path(('block','all','all','all','all'),token),expected=400)
        foreign=StackClient(admin.base,credentials,report,clients);foreign.login('other-admin');foreign.request(path(all_filters,token),expected=400)
        foreign_page=foreign.request(path(all_filters));assert not {row['id'] for row in first['entries']}&{row['id'] for row in foreign_page['entries']}
        report['checks'].append('viewer sees its own scope, changed-filter and foreign-scope cursors are rejected')
        report['phase']='malformed-boundary-and-read-only-policy'
        raw=bytearray(base64.urlsafe_b64decode(token));assert len(raw)==96;raw[0]=2;admin.request(path(all_filters,base64.urlsafe_b64encode(raw).decode()),expected=400)
        raw=bytearray(base64.urlsafe_b64decode(token));struct.pack_into('>i',raw,76,1);admin.request(path(all_filters,base64.urlsafe_b64encode(raw).decode()),expected=400)
        admin.request(path(all_filters)+'?organizationId='+org,expected=502)
        admin.request(path(all_filters),'POST',{},expected=502)
        admin.request(path(all_filters)+'/short',expected=502)
        admin.request('run-history-search/all/all/all/all/unknown',expected=502)
        assert [row['id'] for row in admin.request(path(all_filters))['entries']]==[row['id'] for row in first['entries']]
        report['checks'].append('wrong domain/submicrosecond cursor, caller tenant query, writes and unknown routes refused; original ordering retained by read-only requests')
        report.update(completed=True,filtersCompared=len(combinations),pagesCompared=pages,rowsCompared=total)
    except Exception as error: report.update(code='RUN_HISTORY_SEARCH_UNVERIFIED',errorType=type(error).__name__)
    finally:
        closed=True
        for client in reversed(clients):
            try:client.logout()
            except Exception:closed=False
        report.update(ownSessionsLoggedOut=closed,finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat());report['completed']=report['completed'] and closed
        target=ROOT/'.local'/('stack-run-history-search-'+str(uuid.uuid4())+'.json');target.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
        print(json.dumps({key:report.get(key) for key in ('completed','filtersCompared','pagesCompared','rowsCompared','errorType','unexpectedHttpStatus','ownSessionsLoggedOut','businessDataWrites','paidApiCalls','phase','filterIndex','lastExpectedRowCount','lastActualRowCount')}))
    return 0 if report['completed'] else 1

if __name__=='__main__':raise SystemExit(main())
