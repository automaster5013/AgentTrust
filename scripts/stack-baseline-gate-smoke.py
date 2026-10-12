"""Own synthetic campaigns only: immutable baseline admission, actual OPA and signed expiry."""
import base64,datetime,hashlib,json,pathlib,secrets,subprocess,time,uuid
from stack_test_client import StackClient
from stack_business_fingerprint import sql
ROOT=pathlib.Path(__file__).resolve().parent.parent
report={'completed':False,'checks':[],'credentialsRecorded':False,'paidProviderCalled':False,'actualDeploymentPerformed':False,'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()};clients=[]

def checked(label):report['checks'].append(label)
def wait(client,record):
    until=time.monotonic()+35
    while record['state']=='queued' and time.monotonic()<until:
        time.sleep(.4);record=client.request('campaigns/'+record['id'])
    assert record['state']!='queued';return record
def create(client,agent,dataset,baseline=None,age=None,key=None,expected=200):
    data={'agentVersionId':agent['id'],'datasetVersionId':dataset['id'],'requiresApproval':True}
    if baseline is not None:data['baselineCampaignId']=baseline
    if age is not None:data['evidenceMaxAgeSeconds']=age
    return client.request('campaigns','POST',data,{'Idempotency-Key':key or str(uuid.uuid4())},expected=expected)
def verify(client,user,record):
    until=time.monotonic()+20
    while True:
        try:evidence=client.request('campaigns/'+record['id']+'/evidence');break
        except AssertionError:
            assert client.report.get('unexpectedHttpStatus')==409 and time.monotonic()<until
            report['expectedArchiveNotReadyRetries']=report.get('expectedArchiveNotReadyRetries',0)+1
            for field in ['unexpectedHttpStatus','expectedHttpStatus','responseCode']:client.report.pop(field,None)
            time.sleep(.5)
    nonce=secrets.token_hex(32);started=int(time.time()*1000);frame=client.request('campaigns/'+record['id']+'/gate-check/'+nonce)
    code="""import {readFileSync} from 'node:fs';
import {verifiedCampaign,verifiedCampaignArchive} from './apps/console/src/lib/campaign-contracts.ts';
import {verifyAnchoredGateCheck} from './scripts/stack-current-gate-anchor.ts';
const v=JSON.parse(readFileSync(0,'utf8')),r=await verifiedCampaign(v.record,v.user,v.record.id),a=await verifiedCampaignArchive(v.evidence,v.user,r);
const result=await verifyAnchoredGateCheck(v.frame,readFileSync('.local/stack/gate-keys/public-key.pem','utf8'),v.user,r,a,v.nonce,v.started);
if(!result.releaseRequirements?.enabled)throw Error('BASELINE_UNBOUND');
console.log(JSON.stringify({verified:true,allowed:result.observedGate.deploymentAllowed,checkedAt:result.checkedAtEpochMillis,expiresAt:result.expiresAtEpochMillis,baseline:result.releaseRequirements.baselineCampaignId}));"""
    result=subprocess.run(['node','--experimental-strip-types','--input-type=module','-e',code],input=json.dumps({'user':user,'record':record,'evidence':evidence,'frame':frame,'nonce':nonce,'started':started}),cwd=ROOT,capture_output=True,text=True,encoding='utf-8',timeout=15)
    assert result.returncode==0;value=json.loads(result.stdout);assert value['verified'];return value

try:
    credentials=json.loads((ROOT/'.local/stack/demo-credentials.json').read_text(encoding='utf-8'))
    admin=StackClient('http://127.0.0.1:4320',credentials,report,clients);user=admin.login('demo-admin')
    suffix=uuid.uuid4().hex[:12];report['phase']='admission'
    agent=admin.request('versions/agents','POST',{'key':'baseline-agent-'+suffix,'version':1,'provider':'synthetic','description':'Immutable release baseline smoke'})
    dataset=admin.request('versions/datasets','POST',{'key':'baseline-data-'+suffix,'version':1,'cases':[{'id':'required','scenario':'pass','required':True}]})
    baseline=wait(admin,create(admin,agent,dataset));old=admin.request('campaigns/'+baseline['id']+'/release-requirements');assert old['enabled'] is False
    key=str(uuid.uuid4());candidate=wait(admin,create(admin,agent,dataset,baseline['id'],60,key));requirements=admin.request('campaigns/'+candidate['id']+'/release-requirements')
    assert requirements['enabled'] and requirements['baselineCampaignId']==baseline['id'] and requirements['comparison']['status']=='no-regression'
    assert create(admin,agent,dataset,baseline['id'],60,key)['id']==candidate['id']
    create(admin,agent,dataset,baseline['id'],61,key,409);create(admin,agent,dataset,None,None,key,409)
    create(admin,agent,dataset,baseline['id'],None,expected=400);create(admin,agent,dataset,None,60,expected=400)
    for age in [59,86401,60.5,'60',True]:create(admin,agent,dataset,baseline['id'],age,expected=400)
    admin.request('versions/agents','POST',{'key':'baseline-agent-'+suffix,'version':1.5,'provider':'synthetic','description':'Fractional version must fail'},expected=400)
    admin.request('versions/datasets','POST',{'key':'baseline-data-'+suffix,'version':1.5,'cases':[{'id':'required','scenario':'pass','required':True}]},expected=400)
    checked('atomic baseline admission and exact replay bind age; changed and partial parameters refused')
    other=admin.request('versions/agents','POST',{'key':'baseline-other-'+suffix,'version':1,'provider':'synthetic','description':'Wrong agent name'})
    create(admin,other,dataset,baseline['id'],3600,expected=409)
    different=admin.request('versions/datasets','POST',{'key':'baseline-data-'+suffix,'version':2,'cases':[{'id':'required','scenario':'pass','required':True}]})
    create(admin,agent,different,baseline['id'],3600,expected=409)
    foreign=StackClient('http://127.0.0.1:4320',credentials,report,clients);foreign.login('other-admin')
    foreign.request('campaigns/'+candidate['id']+'/release-requirements',expected=404)
    create(foreign,agent,dataset,baseline['id'],3600,expected=404)
    checked('foreign scope and substituted agent or exact dataset version are refused')
    report['phase']='review-and-signature'
    assert not admin.request('campaigns/'+candidate['id']+'/gate')['deploymentAllowed']
    admin.request('campaigns/'+candidate['id']+'/reviews','POST',{'decision':'approved','reason':'Own synthetic immutable baseline approval'})
    gate=admin.request('campaigns/'+candidate['id']+'/gate');assert gate['deploymentAllowed'] and gate['policyStatus']=='evaluated'
    current=verify(admin,user,candidate);assert current['allowed'] and current['baseline']==baseline['id'] and current['expiresAt']<=requirements['evidenceExpiresAtEpochMillis']
    checked('real Python result, administrator review and actual anchored Java v2 signature allow only current evidence')
    report['phase']='immutability'
    statement="BEGIN READ ONLY;SET LOCAL ROLE agenttrust_stack_api;SELECT count(*) FROM stack_campaign_release_requirements;ROLLBACK;"
    assert sql(statement).splitlines()[-2]=='0'
    assert sql("SELECT has_table_privilege('agenttrust_stack_api','stack_campaign_release_requirements','UPDATE')::text||'|'||has_table_privilege('agenttrust_stack_api','stack_campaign_release_requirements','DELETE')::text;")=='false|false'
    checked('new requirement records are hidden without RLS scope and API cannot update or delete them')
    report['phase']='natural-evidence-expiry'
    remaining=requirements['evidenceExpiresAtEpochMillis']/1000-time.time()
    if remaining>15:time.sleep(remaining-15)
    near=verify(admin,user,candidate);assert near['allowed'] and near['expiresAt']<=requirements['evidenceExpiresAtEpochMillis'] and near['expiresAt']-near['checkedAt']<16000
    remaining=requirements['evidenceExpiresAtEpochMillis']/1000-time.time()
    if remaining>0:time.sleep(remaining+.1)
    expired=admin.request('campaigns/'+candidate['id']+'/gate');assert expired['decision']=='inconclusive' and not expired['deploymentAllowed'] and expired['policyStatus']=='evaluated'
    admin.request('campaigns/'+candidate['id']+'/reviews','POST',{'decision':'approved','reason':'Reapproval cannot override naturally expired evidence'})
    assert not admin.request('campaigns/'+candidate['id']+'/gate')['deploymentAllowed']
    after=verify(admin,user,candidate);assert not after['allowed']
    assert admin.request('campaigns/'+candidate['id']+'/release-requirements')==requirements
    checked('natural 60-second baseline expiry bounds permitted signature; fresh approval cannot override expired evidence')
    report['phase']='historical-v3-baseline-bundle'
    receipt=admin.request('campaigns/'+candidate['id']+'/receipts','POST',{'note':'Own expired-baseline observation'},{'Idempotency-Key':str(uuid.uuid4())})
    bundle=admin.request('campaigns/'+candidate['id']+'/receipts/'+receipt['receiptId']+'/bundle')
    assert bundle['schemaVersion']==2 and json.loads(base64.b64decode(receipt['payloadBase64']))['schemaVersion']==4
    code="""import {readFileSync} from 'node:fs';import {observationReport} from './scripts/stack-observation-report.ts';import {createHash} from 'node:crypto';
const v=JSON.parse(readFileSync(0,'utf8')),digest=createHash('sha256').update(JSON.stringify(v.bundle)).digest('hex');
const result=await observationReport(v.bundle,readFileSync('.local/stack/gate-keys/public-key.pem','utf8'),{organization:v.user.organizationId,project:v.user.projectId,campaign:v.campaign},digest);
if(!result.baselineBytesVerified||!result.html.includes(v.baseline)||!result.html.includes('발급 당시 허용 안 됨')||!result.html.includes('실제 회귀 비교를 오프라인에서 검증했습니다.'))throw Error('BASELINE_REPORT_UNVERIFIED');
console.log(JSON.stringify({verified:true,childArchives:result.childArchives,baselineBytesVerified:true,baselineChildArchives:result.baselineChildArchives,htmlBytes:Buffer.byteLength(result.html),networkUsed:false}));"""
    result=subprocess.run(['node','--experimental-strip-types','--input-type=module','-e',code],input=json.dumps({'bundle':bundle,'user':user,'campaign':candidate['id'],'baseline':baseline['id']}),cwd=ROOT,capture_output=True,text=True,encoding='utf-8',timeout=15)
    assert result.returncode==0;report['historicalBundle']=json.loads(result.stdout);assert report['historicalBundle']['verified']
    checked('actual Java v3 historical signature binds candidate and baseline parent/child bytes; offline report verifies both chains and recomputes comparison after expiry')
    report.update(completed=True,candidateCampaignId=candidate['id'],baselineCampaignId=baseline['id'],evidenceExpiresAtEpochMillis=requirements['evidenceExpiresAtEpochMillis'])
except Exception as error:report.update(code='BASELINE_GATE_UNVERIFIED',errorType=type(error).__name__)
finally:
    closed=True
    for client in reversed(clients):
        try:client.logout()
        except Exception:closed=False
    report.update(ownSessionsLoggedOut=closed,finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
    path=ROOT/'.local'/('stack-baseline-gate-'+str(uuid.uuid4())+'.json');path.open('x',encoding='utf-8').write(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'completed':report['completed'],'checks':len(report['checks']),'phase':report.get('phase'),'ownSessionsLoggedOut':closed,'reportPath':str(path),'unexpectedHttpStatus':report.get('unexpectedHttpStatus'),'errorType':report.get('errorType')}))
if not report['completed'] or not closed:raise SystemExit(1)
