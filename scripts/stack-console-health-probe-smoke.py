"""Exercise the Helm probe Host contract against the actual local Console server."""
import datetime,json,pathlib,subprocess,uuid
ROOT=pathlib.Path(__file__).resolve().parent.parent
NAME='agenttrust-stack-console-1'
report={'completed':False,'clusterContacted':False,'deploymentPerformed':False,'privateInputsRead':False,'authenticatedSessionCreated':False}
def run(args):
 result=subprocess.run(args,cwd=ROOT,capture_output=True,text=True,encoding='utf-8',timeout=30,check=True)
 return result.stdout.strip()
try:
 pattern='{{.Id}}|{{.Image}}|{{.RestartCount}}|{{.State.Health.Status}}|{{.State.OOMKilled}}'
 before=run(['docker','inspect','--format',pattern,NAME]);assert before.endswith('|healthy|false')
 code="""const http=require('node:http');async function probe(host,path){return new Promise((resolve,reject)=>{const r=http.get({host:'127.0.0.1',port:3000,path,headers:{Host:host}},response=>{response.resume();response.on('end',()=>resolve(response.statusCode));});r.setTimeout(5000,()=>r.destroy(new Error('timeout')));r.on('error',reject);});}(async()=>{console.log(JSON.stringify({allowed:await probe('127.0.0.1:4320','/'),foreign:await probe('10.0.0.123:3000','/'),foreignBackend:await probe('10.0.0.123:3000','/backend/me')}));})().catch(()=>process.exit(1));"""
 statuses=json.loads(run(['docker','exec',NAME,'node','-e',code]));assert statuses=={'allowed':200,'foreign':200,'foreignBackend':403}
 assert run(['docker','inspect','--format',pattern,NAME])==before
 report.update(completed=True,actualConsoleExercised=True,allowedProbeStatus=200,publicPageForeignHostStatus=200,backendForeignHostStatus=403,containerUnchanged=True)
except Exception as error:report.update(errorType=type(error).__name__,code='CONSOLE_HEALTH_PROBE_UNVERIFIED')
finally:
 report['checkedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();path=ROOT/'.local'/('stack-console-health-probe-'+str(uuid.uuid4())+'.json');path.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print(json.dumps({'completed':report['completed'],'reportPath':str(path)}))
if not report['completed']:raise SystemExit(1)
