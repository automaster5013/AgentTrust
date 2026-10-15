"""Read-only acceptance of the separate migration and restricted API processes."""
import datetime,json,pathlib,subprocess,uuid

ROOT=pathlib.Path(__file__).resolve().parent.parent
report={'completed':False,'sourceBusinessWritesPerformed':False,'sourceServicesRestarted':False,
        'rawSecretsPrinted':False,'productionDeploymentPerformed':False,'checks':[]}

def run(args,timeout=30):
    result=subprocess.run(args,cwd=ROOT,capture_output=True,timeout=timeout)
    if result.returncode:raise RuntimeError('DATABASE_PROCESS_CHECK_COMMAND_FAILED')
    return result.stdout

def inspect(name,service):
    value=json.loads(run(['docker','inspect',name]))[0]
    if value['Config']['Labels'].get('com.docker.compose.project')!='agenttrust' or value['Config']['Labels'].get('com.docker.compose.service')!=service:
        raise ValueError('Database process scope refused')
    return value

try:
    core=inspect('agenttrust-stack-core-api-1','stack-core-api')
    migration=inspect('agenttrust-stack-migrate-1','stack-migrate')
    assert core['State']['Running'] and core['State']['Health']['Status']=='healthy'
    assert migration['State']['Status']=='exited' and migration['State']['ExitCode']==0 and not migration['State']['OOMKilled']
    assert migration['Image']==core['Image'] and migration['Config']['Cmd']==['--migrate-only']
    assert migration['HostConfig']['ReadonlyRootfs'] and not migration['HostConfig']['PortBindings'] and migration['HostConfig']['CapDrop']==['ALL']
    assert 'no-new-privileges:true' in migration['HostConfig']['SecurityOpt'] and migration['Config']['User']=='10001:10001'
    environment=dict(value.split('=',1) for value in core['Config']['Env'])
    privileged=dict(value.split('=',1) for value in migration['Config']['Env'])
    assert environment['STACK_DATABASE_USER']=='agenttrust_stack_api' and 'STACK_DATABASE_PASSWORD' in environment
    assert not any(name.startswith('STACK_MIGRATION_') for name in environment)
    assert privileged['STACK_MIGRATION_USER']!='agenttrust_stack_api' and len(privileged['STACK_MIGRATION_PASSWORD'])>=32
    assert 'STACK_DATABASE_PASSWORD' not in privileged and 'STACK_DATABASE_USER' not in privileged
    assert privileged['REDGATE_DISABLE_TELEMETRY']=='true'
    report['checks'].append('same immutable image exits successfully in migration-only mode without published ports; owner and API credential fields are separate')
    raw=run(['docker','exec','agenttrust-stack-core-api-1','cat','/proc/1/environ'])
    assert len(raw)<=262144 and privileged['STACK_MIGRATION_PASSWORD'].encode() not in raw
    names={item.partition(b'=')[0] for item in raw.split(b'\0')}
    assert not any(name.startswith(b'STACK_MIGRATION_') for name in names)
    assert b'STACK_DATABASE_PASSWORD' in names and environment['STACK_DATABASE_PASSWORD']!=privileged['STACK_MIGRATION_PASSWORD']
    report['checks'].append('actual API PID1 environment contains restricted database credentials and no owner credential or migration variables; values remain unrecorded')
    report.update(completed=True,sourceImageId=core['Image'],migrationContainerId=migration['Id'],
                  apiContainerId=core['Id'],actualPid1EnvironmentInspected=True,
                  migrationOnlyExitedSuccessfully=True,apiMigrationCredentialAbsent=True)
except Exception as error:
    report.update(errorType=type(error).__name__,code='DATABASE_PROCESS_ISOLATION_UNVERIFIED')
finally:
    report['checkedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()
    path=ROOT/'.local'/('stack-database-process-'+str(uuid.uuid4())+'.json')
    with path.open('x',encoding='utf-8') as stream:stream.write(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'completed':report['completed'],'checks':len(report['checks']),'reportPath':str(path)}))
if not report['completed']:raise SystemExit(1)
