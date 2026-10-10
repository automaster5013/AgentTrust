"""Create Syft SBOMs and Trivy reports for exact exported image IDs, without a Docker socket."""
import datetime,hashlib,json,os,pathlib,re,subprocess,uuid,traceback
root=pathlib.Path(__file__).resolve().parent.parent
directory=root/'.local'/('stack-security-images-'+str(uuid.uuid4()));directory.mkdir(parents=True)
inputs=directory/'inputs';inputs.mkdir();output=directory/'reports';output.mkdir();cache=root/'.local/stack-security-cache';cache.mkdir(exist_ok=True);temporary=cache/'tmp';temporary.mkdir(exist_ok=True)
if os.name!='nt':
 for path in [output,cache,temporary]:path.chmod(0o777)
report={'completed':False,'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'images':{},'dockerSocketMounted':False,'rawSecretsPrinted':False,'ignoredUnfixedVulnerabilities':False,'reportsDirectory':str(output)}
names={'core-api':'STACK_CORE_IMAGE','ai-worker':'STACK_WORKER_IMAGE','console':'STACK_CONSOLE_IMAGE','opa':'STACK_OPA_IMAGE','identity':'STACK_IDENTITY_IMAGE','gateway':'STACK_GATEWAY_IMAGE','object-store':'STACK_OBJECT_IMAGE','database':'STACK_DATABASE_IMAGE'}
def run(args,**kwargs):return subprocess.run(args,cwd=root,capture_output=True,text=True,encoding='utf-8',errors='replace',check=True,**kwargs)
def scanner(args,network):
 return subprocess.run(['docker','run','--rm','--network',network,'--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--tmpfs','/tmp:size=1g,mode=1777','--memory','4g','--cpus','2','--pids-limit','128','-e','XDG_CACHE_HOME=/tmp/cache','-e','TMPDIR=/cache/tmp','--mount','type=bind,source='+str(inputs)+',target=/in,readonly','--mount','type=bind,source='+str(output)+',target=/out','--mount','type=bind,source='+str(cache)+',target=/cache','agenttrust-security:local']+args,cwd=root,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=600)
try:
 report['revision']=run(['git','rev-parse','HEAD']).stdout.strip()
 registry=any(name in os.environ for name in names.values());report['registryImageReferences']=registry
 if registry:assert all(re.fullmatch(r'ghcr\.io/[a-z0-9-]+/agenttrust-'+name+r'@sha256:[a-f0-9]{64}',os.environ.get(env,'')) for name,env in names.items())
 for name,env in names.items():
  reference=os.environ[env] if registry else 'agenttrust-'+name+':local';image=json.loads(run(['docker','image','inspect',reference]).stdout)[0];image_id=image['Id'];assert re.fullmatch('sha256:[a-f0-9]{64}',image_id)
  archive=inputs/(name+'.tar');run(['docker','image','save','-o',str(archive),image_id]);checksum=hashlib.file_digest(archive.open('rb'),'sha256').hexdigest()
  report['currentImage']=name;report['currentStage']='sbom'
  sbom=scanner(['syft','docker-archive:/in/'+name+'.tar','-o','cyclonedx-json=/out/'+name+'.cdx.json','--quiet'],'none');(output/(name+'.syft.log')).write_text(sbom.stderr,encoding='utf-8');assert sbom.returncode==0
  inventory=json.loads((output/(name+'.cdx.json')).read_text(encoding='utf-8'));assert inventory['bomFormat']=='CycloneDX' and len(inventory.get('components',[]))>0
  report['currentStage']='vulnerabilities'
  scan=scanner(['trivy','image','--input','/in/'+name+'.tar','--cache-dir','/cache','--scanners','vuln','--severity','HIGH,CRITICAL','--format','json','--output','/out/'+name+'.trivy.json','--exit-code','1','--timeout','8m','--no-progress','--quiet'],'bridge');(output/(name+'.trivy.log')).write_text(scan.stderr,encoding='utf-8');assert scan.returncode in [0,1] and (output/(name+'.trivy.json')).is_file()
  value=json.loads((output/(name+'.trivy.json')).read_text(encoding='utf-8'));assert value.get('SchemaVersion')==2;findings=[v for result in value.get('Results',[]) for v in result.get('Vulnerabilities') or []];assert all(row['Severity'] in ['HIGH','CRITICAL'] for row in findings)
  result={'reference':reference,'imageId':image_id,'archiveSha256':checksum,'components':len(inventory['components']),'highCriticalFindings':len(findings),'scannerExitCode':scan.returncode,'sbomSha256':hashlib.sha256((output/(name+'.cdx.json')).read_bytes()).hexdigest(),'vulnerabilityReportSha256':hashlib.sha256((output/(name+'.trivy.json')).read_bytes()).hexdigest()};report['images'][name]=result;print(json.dumps({'image':name,'components':result['components'],'highCriticalFindings':len(findings),'rawSecretsPrinted':False}),flush=True)
 report['completed']=len(report['images'])==8 and all(v['highCriticalFindings']==0 and v['scannerExitCode']==0 for v in report['images'].values())
except Exception as error:report['errorType']=type(error).__name__;report['failureLocations']=[{'file':pathlib.Path(t.filename).name,'line':t.lineno} for t in traceback.extract_tb(error.__traceback__)]
finally:
 report['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();path=directory/'summary.json';path.open('x',encoding='utf-8').write(json.dumps(report,indent=2)+'\n');print(json.dumps({'completed':report['completed'],'images':len(report['images']),'reportPath':str(path),'rawSecretsPrinted':False}))
if not report['completed']:raise SystemExit(1)
