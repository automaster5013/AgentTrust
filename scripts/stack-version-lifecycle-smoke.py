"""Synthetic scoped retirement, historical integrity and signed fail-closed integration."""
import base64,datetime,json,pathlib,secrets,subprocess,time,uuid
import concurrent.futures,threading
from stack_test_client import StackClient
from stack_business_fingerprint import sql
ROOT=pathlib.Path(__file__).resolve().parent.parent
report={'completed':False,'checks':[],'paidProviderCalled':False,'externalDeploymentPerformed':False,'credentialsRecorded':False};clients=[]
def wait(client,record):
 end=time.monotonic()+40
 while record['state']=='queued' and time.monotonic()<end:
  time.sleep(.4);record=client.request('campaigns/'+record['id'])
 assert record['state']=='succeeded' and record['decision']=='pass';return record
def campaign(client,agent,dataset,baseline=None,key=None,expected=200):
 body={'agentVersionId':agent['id'],'datasetVersionId':dataset['id'],'requiresApproval':True}
 if baseline:body.update(baselineCampaignId=baseline['id'],evidenceMaxAgeSeconds=3600)
 return client.request('campaigns','POST',body,{'Idempotency-Key':key or str(uuid.uuid4())},expected=expected)
def archive(client,record):
 end=time.monotonic()+25
 while True:
  try:return client.request('campaigns/'+record['id']+'/evidence')
  except AssertionError:
   assert client.report.get('unexpectedHttpStatus')==409 and time.monotonic()<end
   for name in ['unexpectedHttpStatus','expectedHttpStatus','responseCode']:client.report.pop(name,None)
   time.sleep(.5)
def anchored(client,user,record):
 proof=archive(client,record);nonce=secrets.token_hex(32);started=int(time.time()*1000)
 frame=client.request('campaigns/'+record['id']+'/gate-check/'+nonce)
 result=subprocess.run(['node','--experimental-strip-types','scripts/stack-verify-current-gate.ts','--trusted-public-key','.local/stack/gate-keys/public-key.pem'],input=json.dumps({'user':user,'record':record,'evidence':proof,'frame':frame,'campaignId':record['id'],'challenge':nonce,'requestStartedAt':started}),cwd=ROOT,capture_output=True,text=True,encoding='utf-8',timeout=15)
 assert result.returncode==0;value=json.loads(result.stdout)
 assert value['completed'] and value['versionLifecycleBound'] and len(value['versionLifecycleSha256'])==64
 return value
def receipt(client,record):return client.request('campaigns/'+record['id']+'/receipts','POST',{'note':'Own lifecycle integration observation'},{'Idempotency-Key':str(uuid.uuid4())})
def offline(client,user,record,proof,retired):
 bundle=client.request('campaigns/'+record['id']+'/receipts/'+proof['receiptId']+'/bundle')
 code="""import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';import {observationReport} from './scripts/stack-observation-report.ts';
const v=JSON.parse(readFileSync(0,'utf8')),pem=readFileSync('.local/stack/gate-keys/public-key.pem','utf8'),scope={organization:v.user.organizationId,project:v.user.projectId,campaign:v.record.id};
const result=await observationReport(v.bundle,pem,scope,createHash('sha256').update(JSON.stringify(v.bundle)).digest('hex'));
if(!result.html.includes('서명 발급 당시 버전 상태')||v.retired&&!result.html.includes('· 폐기 ·')||v.baseline&&!result.baselineBytesVerified)throw Error('LIFECYCLE_REPORT_UNVERIFIED');
const altered=structuredClone(v.bundle),bytes=Buffer.from(altered.receipt.payloadBase64,'base64');bytes[bytes.length-2]^=1;altered.receipt.payloadBase64=bytes.toString('base64');altered.receipt.payloadSha256=createHash('sha256').update(bytes).digest('hex');
let refused=false;try{await observationReport(altered,pem,scope,createHash('sha256').update(JSON.stringify(altered)).digest('hex'))}catch{refused=true}if(!refused)throw Error('TAMPER_NOT_REFUSED');
console.log(JSON.stringify({verified:true,tamperedSignedBytesRefused:true,baselineBytesVerified:result.baselineBytesVerified}));"""
 result=subprocess.run(['node','--experimental-strip-types','--input-type=module','-e',code],input=json.dumps({'bundle':bundle,'user':user,'record':record,'retired':retired,'baseline':len(json.loads(base64.b64decode(proof['payloadBase64']))['versionLifecycle']['versions'])==4}),cwd=ROOT,capture_output=True,text=True,encoding='utf-8',timeout=15)
 assert result.returncode==0 and json.loads(result.stdout)['verified']
try:
 credentials=json.loads((ROOT/'.local/stack/demo-credentials.json').read_text(encoding='utf-8'))
 admin=StackClient('http://127.0.0.1:4320',credentials,report,clients);user=admin.login('demo-admin')
 viewer=StackClient('http://127.0.0.1:4320',credentials,report,clients);viewer.login('demo-viewer')
 editor=StackClient('http://127.0.0.1:4320',credentials,report,clients);editor.login('demo-editor')
 foreign=StackClient('http://127.0.0.1:4320',credentials,report,clients);foreign.login('other-admin')
 for index,(location,kind) in enumerate([('candidate','agents'),('candidate','datasets'),('baseline','agents'),('baseline','datasets')]):
  if index==2:
   # Let the real project quota expire; never delete Redis keys or increase limits.
   until=time.monotonic()+62
   while time.monotonic()<until:time.sleep(min(1,until-time.monotonic()))
  report['phase']=location+'-'+kind;suffix=uuid.uuid4().hex[:10]
  agent=admin.request('versions/agents','POST',{'key':'life-agent-'+suffix,'version':1,'provider':'synthetic','description':'Own immutable lifecycle integration'})
  dataset=admin.request('versions/datasets','POST',{'key':'life-data-'+suffix,'version':1,'cases':[{'id':'required','scenario':'pass','required':True}]})
  baseline=wait(admin,campaign(admin,agent,dataset)) if location=='baseline' else None
  candidate_agent=admin.request('versions/agents','POST',{'key':'life-agent-'+suffix,'version':2,'provider':'synthetic','description':'Own candidate version'}) if baseline else agent
  key=str(uuid.uuid4());record=wait(admin,campaign(admin,candidate_agent,dataset,baseline,key))
  admin.request('campaigns/'+record['id']+'/reviews','POST',{'decision':'approved','reason':'Own active version proof'})
  assert anchored(admin,user,record)['deploymentAllowedAtRead']
  old_archive=archive(admin,record);old_receipt=receipt(admin,record)
  target=(agent if baseline else candidate_agent) if kind=='agents' else dataset
  path='versions/'+kind+'/'+target['id'];original=admin.request(path);active=viewer.request(path+'/lifecycle')
  assert active['state']=='active' and active['contentSha256']==target['content_sha256']
  viewer.request(path+'/lifecycle/retirement','POST',{'reason':'No viewer permission'},expected=403)
  editor.request(path+'/lifecycle/retirement','POST',{'reason':'No editor permission'},expected=403)
  foreign.request(path+'/lifecycle',expected=404);foreign.request(path+'/lifecycle/retirement','POST',{'reason':'Foreign scope'},expected=404)
  for reason in ['', ' ', 'x'*501]:admin.request(path+'/lifecycle/retirement','POST',{'reason':reason},expected=400)
  admin.request(path+'/lifecycle/retirement','POST',{'reason':'Unknown field must fail','state':'active'},expected=400)
  retired=admin.request(path+'/lifecycle/retirement','POST',{'reason':'Own superseded test version'})
  assert retired['state']=='retired' and retired['retiredBy']==user['actorId'] and retired['contentSha256']==target['content_sha256']
  assert admin.request(path+'/lifecycle/retirement','POST',{'reason':'Own superseded test version'})==retired
  admin.request(path+'/lifecycle/retirement','POST',{'reason':'Different immutable reason'},expected=409)
  assert viewer.request(path+'/lifecycle')==retired and admin.request(path)==original
  assert campaign(admin,candidate_agent,dataset,baseline,key)['id']==record['id']
  campaign(admin,candidate_agent,dataset,baseline,expected=409)
  gate=admin.request('campaigns/'+record['id']+'/gate');assert not gate['deploymentAllowed'] and gate['policyStatus']=='evaluated'
  admin.request('campaigns/'+record['id']+'/reviews','POST',{'decision':'approved','reason':'Cannot override retirement'},expected=409)
  assert not anchored(admin,user,record)['deploymentAllowedAtRead']
  assert archive(admin,record)==old_archive
  assert admin.request('campaigns/'+record['id']+'/receipts/'+old_receipt['receiptId'])==old_receipt
  new_receipt=receipt(admin,record);payload=json.loads(base64.b64decode(new_receipt['payloadBase64']))
  assert payload['schemaVersion']==4 and not payload['observedGate']['deploymentAllowed'] and any(v['state']=='retired' for v in payload['versionLifecycle']['versions'])
  offline(admin,user,record,old_receipt,False);offline(admin,user,record,new_receipt,True)
  report['checks'].append({'target':location+'-'+kind,'campaignId':record['id'],'roleAndScopeRefused':True,'originalVersionAndArchiveUnchanged':True,'oldSignatureUnchanged':True,'actualCurrentSignatureVerified':True,'retirementCannotBeOverridden':True,'historicalReplayPreserved':True,'bothHistoricalBundlesVerifiedOffline':True,'tamperedSignedBytesRefused':True})
 report['phase']='concurrent-admission-retirement';races=[]
 for kind in ['agents','datasets']:
  suffix=uuid.uuid4().hex[:10]
  agent=admin.request('versions/agents','POST',{'key':'life-race-'+suffix,'version':1,'provider':'synthetic','description':'Own concurrent admission fixture'})
  dataset=admin.request('versions/datasets','POST',{'key':'life-race-data-'+suffix,'version':1,'cases':[{'id':'required','scenario':'pass','required':True}]})
  target=agent if kind=='agents' else dataset;path='versions/'+kind+'/'+target['id'];barrier=threading.Barrier(2);key=str(uuid.uuid4())
  def admit():
   barrier.wait(timeout=5)
   try:return campaign(editor,agent,dataset,key=key)
   except AssertionError:
    assert editor.report.get('unexpectedHttpStatus')==409
    for name in ['unexpectedHttpStatus','expectedHttpStatus','responseCode']:editor.report.pop(name,None)
    return None
  def retire():
   barrier.wait(timeout=5);return admin.request(path+'/lifecycle/retirement','POST',{'reason':'Own concurrent retirement'})
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
   admission=pool.submit(admit);retirement=pool.submit(retire);record=admission.result(timeout=45);state=retirement.result(timeout=45)
  assert state['state']=='retired';campaign(editor,agent,dataset,expected=409)
  if record:
   record=wait(admin,record);gate=admin.request('campaigns/'+record['id']+'/gate');assert gate['policyStatus']=='evaluated' and not gate['deploymentAllowed']
   admin.request('campaigns/'+record['id']+'/reviews','POST',{'decision':'approved','reason':'Cannot override concurrent retirement'},expected=409)
  races.append({'kind':kind,'requestsStartedTogether':True,'admission': 'completed-before-retirement' if record else 'refused','afterRetirementAdmissionRefused':True,'currentPermissionRefused':True})
 report['concurrentRaces']=races
 for table in ['stack_agent_version_retirements','stack_dataset_version_retirements']:
  assert sql('BEGIN READ ONLY;SET LOCAL ROLE agenttrust_stack_api;SELECT count(*) FROM '+table+';ROLLBACK;').splitlines()[-2]=='0'
  assert sql("SELECT has_table_privilege('agenttrust_stack_api','"+table+"','UPDATE')::text||'|'||has_table_privilege('agenttrust_stack_api','"+table+"','DELETE')::text;")=='false|false'
  statement="BEGIN;SET LOCAL ROLE agenttrust_stack_api;SELECT set_config('agenttrust.organization_id','"+user['organizationId']+"',true);SELECT set_config('agenttrust.project_id','"+user['projectId']+"',true);INSERT INTO "+table+"(version_id,organization_id,project_id,actor_id,reason) VALUES('"+str(uuid.uuid4())+"','"+str(uuid.uuid4())+"','"+str(uuid.uuid4())+"','"+user['actorId']+"','Own rejected foreign-scope insert');ROLLBACK;"
  result=subprocess.run(['docker','exec','-i','agenttrust-stack-db-1','psql','-U','agenttrust_stack','-d','agenttrust_stack','-v','ON_ERROR_STOP=1','-At'],input=statement,cwd=ROOT,capture_output=True,text=True,encoding='utf-8',timeout=15)
  assert result.returncode!=0 and 'row-level security policy' in result.stderr
 report['foreignInsertRefusedByRls']=True
 report.update(completed=True,rlsAndImmutablePrivilegesVerified=True)
except Exception as error:report.update(code='VERSION_LIFECYCLE_UNVERIFIED',errorType=type(error).__name__)
finally:
 closed=True
 for client in reversed(clients):
  try:client.logout()
  except Exception:closed=False
 report.update(ownSessionsLoggedOut=closed,finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
 path=ROOT/'.local'/('stack-version-lifecycle-'+str(uuid.uuid4())+'.json');path.open('x',encoding='utf-8').write(json.dumps(report,indent=2)+'\n')
 print(json.dumps({'completed':report['completed'],'checks':len(report['checks']),'phase':report.get('phase'),'ownSessionsLoggedOut':closed,'reportPath':str(path),'unexpectedHttpStatus':report.get('unexpectedHttpStatus'),'errorType':report.get('errorType')}))
if not report['completed'] or not closed:raise SystemExit(1)
