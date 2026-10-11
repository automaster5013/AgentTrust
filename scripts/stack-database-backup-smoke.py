"""Restore an encrypted development snapshot into an owned, networkless PostgreSQL fixture."""
import datetime,hashlib,json,os,pathlib,re,secrets,shutil,subprocess,time,uuid
from stack_compose import stack_compose

root=pathlib.Path(__file__).resolve().parent.parent
identifier=str(uuid.uuid4());name='agenttrust-stack-restore-fixture-'+identifier
directory=root/'.local'/('stack-database-backup-'+identifier);directory.mkdir(parents=True)
if os.name!='nt':directory.chmod(0o700)
keyfile=directory/'development-key.bin';settings=directory/'fixture.env'
report={'completed':False,'checks':[],'fixtureId':identifier,'fixtureNetwork':'none',
        'legacyServicesChanged':False,'existingDataRestoredOver':False,'operationalBackupVerified':False,
        'fullSystemRecoveryVerified':False,'keyManagement':'temporary-local-development-key',
        'rawSecretsPrinted':False,'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
stopped=[];container=False;volume=False;stage='source-identity'

def run(arguments,input=None,timeout=60,check=True):
    result=subprocess.run(arguments,cwd=root,input=input,capture_output=True,timeout=timeout)
    if check and result.returncode:raise RuntimeError('RESTORE_DRILL_COMMAND_FAILED')
    return result

def inspect(target):return json.loads(run(['docker','inspect',target]).stdout)[0]

def sql(target,statement):
    return run(['docker','exec','-i',target,'psql','-U','agenttrust_stack','-d','agenttrust_stack',
                '-v','ON_ERROR_STOP=1','-At'],input=statement.encode()).stdout.decode('utf-8').strip()

def fingerprints(target):
    tables=sql(target,"SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;").splitlines()
    if not tables or len(tables)>64 or any(not re.fullmatch('[a-z][a-z0-9_]{0,62}',table) for table in tables):
        raise ValueError('Unexpected database table set')
    result={}
    total=0
    for table in tables:
        measured=sql(target,'SELECT count(*)::text||\'|\'||coalesce(sum(pg_column_size(t)),0)::text FROM "'+table+'" t;')
        rows,size=map(int,measured.split('|'));total+=size
        if rows>100000 or size>16*1024*1024 or total>64*1024*1024:raise ValueError('Snapshot table exceeds drill bounds')
        # Row bytes remain inside PostgreSQL. Only counts and SHA-256 values leave it.
        value=sql(target,'SELECT count(*)::text||\'|\'||encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E\'\\n\' ORDER BY to_jsonb(t)::text),\'\'),\'UTF8\')),\'hex\') FROM "'+table+'" t;')
        count,digest=value.split('|')
        if not count.isdigit() or int(count)!=rows or not re.fullmatch('[a-f0-9]{64}',digest):raise ValueError('Unexpected snapshot fingerprint')
        result[table]={'rows':int(count),'sha256':digest}
    return result

def crypt(operation,data):
    tools=json.loads(run(['docker','image','inspect','agenttrust-security:local']).stdout)[0]['Id']
    command=['docker','run','--rm','-i','--network','none','--read-only','--cap-drop','ALL',
             '--security-opt','no-new-privileges:true','--tmpfs','/tmp:size=16m,mode=1777',
             '--memory','384m','--cpus','2','--pids-limit','32',
             '--mount','type=bind,source='+str(root/'scripts/stack-backup-crypt.py')+',target=/crypt.py,readonly',
             '--mount','type=bind,source='+str(keyfile)+',target=/key.bin,readonly']
    if os.name!='nt':
        if os.getuid()==0:raise ValueError('Nonroot host required')
        command+=['--user',str(os.getuid())+':'+str(os.getgid())]
    return run(command+[tools,'python','/crypt.py',operation,'--key-file','/key.bin'],input=data).stdout

try:
    if shutil.disk_usage(root).free<(20 if os.name=='nt' else 4)*1073741824:raise ValueError('Insufficient disk headroom')
    # Jobs do not share local Docker images. Refuse before stopping writers if the
    # pinned cryptography tool has not been built in this job.
    stage='cryptography-tool-preflight'
    run(['docker','image','inspect','agenttrust-security:local'])
    stage='source-identity'
    source=inspect('agenttrust-stack-db-1')
    if source['Config']['Labels'].get('com.docker.compose.project')!='agenttrust' or source['Config']['Labels'].get('com.docker.compose.service')!='stack-db' or source['State']['Health']['Status']!='healthy':raise ValueError('Unexpected source database')
    image=source['Image']
    if not re.fullmatch('sha256:[a-f0-9]{64}',image):raise ValueError('Unexpected source image')
    for service in ['stack-core-api','stack-ai-worker']:
        value=inspect('agenttrust-'+service+'-1')
        if value['Config']['Labels'].get('com.docker.compose.project')!='agenttrust' or value['Config']['Labels'].get('com.docker.compose.service')!=service or not value['State']['Running']:raise ValueError('Unexpected writer service')
    # Admissions are immutable and stay queued; completion is a separate append-only row.
    active="SELECT count(*) FROM stack_runs r LEFT JOIN stack_run_results c ON c.run_id=r.id WHERE r.state='queued' AND c.run_id IS NULL;"
    if sql('agenttrust-stack-db-1',active)!='0':raise ValueError('Pending completions prevent snapshot drill')
    stage='quiesce-new-stack-writers'
    for service in ['stack-ai-worker','stack-core-api']:
        stopped.append(service);run(['docker','stop','--time','15','agenttrust-'+service+'-1'])
    before=fingerprints('agenttrust-stack-db-1')
    if sql('agenttrust-stack-db-1',active)!='0':raise ValueError('Admission raced snapshot quiescence')
    report['immutableQueuedAdmissionsPreserved']=int(sql('agenttrust-stack-db-1',"SELECT count(*) FROM stack_runs WHERE state='queued';"))
    report['pendingCompletionsAtSnapshot']=0
    stage='encrypted-snapshot'
    dump=run(['docker','exec','agenttrust-stack-db-1','pg_dump','-U','agenttrust_stack','-d','agenttrust_stack','-Fc','--no-password'],timeout=120).stdout
    if not dump.startswith(b'PGDMP') or not 0<len(dump)<32*1024*1024:raise ValueError('Unexpected bounded snapshot')
    with keyfile.open('xb') as stream:stream.write(secrets.token_bytes(32))
    keyfile.chmod(0o600)
    encrypted=crypt('encrypt',dump);backup=directory/'database.aesgcm'
    with backup.open('xb') as stream:stream.write(encrypted)
    backup.chmod(0o600)
    restored_bytes=crypt('decrypt',backup.read_bytes())
    if hashlib.sha256(restored_bytes).digest()!=hashlib.sha256(dump).digest():raise ValueError('Snapshot bytes mismatch')
    report['encryptedArchiveSha256']=hashlib.sha256(encrypted).hexdigest()
    report['checks'].append('bounded pg_dump bytes survive authenticated encryption without plaintext disk output')
    stage='isolated-fixture'
    with settings.open('x',encoding='utf-8') as stream:stream.write('POSTGRES_DB=agenttrust_stack\nPOSTGRES_USER=agenttrust_stack\nPOSTGRES_PASSWORD='+secrets.token_hex(32)+'\n')
    settings.chmod(0o600)
    run(['docker','volume','create','--label','agenttrust.fixture='+identifier,'--label','com.docker.compose.project=agenttrust',name]);volume=True
    run(['docker','run','-d','--name',name,'--label','agenttrust.fixture='+identifier,'--label','com.docker.compose.project=agenttrust',
         '--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','384m','--cpus','2','--pids-limit','128',
         '--tmpfs','/tmp:size=32m,mode=1777','--tmpfs','/var/run/postgresql:size=16m,uid=70,gid=70,mode=3775',
         '--mount','type=volume,source='+name+',target=/var/lib/postgresql/data','--env-file',str(settings),image]);container=True
    until=time.monotonic()+90
    while True:
        logs=run(['docker','logs',name]).stdout
        ready=run(['docker','exec',name,'pg_isready','-U','agenttrust_stack','-d','agenttrust_stack'],check=False)
        if b'PostgreSQL init process complete; ready for start up.' in logs and ready.returncode==0:break
        if time.monotonic()>until:raise TimeoutError('Fixture initialization unverified')
        time.sleep(.5)
    state=inspect(name)
    if state['Config']['User']!='70:70' or state['HostConfig']['NetworkMode']!='none' or state['HostConfig']['PortBindings'] or not state['HostConfig']['ReadonlyRootfs']:raise ValueError('Unexpected fixture isolation')
    # Restore grants to a restricted NOLOGIN fixture role; original passwords are not copied.
    sql(name,'CREATE ROLE agenttrust_stack_api NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;')
    stage='restore'
    run(['docker','exec','-i',name,'pg_restore','-U','agenttrust_stack','-d','agenttrust_stack','--exit-on-error'],input=restored_bytes,timeout=120)
    after=fingerprints(name)
    if before!=after:raise ValueError('Restored table bytes mismatch')
    report['restoredTables']=len(after);report['restoredRows']=sum(v['rows'] for v in after.values())
    report['checks'].append('every public table row fingerprint matches in a fresh nonroot networkless PostgreSQL fixture')
    stage='restored-boundaries'
    if sql(name,"SELECT extversion FROM pg_extension WHERE extname='vector';")!='0.8.7' or sql(name,"SELECT '[1,0,0]'::vector <=> '[1,0,0]'::vector;")!='0':raise ValueError('Restored vector extension unverified')
    policies="SELECT json_agg(v ORDER BY tablename,policyname)::text FROM (SELECT tablename,policyname,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public') v;"
    if sql(name,policies)!=sql('agenttrust-stack-db-1',policies):raise ValueError('Restored scope policies mismatch')
    if sql(name,"SET ROLE agenttrust_stack_api; SELECT count(*) FROM stack_runs;").splitlines()[-1]!='0':raise ValueError('Unscoped restored role can read tenant rows')
    credentials=json.loads((root/'.local/stack/demo-credentials.json').read_text(encoding='utf-8'))
    own=next(v for v in credentials if v['username']=='demo-admin');foreign=next(v for v in credentials if v['username']=='other-admin')
    for row in [own,foreign]:
        for field in ['organizationId','projectId']:
            if str(uuid.UUID(row[field]))!=row[field]:raise ValueError('Unexpected fixture scope')
    sql(name,"BEGIN; SET LOCAL ROLE agenttrust_stack_api; DO $$ BEGIN "
        "PERFORM set_config('agenttrust.organization_id','"+own['organizationId']+"',true); "
        "PERFORM set_config('agenttrust.project_id','"+own['projectId']+"',true); "
        "IF NOT EXISTS(SELECT 1 FROM stack_runs) THEN RAISE EXCEPTION 'Own rows unavailable'; END IF; "
        "IF EXISTS(SELECT 1 FROM stack_runs WHERE organization_id='"+foreign['organizationId']+"') "
        "THEN RAISE EXCEPTION 'Foreign scope visible'; END IF; END $$; ROLLBACK;")
    permissions="SELECT has_table_privilege('agenttrust_stack_api','stack_runs','DELETE') OR has_table_privilege('agenttrust_stack_api','stack_run_results','UPDATE');"
    if sql(name,permissions)!='f':raise ValueError('Restored append-only grants mismatch')
    report['checks'].append('restored pgvector query, exact RLS policies, scoped own read, foreign/unscoped invisibility and append-only grants remain enforced')
    if fingerprints('agenttrust-stack-db-1')!=before:raise ValueError('Source changed during drill')
    report['checks'].append('source snapshot remains unchanged; restore never targets an existing database or volume')
    report['completed']=True
except Exception as error:report.update(failedStage=stage,errorType=type(error).__name__)
finally:
    restored=True;cleaned=True
    try:
        if stopped:run(stack_compose(root)+['up','-d','--no-build','--wait','--wait-timeout','180']+stopped,timeout=210)
    except Exception:restored=False
    try:
        if container:
            if inspect(name)['Config']['Labels'].get('agenttrust.fixture')!=identifier:raise ValueError('Fixture ownership mismatch')
            run(['docker','rm','-f',name])
        if volume:
            value=json.loads(run(['docker','volume','inspect',name]).stdout)[0]
            if value['Labels'].get('agenttrust.fixture')!=identifier:raise ValueError('Volume ownership mismatch')
            run(['docker','volume','rm',name])
        for path in [keyfile,settings]:
            if path.exists():
                if path.is_symlink() or path.resolve().parent!=directory.resolve():raise ValueError('Fixture path mismatch')
                path.unlink()
    except Exception:cleaned=False
    report.update(sourceServicesRestored=restored,ownFixtureAndTemporaryKeyCleaned=cleaned,
                  finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
    path=directory/'summary.json';path.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({**report,'reportPath':str(path)}))
if not report['completed'] or not report['sourceServicesRestored'] or not report['ownFixtureAndTemporaryKeyCleaned']:raise SystemExit(1)
