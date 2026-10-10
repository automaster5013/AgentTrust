"""Authenticated bounded campaign integration; reports never contain credentials or model text."""
import argparse,concurrent.futures,datetime,hashlib,json,pathlib,subprocess,time,uuid
from stack_test_client import StackClient
root=pathlib.Path(__file__).resolve().parent.parent
parser=argparse.ArgumentParser();parser.add_argument('--base',default='http://127.0.0.1:4320');args=parser.parse_args()
report={'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'completed':False,'checks':[],'credentialsRecorded':False,'paidProviderCalled':False,'actualDeploymentPerformed':False};clients=[]
def checked(label):report['checks'].append(label)
def definition_hash(value):return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
def wait(client,record):
 until=time.monotonic()+35
 while record['state']=='queued' and time.monotonic()<until:time.sleep(.4);record=client.request('campaigns/'+record['id'])
 assert record['state']!='queued';return record
def create(client,agent,dataset,approval=True,key=None):return client.request('campaigns','POST',{'agentVersionId':agent['id'],'datasetVersionId':dataset['id'],'requiresApproval':approval},{'Idempotency-Key':key or str(uuid.uuid4())})
try:
 credentials=json.loads((root/'.local/stack/demo-credentials.json').read_text(encoding='utf-8'));admin=StackClient(args.base,credentials,report,clients);owner=admin.login('demo-admin');report['phase']='version-registration';suffix=uuid.uuid4().hex[:12];agent_body={'key':'campaign-agent-'+suffix,'version':1,'provider':'synthetic','description':'고정 시나리오 평가'}
 agent=admin.request('versions/agents','POST',agent_body);assert agent['content_sha256']==definition_hash(agent['definition']);replay=admin.request('versions/agents','POST',agent_body);assert replay['id']==agent['id'];admin.request('versions/agents','POST',{**agent_body,'description':'changed'},expected=409);checked('identical version replay and SHA-256 succeed; changed contents refused')
 cases=[{'id':'required-pass','scenario':'pass','required':True},{'id':'optional-block','scenario':'block','required':False}];body={'key':'campaign-data-'+suffix,'version':1,'cases':cases};dataset=admin.request('versions/datasets','POST',body);assert dataset['content_sha256']==definition_hash(dataset['definition']);assert admin.request('versions/datasets','POST',body)['id']==dataset['id'];admin.request('versions/datasets','POST',{**body,'cases':[cases[0]]},expected=409)
 for invalid in [[],[cases[0],cases[0]],[{**cases[0],'required':False}],[{**cases[0],'required':None}],[{**cases[0],'scenario':'arbitrary'}],[{**cases[0],'id':'case-'+str(i)} for i in range(9)]]:admin.request('versions/datasets','POST',{**body,'version':2,'cases':invalid},expected=400)
 admin.request('versions/agents','POST',{**agent_body,'unexpected':True},expected=400);admin.request('versions/agents','POST',{**agent_body,'version':None},expected=400);checked('dataset bounds, unique cases, required evidence and strict request types enforced')
 report['phase']='campaign-execution';peer=StackClient(args.base,credentials,report,clients);peer.login('demo-admin');key=str(uuid.uuid4())
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  futures=[pool.submit(create,client,agent,dataset,True,key) for client in [admin,peer]];admissions=[f.result(timeout=20) for f in futures]
 first=admissions[0];assert admissions[1]['id']==first['id'] and [c['runId'] for c in admissions[1]['cases']]==[c['runId'] for c in first['cases']];assert create(admin,agent,dataset,key=key)['id']==first['id'];create_body={'agentVersionId':agent['id'],'datasetVersionId':dataset['id'],'requiresApproval':False};admin.request('campaigns','POST',create_body,{'Idempotency-Key':key},expected=409);first=wait(admin,first);assert first['state']=='succeeded' and first['decision']=='pass' and len(first['cases'])==2 and first['agent_content_sha256']==agent['content_sha256'] and first['dataset_content_sha256']==dataset['content_sha256'];assert first['cases'][1]['decision']=='block' and not first['cases'][1]['required'];assert first['result']['executionEngine']=='java-campaign-aggregate';checked('atomic idempotent campaign completes real Python cases; optional block does not override required pass')
 for item in first['cases']:
  child=admin.request('runs/'+item['runId']);assert child['provider']=='synthetic' and child['result']['executionEngine']=='python-synthetic' and child['decision']==item['decision']
 gate=admin.request('campaigns/'+first['id']+'/gate');assert not gate['deploymentAllowed'] and gate['decision']=='inconclusive' and gate['policyStatus']=='evaluated';admin.request('campaigns/'+first['id']+'/reviews','POST',{'decision':'approved','reason':'Bound version synthetic approval'});approved=admin.request('campaigns/'+first['id']+'/gate');assert approved['deploymentAllowed'] and approved['signed'] is False;admin.request('campaigns/'+first['id']+'/reviews','POST',{'decision':'rejected','reason':'Latest decision wins'});assert not admin.request('campaigns/'+first['id']+'/gate')['deploymentAllowed'];checked('parent OPA gate requires bound administrator review and honors latest rejection')
 second=wait(admin,create(admin,agent,dataset,False));assert admin.request('campaigns/'+second['id']+'/gate')['deploymentAllowed'];diff=admin.request('campaigns/'+second['id']+'/comparison/'+first['id']);assert diff['comparison']['status']=='no-regression' and diff['comparison']['deploymentAuthority'] is False and diff['datasetContentSha256']==dataset['content_sha256'];checked('same immutable dataset comparison remains advisory and carries exact version digest')
 report['phase']='failure-aggregation'
 for index,scenario in enumerate(['block','missing_evidence','error']):
  data=admin.request('versions/datasets','POST',{'key':body['key'],'version':index+2,'cases':[{'id':'required-check','scenario':scenario,'required':True}]});record=wait(admin,create(admin,agent,data));expected='block' if scenario=='block' else 'inconclusive';assert record['decision']==expected and not admin.request('campaigns/'+record['id']+'/gate')['deploymentAllowed'];admin.request('campaigns/'+record['id']+'/reviews','POST',{'decision':'approved','reason':'Must never override unavailable evidence'},expected=409);admin.request('campaigns/'+record['id']+'/comparison/'+first['id'],expected=409)
 checked('required failure blocks; missing and failed execution remain inconclusive and cannot be approved')
 report['phase']='tenant-and-role-boundaries';viewer=StackClient(args.base,credentials,report,clients);viewer.login('demo-viewer');assert viewer.request('campaigns/'+first['id'])['id']==first['id'];viewer.request('versions/agents','POST',agent_body,expected=403);viewer.request('campaigns','POST',create_body,{'Idempotency-Key':str(uuid.uuid4())},expected=403);viewer.request('campaigns/'+first['id']+'/reviews','POST',{'decision':'approved','reason':'Viewer cannot approve'},expected=403)
 foreign_user=next(row for row in credentials if row['organizationId']!=owner['organizationId']);foreign=StackClient(args.base,credentials,report,clients);foreign.login(foreign_user['username']);foreign.request('versions/agents/'+agent['id'],expected=404);foreign.request('versions/datasets/'+dataset['id'],expected=404);foreign.request('campaigns/'+first['id'],expected=404);foreign.request('campaigns','POST',create_body,{'Idempotency-Key':str(uuid.uuid4())},expected=404);checked('viewer writes and foreign version/campaign bindings are refused without tenant disclosure')
 report['phase']='database-immutability';organization=owner['organizationId'];project=owner['projectId'];assert str(uuid.UUID(organization))==organization and str(uuid.UUID(project))==project
 sql=f"""BEGIN;SET LOCAL ROLE agenttrust_stack_api;
 DO $$ DECLARE name text; visible bigint; BEGIN FOREACH name IN ARRAY ARRAY['stack_agent_versions','stack_dataset_versions','stack_campaigns','stack_campaign_cases','stack_campaign_reviews'] LOOP
 EXECUTE format('SELECT count(*) FROM %I',name) INTO visible; IF visible<>0 THEN RAISE EXCEPTION 'unscoped campaign rows visible'; END IF;
 END LOOP; END $$; SELECT set_config('agenttrust.organization_id','{organization}',true);SELECT set_config('agenttrust.project_id','{project}',true);
 DO $$ DECLARE name text; BEGIN FOREACH name IN ARRAY ARRAY['stack_agent_versions','stack_dataset_versions','stack_campaigns','stack_campaign_cases','stack_campaign_reviews'] LOOP
 IF has_table_privilege(current_user,name,'UPDATE') OR has_table_privilege(current_user,name,'DELETE') THEN RAISE EXCEPTION 'mutable campaign permissions'; END IF;
 END LOOP; END $$; ROLLBACK;"""
 command=subprocess.run(['docker','exec','-i','agenttrust-stack-db-1','psql','-U','agenttrust_stack','-d','agenttrust_stack','-v','ON_ERROR_STOP=1'],cwd=root,input=sql,capture_output=True,text=True,timeout=15);assert command.returncode==0;checked('database RLS hides unscoped rows and API role has no UPDATE or DELETE authority on versions/campaigns/reviews')
 report.update(completed=True,campaignId=first['id'],comparisonCampaignId=second['id'],agentVersionId=agent['id'],datasetVersionId=dataset['id'],agentContentSha256=agent['content_sha256'],datasetContentSha256=dataset['content_sha256'])
except Exception:report['code']='STACK_CAMPAIGN_UNVERIFIED'
finally:
 closed=True
 for client in reversed(clients):
  try:client.logout()
  except Exception:closed=False
 report.update(ownSessionsLoggedOut=closed,finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat());path=root/'.local'/('stack-campaign-smoke-'+str(uuid.uuid4())+'.json');path.open('x',encoding='utf-8').write(json.dumps(report,indent=2,ensure_ascii=False)+'\n');print(json.dumps({'completed':report['completed'],'phase':report.get('phase'),'checks':len(report['checks']),'ownSessionsLoggedOut':closed,'reportPath':str(path)}))
 if not report['completed'] or not closed:raise SystemExit(1)
