"""Prove migration/API process boundaries on a fresh portless PostgreSQL fixture.

Never restarts source services or mounts original volumes. Generated fixture
credentials remain private and are removed only after owned resources clean up.
"""
import argparse,datetime,json,os,pathlib,re,secrets,subprocess,time,uuid
from stack_pending_workspace_probe import verify as verify_pending_scopes
from stack_backup_custody import windows_owner_only
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--candidate-image');args=parser.parse_args()
root=pathlib.Path(__file__).resolve().parent.parent;identifier=str(uuid.uuid4());prefix='agenttrust-stack-migration-fixture-'+identifier;directory=root/'.local'/('stack-database-process-fixture-'+identifier);directory.mkdir();report_path=directory/'summary.json';assert not report_path.exists()
containers=[];network=False;files=[];report={'completed':False,'fixtureId':identifier,'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sourceServicesModified':False,'originalVolumesMounted':False,'hostPortsPublished':False,'rawSecretsPrinted':False,'phase':'fixture-preflight','checks':[]}
def run(args,data=None,timeout=60):return subprocess.run(args,cwd=root,input=data,capture_output=True,timeout=timeout)
def ok(args,data=None,timeout=60):
 result=run(args,data,timeout);assert result.returncode==0;return result.stdout
def envfile(name,values):
 path=directory/name;path.touch(exist_ok=False);files.append(path)
 if os.name=='nt':
  ok(['icacls',str(path),'/reset']);ok(['icacls',str(path),'/inheritance:r','/grant:r',owner+':F','SYSTEM:F']);windows_owner_only((directory,path))
 else:path.chmod(0o600)
 path.write_bytes(('\n'.join(k+'='+v for k,v in values.items())+'\n').encode())
 return path
def own(name):
 value=json.loads(ok(['docker','inspect',name]))[0];assert value['Config']['Labels'].get('agenttrust.fixture')==identifier;return value
def sql(text):return ok(['docker','exec','-i',prefix+'-db','psql','-U','agenttrust_stack','-d','agenttrust_stack','-At','-v','ON_ERROR_STOP=1'],text.encode())
try:
 if os.name=='nt':
  owner=ok(['whoami']).decode().strip();ok(['icacls',str(directory),'/reset']);ok(['icacls',str(directory),'/inheritance:r','/grant:r',owner+':(OI)(CI)F','SYSTEM:(OI)(CI)F']);windows_owner_only((directory,))
 else:directory.chmod(0o700)
 core=json.loads(ok(['docker','inspect','agenttrust-stack-core-api-1']))[0];assert core['Config']['Labels'].get('com.docker.compose.project')=='agenttrust' and core['Config']['Labels'].get('com.docker.compose.service')=='stack-core-api' and core['State']['Health']['Status']=='healthy';image=args.candidate_image or core['Image'];assert re.fullmatch('sha256:[a-f0-9]{64}',image);assert ok(['docker','image','inspect','--format','{{.Id}}',image]).decode().strip()==image;report['candidateImageId']=image;report['revision']=ok(['git','rev-parse','HEAD']).decode().strip();report['candidateOverrideUsed']=args.candidate_image is not None;report['sourceClean']=not ok(['git','status','--porcelain']).strip()
 database=json.loads(ok(['docker','inspect','agenttrust-stack-db-1']))[0];assert database['Config']['Labels']['com.docker.compose.service']=='stack-db';dbimage=database['Image']
 owner_password,api_password=secrets.token_hex(24),secrets.token_hex(24)
 db=envfile('database.env',{'POSTGRES_DB':'agenttrust_stack','POSTGRES_USER':'agenttrust_stack','POSTGRES_PASSWORD':owner_password})
 url='jdbc:postgresql://stack-db:5432/agenttrust_stack?connectTimeout=2&socketTimeout=5&tcpKeepAlive=true'
 migration=envfile('migration.env',{'STACK_DATABASE_URL':url,'STACK_MIGRATION_USER':'agenttrust_stack','STACK_MIGRATION_PASSWORD':owner_password,'REDGATE_DISABLE_TELEMETRY':'true'})
 api_values={'STACK_DATABASE_URL':url,'STACK_DATABASE_USER':'agenttrust_stack_api','STACK_DATABASE_PASSWORD':api_password};api=envfile('api.env',api_values)
 bad=envfile('bad-api.env',dict(api_values,STACK_MIGRATION_PASSWORD=owner_password))
 report['phase']='create-private-network'
 ok(['docker','network','create','--internal','--label','agenttrust.fixture='+identifier,prefix]);network=True
 name=prefix+'-db';containers.append(name)
 ok(['docker','run','-d','--name',name,'--label','agenttrust.fixture='+identifier,'--network',prefix,'--network-alias','stack-db','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','512m','--cpus','1','--pids-limit','128','--tmpfs','/tmp:size=32m,mode=1777','--tmpfs','/var/run/postgresql:size=16m,uid=70,gid=70,mode=3775','--tmpfs','/var/lib/postgresql/data:size=192m,uid=70,gid=70,mode=0700','--env-file',str(db),dbimage])
 report['phase']='wait-for-postgres-tcp';until=time.monotonic()+90
 # The entrypoint's temporary initialization server accepts Unix sockets before
 # the final server accepts TCP. JDBC requires the latter, even on a fresh DB.
 while run(['docker','exec',name,'pg_isready','-h','127.0.0.1','-U','agenttrust_stack','-d','agenttrust_stack']).returncode:
  assert time.monotonic()<until;time.sleep(1)
 report['databaseReadinessTransport']='tcp-loopback';report['phase']='create-restricted-role'
 sql("CREATE ROLE agenttrust_stack_api LOGIN PASSWORD '"+api_password+"'; GRANT CONNECT ON DATABASE agenttrust_stack TO agenttrust_stack_api;")
 def process(kind,environment,args,expected):
  report['phase']=kind
  name=prefix+'-'+kind;containers.append(name)
  result=run(['docker','run','--name',name,'--label','agenttrust.fixture='+identifier,'--network',prefix,'--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','512m','--cpus','1','--pids-limit','64','--tmpfs','/tmp:size=64m,mode=1777','--env-file',str(environment),image,*args],timeout=180)
  report['lastProcessExitCode']=result.returncode
  assert result.returncode==expected and owner_password.encode() not in result.stdout+result.stderr and api_password.encode() not in result.stdout+result.stderr
  state=own(name);assert state['State']['Status']=='exited' and not state['State']['OOMKilled'] and not state['HostConfig']['PortBindings']
  if expected==0:
   frame=json.loads(result.stdout);assert frame['completed'] and frame['apiServerStarted'] is False;return frame
  assert b'DATABASE_PROCESS_BOUNDARY_REFUSED' in result.stderr
 first=process('initial-migrate',migration,['--migrate-only'],0);expected=len(list((root/'services/core-api/src/main/resources/db/migration').glob('V*.sql')));assert first['migrationsExecuted']==expected
 assert sql('SELECT count(*) FROM flyway_schema_history WHERE success;').decode().strip()==str(expected)
 report['checks'].append('fresh isolated database migrates all '+str(expected)+' unchanged migration resources using separate owner process; no API server starts')
 assert process('repeat-migrate',migration,['--migrate-only'],0)['migrationsExecuted']==0
 report['checks'].append('repeated migration validates existing checksums without reapplying schema')
 assert process('restricted-api',api,['--check-database-role'],0)['restrictedApiRoleVerified']
 process('secret-refused',bad,['--check-database-role'],1)
 process('mixed-mode-refused',migration,['--migrate-only','--server.port=8080'],1)
 report['checks'].append('restricted API role passes; owner credential contamination and mixed migration/API flags fail before serving')
 sql('ALTER ROLE agenttrust_stack_api SUPERUSER;')
 process('superuser-refused',api,['--check-database-role'],1)
 sql('ALTER ROLE agenttrust_stack_api NOSUPERUSER; GRANT agenttrust_stack TO agenttrust_stack_api;')
 process('owner-membership-refused',api,['--check-database-role'],1)
 sql('REVOKE agenttrust_stack FROM agenttrust_stack_api;')
 assert process('restricted-again',api,['--check-database-role'],0)['restrictedApiRoleVerified']
 report['checks'].append('actual database superuser flag and inherited owner-role membership are refused; restoring restricted grants recovers readiness')
 report['boundedPendingWorkspaceDiscovery']=verify_pending_scopes(sql)
 report['checks'].append('ten admitted namespaces page8+2 across unsigned UUID boundary; completed work excluded, direct RLS preserved, PUBLIC access and API alteration refused')
 report.update(completed=True,phase='completed',migrationResourcesVerified=expected,sourceDatabaseImageId=dbimage,isolatedPostgresStateInTmpfs=True)
except Exception as error:report.update(errorType=type(error).__name__,code='MIGRATION_BOUNDARY_FIXTURE_UNVERIFIED')
finally:
 cleaned=True
 for name in reversed(containers):
  try:
   state=run(['docker','inspect',name])
   if state.returncode==0:own(name);ok(['docker','rm','-f',name])
  except Exception:cleaned=False
 if network:
  try:
   state=json.loads(ok(['docker','network','inspect',prefix]))[0];assert state['Labels'].get('agenttrust.fixture')==identifier;ok(['docker','network','rm',prefix])
  except Exception:cleaned=False
 if cleaned:
  for path in files:
   try:assert directory.resolve().parent==(root/'.local').resolve() and not path.is_symlink() and path.resolve().parent==directory.resolve();path.chmod(0o600);path.unlink()
   except Exception:cleaned=False
 report['ownedContainersNetworkAndPrivateFixtureFilesCleaned']=cleaned
 if not cleaned:report['completed']=False
 report['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();report_path.open('x',encoding='utf-8').write(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
if not report['completed']:raise SystemExit(1)
