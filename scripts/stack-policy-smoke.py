"""Real OPA authorization and fail-closed gate checks; no token in args, logs or reports."""
import datetime,json,pathlib,re,subprocess,time,uuid
from stack_test_client import StackClient
from stack_compose import stack_compose
root=pathlib.Path(__file__).resolve().parent.parent;compose=stack_compose(root);client=None;stopped=False;report={'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'completed':False,'checks':[],'synthetic':True,'credentialsRecorded':False}
def command(args,**kwargs):return subprocess.run(args,cwd=root,capture_output=True,text=True,check=True,**kwargs).stdout
try:
 for service in ['stack-ai-worker','stack-opa']:
  state=json.loads(command(['docker','inspect','agenttrust-'+service+'-1']))[0];assert state['Config']['Labels']['com.docker.compose.project']=='agenttrust' and state['Config']['Labels']['com.docker.compose.service']==service
 token=(root/'.local/stack/opa-token').read_text(encoding='utf-8');assert re.fullmatch('[a-f0-9]{64}',token)
 code="""
import httpx,json,sys,uuid
token=sys.stdin.read();base='http://stack-opa:8181';key=str(uuid.uuid4());body={'input':{'runId':key,'organizationId':key,'projectId':key,'state':'succeeded','evaluationDecision':'pass','approvalRequired':False,'latestReview':'','rules':[{'required':True,'status':'pass'}]}}
with httpx.Client(timeout=3,follow_redirects=False,trust_env=False) as client:
 assert client.post(base+'/v1/data/agenttrust/release/decision',json=body).status_code==401
 headers={'Authorization':'Bearer '+token};response=client.post(base+'/v1/data/agenttrust/release/decision',json=body,headers=headers);assert response.status_code==200 and len(response.content)<=4096
 result=response.json()['result'];assert result['deploymentAllowed'] is True and result['runId']==key
 assert client.get(base+'/v1/data',headers=headers).status_code==401
 assert client.put(base+'/v1/policies/release',content='package overridden',headers=headers).status_code==401
 assert client.post(base+'/v1/data/agenttrust/release/decision',json=body,headers={'Authorization':'Bearer invalid'}).status_code==401
 assert client.get(base+'/health').status_code==200
 print(json.dumps({'completed':True,'policyVersion':result['policyVersion'],'policyDigest':result['policyDigest'],'unauthenticatedDecisionRefused':True,'authenticatedDecisionAllowed':True,'broadDataReadRefused':True,'policyWriteRefused':True,'wrongTokenRefused':True}))
"""
 protected=json.loads(command(['docker','exec','-i','agenttrust-stack-ai-worker-1','python','-c',code],input=token));assert protected['completed'];report['authorization']=protected;report['checks'].append('OPA decision requires token; broad data reads and policy writes remain refused')
 client=StackClient('http://127.0.0.1:4321',json.loads((root/'.local/stack/demo-credentials.json').read_text(encoding='utf-8')),report);client.login('demo-admin');record=client.request('runs','POST',{'scenario':'pass','requiresApproval':False},{'Idempotency-Key':str(uuid.uuid4())});until=time.monotonic()+20
 while record['state']=='queued' and time.monotonic()<until:time.sleep(.25);record=client.request('runs/'+record['id'])
 assert record['state']=='succeeded';gate=client.request('runs/'+record['id']+'/gate');assert gate['deploymentAllowed'] and gate['policyStatus']=='evaluated' and gate['policyDigest']==protected['policyDigest'];report['runId']=record['id'];report['checks'].append('current gate uses the real scoped OPA policy version and digest')
 bound=client.request('runs','POST',{'scenario':'pass','requiresApproval':True},{'Idempotency-Key':str(uuid.uuid4())});until=time.monotonic()+20
 while bound['state']=='queued' and time.monotonic()<until:time.sleep(.25);bound=client.request('runs/'+bound['id'])
 assert bound['state']=='succeeded';owner=next(row for row in json.loads((root/'.local/stack/demo-credentials.json').read_text(encoding='utf-8')) if row['username']=='demo-admin');run_id=bound['id']
 for value in [run_id,owner['organizationId'],owner['projectId'],owner['actorId']]:assert str(uuid.UUID(value))==value
 state=json.loads(command(['docker','inspect','agenttrust-stack-db-1']))[0];assert state['Config']['Labels']['com.docker.compose.project']=='agenttrust' and state['Config']['Labels']['com.docker.compose.service']=='stack-db'
 sql=f"""BEGIN; SET LOCAL ROLE agenttrust_stack_api;
 SELECT set_config('agenttrust.organization_id','{owner['organizationId']}',true);
 SELECT set_config('agenttrust.project_id','{owner['projectId']}',true);
 INSERT INTO stack_reviews(id,run_id,organization_id,project_id,actor_id,decision,reason,policy_version,policy_digest)
 VALUES(gen_random_uuid(),'{run_id}','{owner['organizationId']}','{owner['projectId']}','{owner['actorId']}','approved','Synthetic stale-policy fixture','0.0.0','sha256:{'0'*64}');
 INSERT INTO stack_audit(id,organization_id,project_id,actor_id,action,resource_id)
 VALUES(gen_random_uuid(),'{owner['organizationId']}','{owner['projectId']}','{owner['actorId']}','test.fixture.stale-policy-review','{run_id}'); COMMIT;"""
 command(['docker','exec','-i','agenttrust-stack-db-1','psql','-U','agenttrust_stack','-d','agenttrust_stack','-v','ON_ERROR_STOP=1'],input=sql)
 old=client.request('runs/'+run_id+'/gate');assert old['policyStatus']=='evaluated' and old['decision']=='inconclusive' and not old['deploymentAllowed'];report['checks'].append('synthetic prior-policy approval cannot permit the current policy')
 client.request('runs/'+run_id+'/reviews','POST',{'decision':'approved','reason':'Approve the currently bound policy'});current=client.request('runs/'+run_id+'/gate');assert current['deploymentAllowed'];history=client.request('runs/'+run_id+'/reviews');assert history[0]['policy_version']==current['policyVersion'] and history[0]['policy_digest']==current['policyDigest'] and history[1]['policy_version']=='0.0.0';report['checks'].append('fresh administrator approval binds current policy without rewriting the prior review');report['policyBindingRunId']=run_id
 stopped=True;command(compose+['stop','stack-opa']);unavailable=client.request('runs/'+record['id']+'/gate');assert not unavailable['deploymentAllowed'] and unavailable['decision']=='inconclusive' and unavailable['policyStatus']=='unavailable' and unavailable['policyDigest']==gate['policyDigest'];report['checks'].append('OPA outage refuses release despite passing evaluation')
 command(compose+['up','-d','--wait','stack-opa']);stopped=False;restored=client.request('runs/'+record['id']+'/gate');assert restored['deploymentAllowed'] and restored['policyStatus']=='evaluated';report['checks'].append('restored OPA re-evaluates the same persisted evidence');report['completed']=True
except Exception:
 report['code']='STACK_POLICY_UNVERIFIED'
finally:
 restored=True
 if stopped:
  try:command(compose+['up','-d','--wait','stack-opa'])
  except Exception:restored=False
 logged_out=False
 if client:
  try:client.logout();logged_out=not client.logged
  except Exception:pass
 report.update(dependencyRestored=restored,ownSessionLoggedOut=logged_out,finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat());path=root/'.local'/('stack-policy-smoke-'+str(uuid.uuid4())+'.json');path.open('x',encoding='utf-8').write(json.dumps(report,indent=2)+'\n');print(json.dumps({'completed':report['completed'],'checks':len(report['checks']),'dependencyRestored':restored,'ownSessionLoggedOut':logged_out,'reportPath':str(path)}))
 if not report['completed'] or not restored or not logged_out:raise SystemExit(1)
