"""Read-only API/DB comparison on a disposable hosted candidate, never operating data."""
import argparse,base64,datetime,json,pathlib,subprocess,uuid
from stack_ci_return_guard import require_hosted
from stack_test_client import StackClient
ROOT=pathlib.Path(__file__).resolve().parent.parent

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--execute',action='store_true');args=parser.parse_args()
    if not args.execute:
        print(json.dumps({'completed':True,'executed':False,'businessDataWrites':False,'requires':'disposable hosted --execute'}));return 0
    try:require_hosted(ROOT)
    except ValueError:
        print(json.dumps({'completed':False,'executed':False,'code':'HOSTED_SYNTHETIC_ONLY'}));return 1
    report={'completed':False,'businessDataWrites':False,'paidApiCalls':False,'credentialsRecorded':False};clients=[]
    def sql(query):
        p=subprocess.run(['docker','exec','-i','agenttrust-stack-db-1','psql','-X','-q','-U','agenttrust_stack','-d','agenttrust_stack','-At','-v','ON_ERROR_STOP=1'],input="BEGIN READ ONLY;SET LOCAL statement_timeout='3s';"+query+';ROLLBACK;',cwd=ROOT,capture_output=True,text=True,timeout=20,check=True)
        return p.stdout.strip().splitlines()
    def path(dataset='all',approval='all',agent='all',token=None):return 'campaign-history-search/'+dataset+'/'+approval+'/'+agent+('/'+token if token else '')
    def verify(page,user,dataset,approval,agent,token):
        code="""import {readFileSync} from 'node:fs';import {campaignHistorySearchPage} from './apps/console/src/lib/campaign-history-search.ts';const v=JSON.parse(readFileSync(0,'utf8'));const p=await campaignHistorySearchPage(v.page,v.user,v.filters,v.dataset,v.token);console.log(JSON.stringify({ids:p.entries.map(row=>row.id),nextCursor:p.nextCursor}));"""
        p=subprocess.run(['node','--experimental-strip-types','--input-type=module','-e',code],cwd=ROOT,input=json.dumps({'page':page,'user':user,'dataset':None if dataset=='all' else dataset,'filters':{'approval':approval,'agentVersionId':None if agent=='all' else agent},'token':token}),capture_output=True,text=True,timeout=15,check=True)
        return json.loads(p.stdout)
    try:
        anonymous=StackClient('http://127.0.0.1:4320',[],report,clients);anonymous.request(path(),expected=401)
        credentials=json.loads((ROOT/'.local/stack/demo-credentials.json').read_bytes());admin=StackClient(anonymous.base,credentials,report,clients);user=admin.login('demo-admin')
        org=str(uuid.UUID(user['organizationId']));project=str(uuid.UUID(user['projectId']));scope="organization_id='"+org+"' AND project_id='"+project+"'"
        first=admin.request(path());assert first['entries'] and first['nextCursor']
        entry=first['entries'][0];dataset=str(uuid.UUID(entry['datasetVersionId']));agent=str(uuid.UUID(entry['agentVersionId']))
        combinations=[('all','all','all'),('all','required','all'),('all','not-required','all'),('all','all',agent),(dataset,'all','all'),(dataset,'required',agent),(dataset,'not-required',agent)]
        pages=0;total=0
        for ds,approval,av in combinations:
            where=scope
            if ds!='all':where+=" AND dataset_version_id='"+ds+"'"
            if av!='all':where+=" AND agent_version_id='"+av+"'"
            if approval!='all':where+=' AND requires_approval='+('true' if approval=='required' else 'false')
            expected=sql('SELECT id FROM stack_campaigns WHERE '+where+' ORDER BY created_at DESC,id DESC LIMIT 75');seen=[];token=None
            for _ in range(3):
                value=admin.request(path(ds,approval,av,token));checked=verify(value,user,ds,approval,av,token);seen+=checked['ids'];token=checked['nextCursor'];pages+=1
                if token is None:break
            assert seen==expected and len(seen)==len(set(seen));total+=len(seen)
        viewer=StackClient(admin.base,credentials,report,clients);viewer.login('demo-viewer');assert viewer.request(path())==first
        token=first['nextCursor'];viewer.request(path(approval='required',token=token),expected=400);viewer.request(path(dataset=dataset,token=token),expected=400);viewer.request(path(agent=agent,token=token),expected=400)
        foreign=StackClient(admin.base,credentials,report,clients);foreign.login('other-admin');foreign.request(path(token=token),expected=400)
        assert not {x['id'] for x in first['entries']}&{x['id'] for x in foreign.request(path())['entries']}
        raw=bytearray(base64.urlsafe_b64decode(token+'='));raw[0]=2;admin.request(path(token=base64.urlsafe_b64encode(raw).decode().rstrip('=')),expected=400)
        admin.request(path()+'?organizationId='+org,expected=502);admin.request(path(),'POST',{},expected=502);admin.request('campaign-history-search/all/approved/all',expected=502)
        assert admin.request(path())==first
        report.update(completed=True,filtersCompared=len(combinations),pagesCompared=pages,rowsCompared=total,scopedDatabaseOrderVerified=True,foreignAndChangedFilterBoundariesRejected=True)
    except Exception as error:report.update(code='CAMPAIGN_SEARCH_UNVERIFIED',errorType=type(error).__name__)
    finally:
        closed=True
        for client in reversed(clients):
            try:client.logout()
            except Exception:closed=False
        report.update(ownSessionsLoggedOut=closed,finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat());report['completed']=report['completed'] and closed
        out=ROOT/'.local'/('stack-campaign-history-search-'+str(uuid.uuid4())+'.json');out.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
        print(json.dumps({'completed':report['completed'],'report':str(out),'ownSessionsLoggedOut':closed,'rowsCompared':report.get('rowsCompared'),'errorType':report.get('errorType')}))
    return 0 if report['completed'] else 1
if __name__=='__main__':raise SystemExit(main())
