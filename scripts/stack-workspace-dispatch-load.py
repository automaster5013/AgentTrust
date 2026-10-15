"""Offline plan by default; owned multi-workspace admissions only in disposable GitHub CI."""
import argparse,concurrent.futures,datetime,hashlib,json,os,pathlib,secrets,subprocess,time,uuid
from stack_identity_admin import IdentityAdmin
from stack_test_client import StackClient
from stack_workspace_onboarding import canonical_uuid,require

ROOT=pathlib.Path(__file__).resolve().parent.parent

def command(args,timeout=30):
    result=subprocess.run(args,cwd=ROOT,capture_output=True,timeout=timeout)
    require(result.returncode==0 and len(result.stdout)<=1048576,'WORKSPACE_LOAD_LOCAL_COMMAND_REFUSED')
    return result.stdout

def stream_metadata(raw):
    require(isinstance(raw,bytes) and 0<len(raw)<=65536)
    value=json.loads(raw)
    rows=[stream for account in value['account_details'] for stream in account['stream_detail'] if stream['name']=='STACK_EVALUATIONS']
    require(len(rows)==1)
    value=rows[0];state=value['state']
    require(isinstance(value['created'],str) and len(value['created'])<=64)
    for name in ['messages','last_seq']:
        require(type(state[name]) is int and 0<=state[name]<2**64)
    return {'created':value['created'],'messages':state['messages'],'lastSequence':state['last_seq']}

def broker():
    return stream_metadata(command(['docker','exec','agenttrust-stack-nats-1','wget','-T','5','-q','-O','-','http://127.0.0.1:8222/jsz?streams=true&consumers=true']))

def idle_broker():
    until=time.monotonic()+10
    while True:
        value=broker()
        if value['messages']==0:return value
        require(time.monotonic()<until,'WORKSPACE_LOAD_QUEUE_MUST_START_IDLE');time.sleep(.25)

def account_fingerprints(admin):
    rows=admin.request('/users?first=0&max=101');require(isinstance(rows,list) and len(rows)<=100)
    return {r['id']:hashlib.sha256(json.dumps({'identity':admin.request('/users/'+r['id']),'roles':admin.request('/users/'+r['id']+'/role-mappings')},sort_keys=True,separators=(',',':')).encode()).hexdigest() for r in rows}

def cleanup_owned(admin,original,owned):
    require(isinstance(original,dict))
    identifiers=set()
    for row in owned:
        actor=canonical_uuid(row['actorId']);require(actor not in original and actor not in identifiers);identifiers.add(actor)
        actual=admin.request('/users/'+actor)
        require(actual.get('id')==actor and actual.get('username')==row['username'] and actual.get('attributes',{}).get('agenttrust_organization')==[row['organizationId']] and actual.get('attributes',{}).get('agenttrust_project')==[row['projectId']],'WORKSPACE_LOAD_CLEANUP_OWNERSHIP_REFUSED')
    for actor in identifiers:admin.request('/users/'+actor,'DELETE')
    require(account_fingerprints(admin)==original)

def worker_state():
    value=json.loads(command(['docker','inspect','agenttrust-stack-ai-worker-1']))[0]
    require(value['Config']['Labels'].get('com.docker.compose.project')=='agenttrust' and value['Config']['Labels'].get('com.docker.compose.service')=='stack-ai-worker')
    return {'id':value['Id'],'image':value['Image'],'running':value['State']['Running'],'healthy':value['State'].get('Health',{}).get('Status')=='healthy'}

def restore_worker(before):
    current=worker_state();require(current['id']==before['id'] and current['image']==before['image'])
    if not current['running']:command(['docker','start',before['id']])
    until=time.monotonic()+60
    while True:
        current=worker_state();require(current['id']==before['id'] and current['image']==before['image'])
        if current['running'] and current['healthy']:return
        require(time.monotonic()<until,'WORKSPACE_LOAD_WORKER_RESTORE_UNVERIFIED');time.sleep(1)

def manifests():
    organizations=[str(uuid.UUID(int=(prefix<<112)|secrets.randbits(112))) for prefix in [0x7fff,0x8000]]
    prefix='dispatch-'+secrets.token_hex(6)
    return [{'schemaVersion':1,'organizationId':organizations[index//5],'projectId':str(uuid.uuid4()),'members':[{'username':prefix+'-'+str(index).zfill(2),'role':'admin'}]} for index in range(10)]

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--allow-owned-evaluations',action='store_true');args=parser.parse_args()
    if not args.allow_owned_evaluations:
        print(json.dumps({'completed':True,'stage':'offline-plan','plannedOrganizations':2,'plannedWorkspaces':10,'plannedSyntheticEvaluations':50,'providerContactPerformed':False,'businessWritesPerformed':False,'workerInterruptionPerformed':False,'productionDeploymentPerformed':False}));return 0
    report={'completed':False,'stage':'disposable-ci-guard','checks':[],'businessWritesPerformed':False,'paidProviderCallsPerformed':False,'credentialsRecorded':False,'requestKeysRecorded':False,'productionDeploymentPerformed':False,'customerLoadCapacityVerified':False,'workerInterruptionPerformed':False,'candidateGitHubCiOnly':True}
    clients=[];owned=[];journals=[];original=None;before_worker=None;restore_required=False;worker_restored=True
    try:
        require(os.environ.get('GITHUB_ACTIONS')=='true' and os.environ.get('CI')=='true','WORKSPACE_LOAD_REQUIRES_DISPOSABLE_CI')
        console=json.loads(command(['docker','inspect','agenttrust-stack-console-1']))[0]
        require(console['Config']['Labels'].get('com.docker.compose.project')=='agenttrust' and console['Config']['Labels'].get('com.docker.compose.service')=='stack-console')
        require(console['Config']['Labels'].get('dev.agenttrust.oidc.profile')=='local-review','WORKSPACE_LOAD_LOCAL_PROFILE_REQUIRED')
        messaging=json.loads(command(['docker','inspect','agenttrust-stack-nats-1']))[0]
        require(messaging['Config']['Labels'].get('com.docker.compose.project')=='agenttrust' and messaging['Config']['Labels'].get('com.docker.compose.service')=='stack-nats' and messaging['State']['Health']['Status']=='healthy')
        before_worker=worker_state();require(before_worker['running'] and before_worker['healthy'])
        before_broker=idle_broker()
        with IdentityAdmin(ROOT) as admin:original=account_fingerprints(admin)
        fixture=ROOT/'.local'/('workspace-dispatch-fixture-'+str(uuid.uuid4()));fixture.mkdir(mode=0o700)
        scopes=manifests();seeded=json.loads((ROOT/'.local/stack/demo-credentials.json').read_text(encoding='utf-8'))
        seed_scopes={(row['organizationId'],row['projectId']) for row in seeded}
        require(all((m['organizationId'],m['projectId']) not in seed_scopes for m in scopes))
        credentials=[];report['stage']='provision-ten-owned-workspaces'
        for index,manifest in enumerate(scopes):
            path=fixture/('manifest-'+str(index)+'.json')
            with path.open('x',encoding='utf-8') as stream:json.dump(manifest,stream)
            result=subprocess.run([os.sys.executable,'scripts/stack-workspace-onboarding.py','--manifest',str(path),'--execute'],cwd=ROOT,capture_output=True,text=True,timeout=180)
            safe=json.loads(result.stdout)
            if safe.get('privateJournalDirectory'):
                directory=pathlib.Path(safe['privateJournalDirectory']).resolve();require(directory.parent==ROOT/'.local' and directory.name.startswith('workspace-onboarding-'))
                journals.append(directory);journal=json.loads((directory/'journal.json').read_text(encoding='utf-8'))
                for row in journal['members']:
                    if row['actorId'] is not None:owned.append({**row,'organizationId':manifest['organizationId'],'projectId':manifest['projectId']})
            require(result.returncode==0 and safe['completed'],'WORKSPACE_LOAD_PROVISIONING_UNVERIFIED')
            require(journal['createResponseUncertain'] is False and len(journal['members'])==1)
            credentials.append(owned[-1])
        require(len(owned)==len(credentials)==len(scopes)==10 and len({row['actorId'] for row in owned})==10)
        for row in credentials:
            client=StackClient('http://127.0.0.1:4320',credentials,clients=clients);scope=client.login(row['username'])
            require(scope['role']=='admin' and client.request('runs')==[])
        report.update(organizations=2,workspaces=10,ownedIdentities=10,nonSeededScopesVerified=True,unsignedUuidBoundaryVerified=scopes[0]['organizationId'].startswith('7fff') and scopes[5]['organizationId'].startswith('8000'))
        report['checks'].append('ten non-seeded workspaces across two organizations authenticate exact scoped administrator identities')
        before_broker=idle_broker()
        report['stage']='hold-worker-and-admit-fifty';restore_required=True;worker_restored=False;report['workerInterruptionPerformed']=True
        command(['docker','stop','--time','10',before_worker['id']]);require(not worker_state()['running'])
        report['businessWritesPerformed']=True
        def admit(item):
            index,client=item;ids=[]
            for _ in range(5):
                value=client.request('runs','POST',{'scenario':'pass','provider':'synthetic','requiresApproval':True},{'Idempotency-Key':str(uuid.uuid4())})
                require(value['state']=='queued');ids.append(canonical_uuid(value['id']))
            require(len(set(ids))==5);return index,ids
        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:groups=dict(pool.map(admit,enumerate(clients)))
        identifiers=[identifier for group in groups.values() for identifier in group];require(len(set(identifiers))==50)
        report['admittedSyntheticEvaluations']=50;report['checks'].append('fifty distinct durable synthetic admissions remain queued while only the owned worker is stopped')
        until=time.monotonic()+25
        while True:
            current=broker();require(current['created']==before_broker['created'])
            if current['messages']==50 and current['lastSequence']-before_broker['lastSequence']==50:break
            require(time.monotonic()<until,'WORKSPACE_LOAD_DISPATCH_PAGE_OR_BUDGET_UNVERIFIED');time.sleep(.25)
        report.update(allFiftyPublishedBeforeWorkerRestore=True,distinctBrokerMessageSequenceIncrease=50,exceedsEightWorkspacePage=True,exceedsFortyAdmissionCycleBudget=True)
        report['checks'].append('actual publisher persists all fifty messages across ten pending namespaces before any worker can complete them; this exceeds page8 and cycle40')
        restore_worker(before_worker);restore_required=False;worker_restored=True;report['stage']='verify-fifty-completions-and-isolation'
        until=time.monotonic()+60;done=False
        while not done:
            with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:lists=list(pool.map(lambda client:client.request('runs'),clients))
            done=all(len(rows)==5 and {row['id'] for row in rows}==set(groups[index]) and all(row['state']=='succeeded' and row['decision']=='pass' for row in rows) for index,rows in enumerate(lists))
            if not done:require(time.monotonic()<until,'WORKSPACE_LOAD_COMPLETIONS_UNVERIFIED');time.sleep(1)
        for index,client in enumerate(clients):
            for identifier in groups[index]:
                detail=client.request('runs/'+identifier);require(detail['state']=='succeeded' and detail['decision']=='pass' and detail['result']['executionEngine']=='python-synthetic')
                require(client.request('runs/'+identifier+'/gate')['deploymentAllowed'] is False)
            same_org=(index//5)*5+(index%5+1)%5;foreign_org=(index+5)%10
            for other in [same_org,foreign_org]:client.request('runs/'+groups[other][0],expected=404)
        until=time.monotonic()+10
        while broker()['messages']!=0:require(time.monotonic()<until,'WORKSPACE_LOAD_ACKNOWLEDGEMENTS_UNVERIFIED');time.sleep(.25)
        report.update(completedSyntheticEvaluations=50,allManualApprovalGatesStillBlocked=True,crossProjectAndOrganizationReadsRefused=True,allPublishedMessagesAcknowledged=True,completedRunIdsSha256=hashlib.sha256('\n'.join(sorted(identifiers)).encode()).hexdigest())
        report['checks'].append('all fifty actual Python synthetic results pass, unreviewed gates remain blocked, every identity is refused other-project and other-organization runs, and broker work is acknowledged')
        report['completed']=True;report['stage']='completed'
    except Exception as error:report.update(completed=False,errorType=type(error).__name__,code=getattr(error,'code','WORKSPACE_DISPATCH_LOAD_UNVERIFIED'))
    finally:
        if restore_required:
            try:restore_worker(before_worker);worker_restored=True
            except Exception as error:worker_restored=False;report['restoreErrorType']=type(error).__name__
        closed=True
        for client in reversed(clients):
            try:client.logout()
            except Exception:closed=False
        cleaned=original is not None
        if original is not None:
            try:
                with IdentityAdmin(ROOT) as admin:cleanup_owned(admin,original,owned)
            except Exception as error:cleaned=False;report['cleanupErrorType']=type(error).__name__
        report.update(workerRestoredSameContainerAndImage=worker_restored,ownSessionsLoggedOut=closed and all(not client.logged for client in clients),ownIdentityProviderSessionsClosed=closed and all(client.report.get('ownIdentityProviderSessionClosed') for client in clients),ownedIdentitiesDeletedAndOriginalAccountsUnchanged=cleaned,privateJournalsRetainedForAudit=True,privateJournalCount=len(journals),finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
        report['completed']=report['completed'] and worker_restored and report['ownSessionsLoggedOut'] and report['ownIdentityProviderSessionsClosed'] and cleaned
        if report['completed']:report['checks'].append('exact worker container/image restored; all owned application and provider sessions closed; only created identities deleted and original accounts/roles unchanged')
        target=ROOT/'.local'/('stack-workspace-dispatch-load-'+str(uuid.uuid4())+'.json')
        with target.open('x',encoding='utf-8') as stream:stream.write(json.dumps(report,indent=2)+'\n')
        print(json.dumps({'completed':report['completed'],'checks':len(report['checks']),'stage':report['stage'],'reportPath':str(target),'businessWritesPerformed':report['businessWritesPerformed']}))
    return 0 if report['completed'] else 1

if __name__=='__main__':raise SystemExit(main())
