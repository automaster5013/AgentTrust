"""Create Syft SBOMs and Trivy reports for exact exported image IDs, without a Docker socket."""
import datetime,hashlib,json,os,pathlib,re,shutil,subprocess,uuid,traceback
root=pathlib.Path(__file__).resolve().parent.parent
directory=root/'.local'/('stack-security-images-'+str(uuid.uuid4()));directory.mkdir(parents=True)
inputs=directory/'inputs';inputs.mkdir();output=directory/'reports';output.mkdir();cache=root/'.local/stack-security-cache';cache.mkdir(exist_ok=True);temporary=cache/'tmp';temporary.mkdir(exist_ok=True)
if os.name!='nt':
 for path in [output,cache,temporary]:path.chmod(0o777)
report={'completed':False,'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'images':{},'dockerSocketMounted':False,'rawSecretsPrinted':False,'ignoredUnfixedVulnerabilities':False,'reportsDirectory':str(output)}
names={'core-api':'STACK_CORE_IMAGE','ai-worker':'STACK_WORKER_IMAGE','console':'STACK_CONSOLE_IMAGE','opa':'STACK_OPA_IMAGE','identity':'STACK_IDENTITY_IMAGE','gateway':'STACK_GATEWAY_IMAGE','object-store':'STACK_OBJECT_IMAGE','database':'STACK_DATABASE_IMAGE','local-model':'STACK_MODEL_IMAGE','messaging':'STACK_MESSAGING_IMAGE','telemetry':'STACK_TELEMETRY_IMAGE','tempo':'STACK_TEMPO_IMAGE','loki':'STACK_LOKI_IMAGE','prometheus':'STACK_PROMETHEUS_IMAGE', 'quality-verifier':'STACK_QUALITY_VERIFIER_IMAGE'}
def run(args,**kwargs):return subprocess.run(args,cwd=root,capture_output=True,text=True,encoding='utf-8',errors='replace',check=True,**kwargs)
def scanner(args,network):
 return subprocess.run(['docker','run','--rm','--network',network,'--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--tmpfs','/tmp:size=1g,mode=1777','--memory','4g','--cpus','2','--pids-limit','128','-e','XDG_CACHE_HOME=/tmp/cache','-e','TMPDIR=/cache/tmp','--mount','type=bind,source='+str(inputs)+',target=/in,readonly','--mount','type=bind,source='+str(output)+',target=/out','--mount','type=bind,source='+str(cache)+',target=/cache','agenttrust-security:local']+args,cwd=root,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=600)
try:
 report['revision']=run(['git','rev-parse','HEAD']).stdout.strip()
 registry=any(name in os.environ for name in names.values());report['registryImageReferences']=registry
 if registry:assert all(re.fullmatch(r'ghcr\.io/[a-z0-9-]+/agenttrust-'+name+r'@sha256:[a-f0-9]{64}',os.environ.get(env,'')) for name,env in names.items())
 report['currentStage']='image-and-disk-preflight';identities={};archive_estimate=0
 for name,env in names.items():
  reference=os.environ[env] if registry else 'agenttrust-'+name+':local';image=json.loads(run(['docker','image','inspect',reference]).stdout)[0]
  if not re.fullmatch('sha256:[a-f0-9]{64}',image['Id']) or type(image.get('Size')) is not int or not 0<image['Size']<=2*1073741824:raise ValueError('Image outside bounded export contract')
  identities[name]=(reference,image['Id'],image['Size']+67108864);archive_estimate+=image['Size']+67108864
 reserve=(22 if os.name=='nt' else 4)*1073741824
 required=reserve+archive_estimate;available=shutil.disk_usage(root).free
 report.update(archiveEstimateBytes=archive_estimate,requiredFreeBytes=required,availableFreeBytes=available,imagesInspected=len(identities),exportPreflightPassed=available>=required)
 if available<required:raise ValueError('Insufficient disk headroom before image export')
 remaining=archive_estimate
 for name in names:
  reference,image_id,estimate=identities[name]
  report['currentImage']=name;report['currentStage']='bounded-image-export'
  if shutil.disk_usage(root).free<reserve+remaining:raise ValueError('Disk headroom changed during image export')
  archive=inputs/(name+'.tar');run(['docker','image','save','-o',str(archive),image_id]);archive.chmod(0o644);report['exportedArchiveMode']=oct(archive.stat().st_mode & 0o777);checksum=hashlib.file_digest(archive.open('rb'),'sha256').hexdigest()
  if not 0<archive.stat().st_size<=estimate:raise ValueError('Image archive exceeds bounded estimate')
  remaining-=estimate
  report['currentImage']=name;report['currentStage']='sbom'
  sbom=scanner(['syft','docker-archive:/in/'+name+'.tar','-o','cyclonedx-json=/out/'+name+'.cdx.json','--quiet'],'none');(output/(name+'.syft.log')).write_text(sbom.stderr,encoding='utf-8');report['currentTool']='syft';report['currentToolExitCode']=sbom.returncode;assert sbom.returncode==0
  inventory=json.loads((output/(name+'.cdx.json')).read_text(encoding='utf-8'));assert inventory['bomFormat']=='CycloneDX' and len(inventory.get('components',[]))>0
  report['currentStage']='vulnerabilities'
  scan=scanner(['trivy','image','--input','/in/'+name+'.tar','--cache-dir','/cache','--scanners','vuln','--severity','HIGH,CRITICAL','--format','json','--output','/out/'+name+'.trivy.json','--exit-code','1','--timeout','8m','--no-progress','--quiet'],'bridge');(output/(name+'.trivy.log')).write_text(scan.stderr,encoding='utf-8');assert scan.returncode in [0,1] and (output/(name+'.trivy.json')).is_file()
  value=json.loads((output/(name+'.trivy.json')).read_text(encoding='utf-8'));assert value.get('SchemaVersion')==2;findings=[v for result in value.get('Results',[]) for v in result.get('Vulnerabilities') or []];assert all(row['Severity'] in ['HIGH','CRITICAL'] for row in findings)
  result={'reference':reference,'imageId':image_id,'archiveSha256':checksum,'components':len(inventory['components']),'highCriticalFindings':len(findings),'scannerExitCode':scan.returncode,'sbomSha256':hashlib.sha256((output/(name+'.cdx.json')).read_bytes()).hexdigest(),'vulnerabilityReportSha256':hashlib.sha256((output/(name+'.trivy.json')).read_bytes()).hexdigest()};report['images'][name]=result;print(json.dumps({'image':name,'components':result['components'],'highCriticalFindings':len(findings),'rawSecretsPrinted':False}),flush=True)
 report['completed']=set(report['images'])==set(names) and all(v['highCriticalFindings']==0 and v['scannerExitCode']==0 for v in report['images'].values())
except Exception as error:report['errorType']=type(error).__name__;report['failureLocations']=[{'file':pathlib.Path(t.filename).name,'line':t.lineno} for t in traceback.extract_tb(error.__traceback__)]
finally:
 report['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();path=directory/'summary.json';path.open('x',encoding='utf-8').write(json.dumps(report,indent=2)+'\n');print(json.dumps({'completed':report['completed'],'images':len(report['images']),'reportPath':str(path),'rawSecretsPrinted':False}))
if not report['completed']:raise SystemExit(1)
