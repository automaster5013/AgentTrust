"""Two-case version-bound campaigns using actual fixed local inference; no paid calls."""
import datetime,json,pathlib,re,subprocess,time,uuid
from stack_test_client import StackClient
root=pathlib.Path(__file__).resolve().parent.parent;client=None;report={'completed':False,'checks':[],'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'realLocalInference':True,'paidApiCalls':False,'rawGeneratedTextPrinted':False,'legacyDatabaseWrites':False};digest='sha256:7df6b6e09427a769808717c0a93cadc4ae99ed4eb8bf5ca557c90846becea435'
try:
 assert (root/'.local/stack/providers-enabled').exists();client=StackClient('http://127.0.0.1:4320',json.loads((root/'.local/stack/demo-credentials.json').read_text(encoding='utf-8')),report);owner=client.login('demo-admin');suffix=uuid.uuid4().hex[:12];cases=[{'id':'required-pass','scenario':'pass','required':True},{'id':'optional-pass','scenario':'pass','required':False}];dataset=client.request('versions/datasets','POST',{'key':'local-campaign-data-'+suffix,'version':1,'cases':cases});three=client.request('versions/datasets','POST',{'key':'local-campaign-data-'+suffix,'version':2,'cases':cases+[{'id':'third-pass','scenario':'pass','required':True}]});records=[];run_ids=[]
 for version,provider in enumerate(['ollama','openai-compatible'],1):
  report['phase']=provider;agent=client.request('versions/agents','POST',{'key':'local-campaign-agent-'+suffix,'version':version,'provider':provider,'description':'Fixed local model campaign'});client.request('campaigns','POST',{'agentVersionId':agent['id'],'datasetVersionId':three['id'],'requiresApproval':False},{'Idempotency-Key':str(uuid.uuid4())},expected=400)
  record=client.request('campaigns','POST',{'agentVersionId':agent['id'],'datasetVersionId':dataset['id'],'requiresApproval':True},{'Idempotency-Key':str(uuid.uuid4())});until=time.monotonic()+130
  while record['state']=='queued' and time.monotonic()<until:time.sleep(1);record=client.request('campaigns/'+record['id'])
  assert record['state']=='succeeded' and record['decision']=='pass' and len(record['cases'])==2
  for case in record['cases']:
   child=client.request('runs/'+case['runId']);assert child['provider']==provider and child['result']['executionEngine']=='python-'+provider and child['decision']=='pass';assert any(rule['id']=='provider-model' and digest in rule['reason'] for rule in child['result']['rules']);assert any(rule['id']=='output-sha256' and re.fullmatch('[a-f0-9]{64}',rule['reason']) for rule in child['result']['rules']);run_ids.append(case['runId'])
  assert not client.request('campaigns/'+record['id']+'/gate')['deploymentAllowed'];client.request('campaigns/'+record['id']+'/reviews','POST',{'decision':'approved','reason':'Review both actual local model cases and their immutable versions'});assert client.request('campaigns/'+record['id']+'/gate')['deploymentAllowed'];records.append(record);report['checks'].append(provider+' executes two bound cases on exact local model digest; parent approval is required')
 diff=client.request('campaigns/'+records[1]['id']+'/comparison/'+records[0]['id']);assert diff['comparison']['status']=='no-regression' and diff['comparison']['deploymentAuthority'] is False;report['checks'].append('provider version change compares only the same immutable dataset without granting authority')
 for value in [owner['organizationId'],owner['projectId'],*run_ids]:assert str(uuid.UUID(value))==value
 ids=','.join("'"+value+"'" for value in run_ids);sql=f"BEGIN;SET LOCAL ROLE agenttrust_stack_api;SELECT set_config('agenttrust.organization_id','{owner['organizationId']}',true);SELECT set_config('agenttrust.project_id','{owner['projectId']}',true);SELECT count(*) FROM stack_provider_attempts WHERE run_id IN ({ids});ROLLBACK;"
 command=subprocess.run(['docker','exec','-i','agenttrust-stack-db-1','psql','-U','agenttrust_stack','-d','agenttrust_stack','-tA','-v','ON_ERROR_STOP=1'],cwd=root,input=sql,capture_output=True,text=True,timeout=15);assert command.returncode==0 and command.stdout.splitlines()[-2]=='4';report['checks'].append('each of four actual local executions has exactly one immutable provider reservation');report.update(completed=True,campaignIds=[r['id'] for r in records],datasetVersionId=dataset['id'],sourceManifestDigest=digest)
except Exception:report['code']='STACK_CAMPAIGN_MODEL_UNVERIFIED'
finally:
 logged=False
 if client:
  try:client.logout();logged=not client.logged
  except Exception:pass
 report.update(ownSessionLoggedOut=logged,finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat());path=root/'.local'/('stack-campaign-model-'+str(uuid.uuid4())+'.json');path.open('x',encoding='utf-8').write(json.dumps(report,indent=2)+'\n');print(json.dumps({'completed':report['completed'],'phase':report.get('phase'),'checks':len(report['checks']),'ownSessionLoggedOut':logged,'reportPath':str(path)}))
 if not report['completed'] or not logged:raise SystemExit(1)
