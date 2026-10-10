"""Scan committed history and tracked source only; never mount local secrets."""
import datetime,json,os,pathlib,subprocess,tarfile,uuid,traceback
root=pathlib.Path(__file__).resolve().parent.parent
directory=root/'.local'/('stack-security-source-'+str(uuid.uuid4()));directory.mkdir()
source=directory/'source';source.mkdir();output=directory/'reports';output.mkdir()
if os.name!='nt':output.chmod(0o777)
report={'completed':False,'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'privateRuntimeFilesScanned':False,'rawSecretsPrinted':False,'outputDirectory':str(output)}
def run(args,**kwargs):return subprocess.run(args,cwd=root,capture_output=True,text=True,encoding='utf-8',errors='replace',check=True,**kwargs)
def scanner(mounts,args,network='none',extra=()):
 command=['docker','run','--rm','--network',network,'--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--tmpfs','/tmp:size=256m,mode=1777','--memory','1g','--cpus','2','--pids-limit','256']
 for host,target,writable in mounts:command+=['--mount','type=bind,source='+str(host)+',target='+target+('' if writable else ',readonly')]
 return subprocess.run(command+list(extra)+['agenttrust-security:local']+args,cwd=root,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=240)
try:
 revision=run(['git','rev-parse','HEAD']).stdout.strip();report['revision']=revision
 archive=directory/'tracked.tar';run(['git','archive','--format=tar','-o',str(archive),revision])
 with tarfile.open(archive) as content:
  assert all(not row.issym() and not row.islnk() and not row.name.startswith('/') and '..' not in pathlib.PurePosixPath(row.name).parts for row in content.getmembers());content.extractall(source,filter='data')
 history=directory/'history';run(['git','clone','--bare','--no-hardlinks',str(root),str(history)])
 mounts=[(root/'tools/security','/rules',False),(output,'/out',True)]
 fixtures=scanner(mounts,['semgrep','scan','--config','/rules/semgrep.yaml','--metrics','off','--disable-version-check','--json','--quiet','--jobs','2','/rules/fixtures']);assert fixtures.returncode==0
 findings=json.loads(fixtures.stdout);expected={'python-no-shell-subprocess','python-no-dynamic-evaluation','javascript-no-dynamic-evaluation','python-no-disabled-tls-verification','java-no-unrestricted-client-redirects','java-no-global-csrf-disable'}
 assert not findings['errors'] and {row['check_id'].split('.')[-1] for row in findings['results']}==expected and len(findings['results'])==7 and all('safe.' not in pathlib.PurePosixPath(row['path']).name.lower().replace('unsafe.','unsafe_') for row in findings['results']);report['semgrepRulesFixtureVerified']=True
 scan=scanner(mounts+[(source,'/source',False)],['semgrep','scan','--config','/rules/semgrep.yaml','--metrics','off','--disable-version-check','--json','--quiet','--error','--jobs','2','--timeout','5','/source/apps','/source/services','/source/scripts','/source/tools/promptfoo']);(output/'semgrep.json').write_text(scan.stdout,encoding='utf-8');value=json.loads(scan.stdout);report['semgrepFindings']=len(value['results']);report['semgrepErrors']=len(value['errors']);assert scan.returncode==0 and not value['results'] and not value['errors']
 leak=scanner(mounts+[(history,'/history',False)],['gitleaks','git','/history','--log-opts=--all','--gitleaks-ignore-path','/rules/gitleaks.ignore','--redact=100','--no-banner','--log-level','error','--report-format','json','--report-path','/out/gitleaks.json'],extra=['-e','GIT_CONFIG_COUNT=1','-e','GIT_CONFIG_KEY_0=safe.directory','-e','GIT_CONFIG_VALUE_0=/history']);rows=json.loads((output/'gitleaks.json').read_text(encoding='utf-8'));report['gitleaksFindings']=len(rows);assert leak.returncode==0 and not rows
 control=output/'synthetic-secret-control.txt'
 import secrets
 control.open('x',encoding='utf-8').write('api_key="'+secrets.token_hex(32)+'"\n')
 positive=scanner(mounts,['gitleaks','dir','/out','--gitleaks-ignore-path','/rules/gitleaks.ignore','--redact=100','--no-banner','--log-level','error','--report-format','json','--report-path','/tmp/control.json']);assert positive.returncode==1
 report['gitleaksSyntheticPositiveControlDetected']=True
 control.unlink()
 report['completed']=True
except Exception as error:report['errorType']=type(error).__name__;report['failureLocations']=[{'file':pathlib.Path(t.filename).name,'line':t.lineno} for t in traceback.extract_tb(error.__traceback__)]
finally:
 report['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();path=directory/'summary.json';path.open('x',encoding='utf-8').write(json.dumps(report,indent=2)+'\n');print(json.dumps({'completed':report['completed'],'semgrepRulesFixtureVerified':report.get('semgrepRulesFixtureVerified'),'semgrepFindings':report.get('semgrepFindings'),'gitleaksFindings':report.get('gitleaksFindings'),'reportPath':str(path),'rawSecretsPrinted':False}))
if not report['completed']:raise SystemExit(1)
