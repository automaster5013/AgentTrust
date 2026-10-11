"""Actual v3 Java observations and complete offline baseline chains; own fixtures only."""
import base64,datetime,json,pathlib,subprocess,uuid
from stack_test_client import StackClient
ROOT=pathlib.Path(__file__).resolve().parent.parent
report={'completed':False,'checks':[],'credentialsRecorded':False,'paidApiCalls':False,'actualDeploymentPerformed':False,'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()};clients=[]
def latest(pattern):
 for path in sorted((ROOT/'.local').glob(pattern),key=lambda p:p.stat().st_mtime,reverse=True):
  value=json.loads(path.read_text(encoding='utf-8'))
  if value.get('completed') and value.get('candidateCampaignId') and value.get('baselineCampaignId'):return value
 raise ValueError('Own baseline fixture unavailable')
try:
 credentials=json.loads((ROOT/'.local/stack/demo-credentials.json').read_text(encoding='utf-8'));admin=StackClient('http://127.0.0.1:4320',credentials,report,clients);owner=admin.login('demo-admin');viewer=StackClient('http://127.0.0.1:4320',credentials,report,clients);viewer.login('demo-viewer');foreign=StackClient('http://127.0.0.1:4320',credentials,report,clients);foreign.login(next(c['username'] for c in credentials if c['organizationId']!=owner['organizationId']))
 for kind,source in [('expired',latest('stack-baseline-gate-*.json')),('unresolved',latest('stack-baseline-unresolved-*.json'))]:
  candidate=source['candidateCampaignId'];baseline=source['baselineCampaignId'];assert str(uuid.UUID(candidate))==candidate and str(uuid.UUID(baseline))==baseline
  receipt=admin.request('campaigns/'+candidate+'/receipts','POST',{'note':'Own '+kind+' comparison byte-chain observation'},{'Idempotency-Key':str(uuid.uuid4())});payload=json.loads(base64.b64decode(receipt['payloadBase64']));assert payload['schemaVersion']==3 and payload['baselineArchives']['campaignId']==baseline and payload['observedGate']['deploymentAllowed'] is False
  bundle=viewer.request('campaigns/'+candidate+'/receipts/'+receipt['receiptId']+'/bundle');assert bundle['schemaVersion']==2 and bundle['baseline']['campaign']['id']==baseline
  foreign.request('campaigns/'+candidate+'/receipts/'+receipt['receiptId']+'/bundle',expected=404);viewer.request('campaigns/'+candidate+'/receipts','POST',{'note':'Viewer cannot sign'},{'Idempotency-Key':str(uuid.uuid4())},expected=403)
  result=subprocess.run(['node','--experimental-strip-types','scripts/stack-baseline-bundle-offline-verify.ts'],input=json.dumps({'bundle':bundle,'user':owner,'campaignId':candidate,'receiptId':receipt['receiptId']}),cwd=ROOT,capture_output=True,text=True,encoding='utf-8',timeout=20)
  assert result.returncode==0;proof=json.loads(result.stdout);assert proof['completed'] and proof['baselineBytesVerified'] and proof['negativeControls']==6 and proof['networkUsed'] is False
  report['checks'].append({'baselineState':kind,'actualJavaSignatureVerified':True,'baselineBytesVerified':True,'negativeControls':6,'foreignScopeRefused':True,'viewerIssueRefused':True})
 report['completed']=True
except Exception as error:report['errorType']=type(error).__name__
finally:
 closed=True
 for client in reversed(clients):
  try:client.logout()
  except Exception:closed=False
 report.update(ownSessionsLoggedOut=closed,finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat());path=ROOT/'.local'/('stack-baseline-bundle-'+str(uuid.uuid4())+'.json');path.open('x',encoding='utf-8').write(json.dumps(report,indent=2)+'\n');print(json.dumps({'completed':report['completed'],'checks':len(report['checks']),'ownSessionsLoggedOut':closed,'reportPath':str(path),'errorType':report.get('errorType'),'unexpectedHttpStatus':report.get('unexpectedHttpStatus')}))
if not report['completed'] or not closed:raise SystemExit(1)
