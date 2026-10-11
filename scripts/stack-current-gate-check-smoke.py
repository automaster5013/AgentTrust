"""Read existing campaigns through real OIDC/BFF/WebFlux and verify Java signatures in TypeScript."""
import datetime,json,pathlib,secrets,subprocess,time,uuid
from stack_test_client import StackClient
from stack_campaign_evidence import bounded_json,identifier

ROOT=pathlib.Path(__file__).resolve().parent.parent
report={'completed':False,'checks':[],'businessDataWrites':False,'paidApiCalls':False,'credentialsRecorded':False,'actualDeploymentPerformed':False,'currentDeploymentAuthority':False,'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
clients=[]
try:
    sources=sorted((ROOT/'.local').glob('stack-quality-campaign-*/summary.json'),key=lambda p:p.stat().st_mtime,reverse=True)
    reference=next(value for path in sources if (value:=bounded_json(path,65536)).get('completed') and value.get('realLocalInference') and len(value.get('campaignIds',[]))==2)
    campaign=identifier(reference['campaignIds'][0])
    credentials=bounded_json(ROOT/'.local/stack/demo-credentials.json',65536)
    for username in ['demo-viewer','demo-admin']:
        client=StackClient('http://127.0.0.1:4320',credentials,report,clients);user=client.login(username)
        nonce=secrets.token_hex(32);started=int(time.time()*1000)
        record=client.request('campaigns/'+campaign)
        evidence=client.request('campaigns/'+campaign+'/evidence')
        trust=client.request('gate-trust')
        frame=client.request('campaigns/'+campaign+'/gate-check/'+nonce)
        code="""import {readFileSync} from 'node:fs';
import {verifiedCampaign,verifiedCampaignArchive} from './apps/console/src/lib/campaign-contracts.ts';
import {verifiedGateCheck} from './apps/console/src/lib/gate-check-contracts.ts';
const v=JSON.parse(readFileSync(0,'utf8'));
const record=await verifiedCampaign(v.record,v.user,v.record.id);
const archive=await verifiedCampaignArchive(v.evidence,v.user,record);
const check=await verifiedGateCheck(v.frame,v.trust,v.user,record,archive,v.nonce,v.started);
let replayRefused=false;try{await verifiedGateCheck(v.frame,v.trust,v.user,record,archive,'0'.repeat(64),v.started)}catch{replayRefused=true}
if(!replayRefused||check.currentDeploymentAuthority!==false)throw Error('CHECK_UNVERIFIED');
console.log(JSON.stringify({signatureVerified:true,replayRefused:true,currentDeploymentAuthority:false,decision:check.observedGate.decision}));"""
        checked=subprocess.run(['node','--experimental-strip-types','--input-type=module','-e',code],input=json.dumps({'record':record,'evidence':evidence,'trust':trust,'frame':frame,'user':user,'nonce':nonce,'started':started}),cwd=ROOT,capture_output=True,text=True,encoding='utf-8',timeout=15)
        if checked.returncode:raise ValueError('Independent browser contract verification failed')
        verified=json.loads(checked.stdout)
        if verified.get('signatureVerified') is not True or verified.get('replayRefused') is not True:raise ValueError('Independent signature unverified')
        report['checks'].append(username+' verifies actual Java Ed25519 bytes and rejects a different request challenge')
        client.request('campaigns/'+campaign+'/gate-check/'+'g'*64,expected=502)
        client.request('campaigns/'+campaign+'/gate-check/'+nonce,'POST',{},expected=502)
    foreign=StackClient('http://127.0.0.1:4320',credentials,report,clients);foreign.login('other-admin')
    foreign.request('campaigns/'+campaign+'/gate-check/'+secrets.token_hex(32),expected=404)
    report['checks'].append('foreign organization and unsupported challenge/method remain refused')
    report['completed']=True
except Exception as error:report.update(errorType=type(error).__name__,code='CURRENT_GATE_CHECK_UNVERIFIED')
finally:
    closed=True
    for client in reversed(clients):
        try:client.logout()
        except Exception:closed=False
    report.update(ownSessionsLoggedOut=closed,finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
    path=ROOT/'.local'/('stack-current-gate-check-'+str(uuid.uuid4())+'.json')
    with path.open('x',encoding='utf-8') as stream:stream.write(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'completed':report['completed'],'checks':len(report['checks']),'ownSessionsLoggedOut':closed,'reportPath':str(path),'errorType':report.get('errorType'),'unexpectedHttpStatus':report.get('unexpectedHttpStatus')}))
if not report['completed'] or not closed:raise SystemExit(1)
