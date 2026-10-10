"""Read-only model blob verification and isolated corruption refusal; never alter prepared models."""
import datetime,json,os,pathlib,re,subprocess,uuid
root=pathlib.Path(__file__).resolve().parent.parent
directory=root/'.local'/('stack-provider-integrity-'+str(uuid.uuid4()));directory.mkdir(parents=True)
report={'completed':False,'checks':[],'existingModelFilesModified':False,'paidApiCalls':False,'rawSecretsPrinted':False}
def run(args):return subprocess.run(args,cwd=root,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=45)
try:
 reference=os.environ.get('STACK_MODEL_IMAGE','agenttrust-local-model:local');assert reference=='agenttrust-local-model:local' or re.fullmatch(r'ghcr\.io/automaster5013/agenttrust-local-model@sha256:[a-f0-9]{64}',reference)
 volume=json.loads(run(['docker','volume','inspect','agenttrust_stack-ollama-models']).stdout)[0]
 assert volume['Labels']['com.docker.compose.project']=='agenttrust' and volume['Labels']['com.docker.compose.volume']=='stack-ollama-models'
 fixed=['docker','run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--tmpfs','/tmp:size=128m,mode=1777','--memory','1536m','--cpus','2','--pids-limit','64','--mount']
 verified=run(fixed+['type=volume,source=agenttrust_stack-ollama-models,target=/models,readonly',reference,'--version'])
 assert verified.returncode==0 and '0.40.2' in verified.stdout+verified.stderr;report['checks'].append('all seven prepared manifest and blob bytes verified before executable launch')
 for line in (root/'services/local-model/model-sha256.txt').read_text(encoding='utf-8').splitlines():
  assert re.fullmatch(r'[a-f0-9]{64}  /models/(?:blobs/sha256-[a-f0-9]{64}|manifests/registry\.ollama\.ai/library/qwen3/0\.6b)',line)
  relative=line.split('  /models/')[1];target=directory/relative;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(b'isolated-corrupted-model-fixture')
 corrupt=run(fixed+['type=bind,source='+str(directory)+',target=/models,readonly',reference,'--version'])
 assert corrupt.returncode==1 and 'client version' not in corrupt.stdout+corrupt.stderr;report['checks'].append('corrupt isolated model bytes refuse daemon or version launch')
 (directory/'blobs'/'sha256-7f4030143c1c477224c5434f8272c662a8b042079a0a584f0a27a1684fe2e1fa').unlink()
 missing=run(fixed+['type=bind,source='+str(directory)+',target=/models,readonly',reference,'--version'])
 assert missing.returncode==1 and 'client version' not in missing.stdout+missing.stderr and 'No such file or directory' in missing.stderr;report['checks'].append('missing isolated model bytes refuse executable launch')
 report['completed']=True
except Exception as error:report['errorType']=type(error).__name__
finally:
 report['verifiedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();path=directory/'summary.json';path.open('x',encoding='utf-8').write(json.dumps(report,indent=2)+'\n');print(json.dumps({'completed':report['completed'],'checks':len(report['checks']),'reportPath':str(path),'existingModelFilesModified':False,'paidApiCalls':False,'rawSecretsPrinted':False}))
if not report['completed']:raise SystemExit(1)
