"""Verify fresh nonroot pgvector initialization in uniquely owned disposable fixtures."""
import datetime,json,pathlib,secrets,subprocess,time,uuid,os,re
root=pathlib.Path(__file__).resolve().parent.parent;identifier=str(uuid.uuid4());name='agenttrust-stack-db-fixture-'+identifier
reference=os.environ.get('STACK_DATABASE_IMAGE','agenttrust-database:local');assert reference=='agenttrust-database:local' or re.fullmatch(r'ghcr\.io/[a-z0-9-]+/agenttrust-database@sha256:[a-f0-9]{64}',reference)
directory=root/'.local';directory.mkdir(exist_ok=True);settings=directory/('stack-db-fixture-'+identifier+'.env')
report={'completed':False,'fixtureId':identifier,'network':'none','runtimeUser':'70:70','existingVolumesChanged':False,'rawSecretsPrinted':False,'ownFixtureCleaned':False,'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()};container=False;volume=False
def run(args,check=True):return subprocess.run(args,cwd=root,capture_output=True,text=True,encoding='utf-8',errors='replace',check=check,timeout=30)
try:
 with settings.open('x',encoding='utf-8') as stream:stream.write('POSTGRES_DB=fixture_db\nPOSTGRES_USER=fixture_user\nPOSTGRES_PASSWORD='+secrets.token_hex(32)+'\n')
 settings.chmod(0o600)
 run(['docker','volume','create','--label','agenttrust.fixture='+identifier,'--label','com.docker.compose.project=agenttrust',name]);volume=True
 run(['docker','run','-d','--name',name,'--label','agenttrust.fixture='+identifier,'--label','com.docker.compose.project=agenttrust','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','256m','--pids-limit','128','--tmpfs','/tmp:size=32m,mode=1777','--tmpfs','/var/run/postgresql:size=16m,uid=70,gid=70,mode=3775','--mount','type=volume,source='+name+',target=/var/lib/postgresql/data','--env-file',str(settings),reference]);container=True
 deadline=time.monotonic()+120
 while True:
  logs=run(['docker','logs',name]).stdout
  ready=run(['docker','exec',name,'pg_isready','-U','fixture_user','-d','fixture_db'],False)
  if 'PostgreSQL init process complete; ready for start up.' in logs and ready.returncode==0:break
  assert time.monotonic()<deadline;time.sleep(1)
 state=json.loads(run(['docker','inspect',name]).stdout)[0];assert state['Config']['User']=='70:70' and state['HostConfig']['ReadonlyRootfs'] and state['HostConfig']['NetworkMode']=='none' and not state['HostConfig']['PortBindings']
 result=run(['docker','exec',name,'psql','-U','fixture_user','-d','fixture_db','-v','ON_ERROR_STOP=1','-Atc',"CREATE EXTENSION vector; SELECT extversion FROM pg_extension WHERE extname='vector'; SELECT '[1,0,0]'::vector <=> '[1,0,0]'::vector;"]);assert result.stdout.splitlines()==['CREATE EXTENSION','0.8.7','0'];report['freshInitializationAndVectorQueryVerified']=True;report['completed']=True
except Exception as error:report['errorType']=type(error).__name__
finally:
 cleaned=True
 try:
  if container:
   state=json.loads(run(['docker','inspect',name]).stdout)[0];assert state['Config']['Labels']['agenttrust.fixture']==identifier;run(['docker','rm','-f',name])
  if volume:
   state=json.loads(run(['docker','volume','inspect',name]).stdout)[0];assert state['Labels']['agenttrust.fixture']==identifier;run(['docker','volume','rm',name])
  if settings.exists():assert settings.resolve().is_relative_to(directory.resolve());settings.unlink()
 except Exception:cleaned=False
 report['ownFixtureCleaned']=cleaned;report['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();path=directory/('stack-database-init-smoke-'+identifier+'.json');path.open('x',encoding='utf-8').write(json.dumps(report,indent=2)+'\n');print(json.dumps({'completed':report['completed'],'ownFixtureCleaned':cleaned,'reportPath':str(path),'errorType':report.get('errorType'),'rawSecretsPrinted':False}))
if not report['completed'] or not report['ownFixtureCleaned']:raise SystemExit(1)
