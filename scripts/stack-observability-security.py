"""Scan one pinned observation image without credentials or a Docker socket in scanners."""
import argparse,datetime,hashlib,json,os,pathlib,re,shutil,subprocess,uuid

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--name',choices=['telemetry','tempo','loki','prometheus','grafana'],required=True)
parser.add_argument('--reference',required=True)
args=parser.parse_args()
if not re.fullmatch(r'agenttrust-'+args.name+r':local|ghcr\.io/automaster5013/agenttrust-'+args.name+r'@sha256:[a-f0-9]{64}',args.reference):
    raise SystemExit('Unrecognized observation image reference')
root=pathlib.Path(__file__).resolve().parent.parent
minimum_free_gib=20 if os.name=='nt' else 4
if shutil.disk_usage(root).free<minimum_free_gib*1073741824:raise SystemExit('Insufficient disk headroom')
directory=root/'.local'/('stack-observation-security-'+str(uuid.uuid4()));directory.mkdir(parents=True)
inputs=directory/'inputs';inputs.mkdir();output=directory/'reports';output.mkdir()
cache=root/'.local/stack-observation-security-cache';cache.mkdir(exist_ok=True);temporary=cache/'tmp';temporary.mkdir(exist_ok=True)
if os.name!='nt':
    for path in [output,cache,temporary]:path.chmod(0o777)
report={'completed':False,'name':args.name,'reference':args.reference,'dockerSocketMounted':False,
        'ignoredUnfixedVulnerabilities':False,'registryCredentialsMounted':False,
        'actualDeploymentPerformed':False,'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
def run(command):
    return subprocess.run(command,cwd=root,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=600)
def scanner(command,network):
    return run(['docker','run','--rm','--network',network,'--read-only','--cap-drop','ALL',
                '--security-opt','no-new-privileges:true','--tmpfs','/tmp:size=256m,mode=1777',
                '--memory','2g','--cpus','2','--pids-limit','128','-e','XDG_CACHE_HOME=/tmp/cache','-e','TMPDIR=/cache/tmp',
                '--mount','type=bind,source='+str(inputs)+',target=/in,readonly',
                '--mount','type=bind,source='+str(output)+',target=/out',
                '--mount','type=bind,source='+str(cache)+',target=/cache',
                'agenttrust-security:local']+command)
stage='image-identity'
try:
    identity=run(['docker','image','inspect',args.reference])
    if identity.returncode:raise ValueError('Image unavailable')
    image=json.loads(identity.stdout)[0];image_id=image['Id']
    if not re.fullmatch('sha256:[a-f0-9]{64}',image_id):raise ValueError('Invalid image identity')
    report['imageId']=image_id
    image_bytes=image.get('Size')
    archive_limit=3*1073741824 if args.name=='grafana' else 1073741824
    if type(image_bytes) is not int or not 0<image_bytes<=archive_limit:raise ValueError('Image size outside bounded scan contract')
    report.update(imageBytes=image_bytes,archiveLimitBytes=archive_limit)
    required_free=max(4*1073741824,2*image_bytes+268435456) if os.name!='nt' else 20*1073741824+image_bytes
    if shutil.disk_usage(root).free<required_free:raise ValueError('Insufficient export headroom')
    stage='archive';archive=inputs/(args.name+'.tar')
    saved=run(['docker','image','save','-o',str(archive),image_id])
    report['archiveBytes']=archive.stat().st_size if archive.exists() else 0
    if saved.returncode or not 0<report['archiveBytes']<=archive_limit:raise ValueError('Image export unavailable or too large')
    archive.chmod(0o644)
    with archive.open('rb') as stream:report['archiveSha256']=hashlib.file_digest(stream,'sha256').hexdigest()
    stage='sbom';sbom=scanner(['syft','docker-archive:/in/'+args.name+'.tar','-o','cyclonedx-json=/out/'+args.name+'.cdx.json','--quiet'],'none')
    (output/'syft.log').write_text(sbom.stderr,encoding='utf-8')
    if sbom.returncode:raise ValueError('SBOM generation failed')
    inventory=json.loads((output/(args.name+'.cdx.json')).read_text(encoding='utf-8'))
    if inventory['bomFormat']!='CycloneDX' or not inventory['components']:raise ValueError('Empty SBOM')
    stage='vulnerabilities'
    scan=scanner(['trivy','image','--input','/in/'+args.name+'.tar','--cache-dir','/cache','--scanners','vuln',
                  '--severity','HIGH,CRITICAL','--format','json','--output','/out/'+args.name+'.trivy.json',
                  '--exit-code','1','--timeout','8m','--no-progress','--quiet'],'bridge')
    (output/'trivy.log').write_text(scan.stderr,encoding='utf-8')
    if scan.returncode not in [0,1]:raise ValueError('Vulnerability scan failed')
    value=json.loads((output/(args.name+'.trivy.json')).read_text(encoding='utf-8'))
    if value['SchemaVersion']!=2 or not isinstance(value['Results'],list):raise ValueError('Invalid scan report')
    findings=[row for result in value['Results'] for row in result.get('Vulnerabilities') or []]
    if any(row['Severity'] not in ['HIGH','CRITICAL'] for row in findings):raise ValueError('Invalid severity filter')
    report.update(components=len(inventory['components']),highCriticalFindings=len(findings),scannerExitCode=scan.returncode,
                  sbomSha256=hashlib.sha256((output/(args.name+'.cdx.json')).read_bytes()).hexdigest(),
                  vulnerabilityReportSha256=hashlib.sha256((output/(args.name+'.trivy.json')).read_bytes()).hexdigest(),
                  completed=not findings and scan.returncode==0)
except Exception as error:report.update(failedStage=stage,errorType=type(error).__name__)
finally:
    report['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()
    (directory/'summary.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({**report,'reportPath':str(directory/'summary.json')}))
raise SystemExit(0 if report['completed'] else 1)
