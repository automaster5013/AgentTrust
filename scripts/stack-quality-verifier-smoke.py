"""Actual internal Promptfoo service proof; no caller output or credentials printed."""
import datetime,json,pathlib,subprocess,uuid
from stack_compose import stack_compose
root=pathlib.Path(__file__).resolve().parent.parent
report={'completed':False,'checks':[],'rawGeneratedTextPrinted':False,'paidApiCalls':False,'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
stage='runtime'
def run(args):return subprocess.run(args,cwd=root,capture_output=True,text=True,encoding='utf-8',errors='replace',check=True,timeout=90)
try:
 container=run(stack_compose(root)+['ps','-q','stack-quality-verifier']).stdout.strip()
 runtime=json.loads(run(['docker','inspect',container]).stdout)[0]
 identity=json.loads(run(['docker','image','inspect',runtime['Config']['Image']]).stdout)[0]
 assert runtime['Image']==identity['Id']
 report['imageId']=identity['Id']
 assert runtime['State']['Health']['Status']=='healthy' and runtime['Config']['User']=='node' and runtime['HostConfig']['ReadonlyRootfs'] and runtime['HostConfig']['CapDrop']==['ALL'] and not runtime['HostConfig']['PortBindings']
 report['checks'].append('nonroot healthy readonly verifier has no host port')
 stage='actual-sdk-and-privacy'
 code=r'''import {readFileSync,readdirSync,statSync} from 'node:fs';import {randomUUID} from 'node:crypto';import {profileHash} from './quality-policy.mjs';
const token=readFileSync('/run/secrets/stack-worker-token','utf8'),fingerprint=profileHash(),canary='PRIVATE_'+randomUUID();
async function request(body,credential=token){const r=await fetch('http://127.0.0.1:9105/grade',{method:'POST',headers:{'Content-Type':'application/json','X-AgentTrust-Worker-Token':credential},body:JSON.stringify(body),signal:AbortSignal.timeout(17000)});return {status:r.status,value:await r.json()}}
const sample={actual:JSON.stringify({answer:canary}),expected:canary,validatorProfileSha256:fingerprint};
const pass=await request(sample),fail=await request({...sample,actual:'{"answer":"WRONG"}'}),malformed=await request({...sample,actual:'invalid JSON'}),unauthorized=await request(sample,'b'.repeat(64)),changed=await request({...sample,validatorProfileSha256:'b'.repeat(64)}),options=await request({...sample,url:'http://outside.invalid'});
if(pass.status!==200||pass.value.pass!==true||pass.value.engine!=='promptfoo'||pass.value.assertions!==2||pass.value.validatorProfileSha256!==fingerprint||fail.status!==200||fail.value.pass!==false||malformed.status!==200||malformed.value.pass!==false||unauthorized.status!==401||changed.status!==409||options.status!==400)throw Error('Verifier contract unavailable');
let files=0,retained=false;function visit(path){for(const name of readdirSync(path)){const file=path+'/'+name,info=statSync(file);if(info.isDirectory())visit(file);else{files++;if(readFileSync(file).includes(Buffer.from(canary)))retained=true}}}visit('/tmp');
if(retained||JSON.stringify(pass.value).includes(canary)||JSON.stringify(fail.value).includes(canary))throw Error('Raw sample retained');
console.log(JSON.stringify({actualSdkChecks:6,temporaryFilesChecked:files,rawCanaryRetained:false,validatorProfileSha256:fingerprint}));'''
 proof=json.loads(run(['docker','exec',container,'node','--input-type=module','-e',code]).stdout)
 expected=json.loads((root/'services/ai-worker/quality-validator-profile.json').read_text(encoding='utf-8'))['validatorProfileSha256']
 assert proof['validatorProfileSha256']==expected and proof['rawCanaryRetained'] is False
 report.update(proof);report['checks'].extend(['actual SDK pass and fail, malformed JSON and bound profile refusal','raw private canary absent from temporary files and response'])
 stage='logs';assert not run(['docker','logs',container]).stdout.strip();report['checks'].append('service produces no raw evaluation logs')
 report['completed']=True
except Exception as error:report.update(errorType=type(error).__name__,failedStage=stage)
finally:
 report['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();path=root/'.local'/('stack-quality-verifier-smoke-'+str(uuid.uuid4())+'.json');path.open('x',encoding='utf-8').write(json.dumps(report,indent=2)+'\n');print(json.dumps({'completed':report['completed'],'checks':len(report['checks']),'failedStage':report.get('failedStage'),'reportPath':str(path),'rawSecretsPrinted':False}))
if not report['completed']:raise SystemExit(1)
