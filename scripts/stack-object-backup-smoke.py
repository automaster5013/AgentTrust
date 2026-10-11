"""Restore an encrypted MinIO development volume only into an owned isolated fixture."""
import datetime,hashlib,json,os,pathlib,secrets,shutil,time,uuid
from stack_compose import stack_compose
from stack_test_client import StackClient
from stack_backup_tools import ALPINE,TAR_LIMIT,crypt,minio_tar_fingerprints,run

root=pathlib.Path(__file__).resolve().parent.parent;identifier=str(uuid.uuid4())
name='agenttrust-stack-object-restore-'+identifier;directory=root/'.local'/('stack-object-backup-'+identifier)
directory.mkdir(parents=True)
if os.name!='nt':directory.chmod(0o700)
keyfile=directory/'development-key.bin'
report={'completed':False,'checks':[],'fixtureId':identifier,'fixtureNetworkInternal':True,
        'legacyServicesChanged':False,'existingVolumeRestoredOver':False,'operationalBackupVerified':False,
        'fullSystemRecoveryVerified':False,'rawSecretsPrinted':False,'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
client=None;source_stopped=False;volume=False;network=False;container=False;stage='source-identity'

def command(arguments,input=None,timeout=60,check=True):return run(root,arguments,input,timeout,check)
def inspect(target):return json.loads(command(['docker','inspect',target]).stdout)[0]
def secrets_mounts(names):
    result=[]
    for secret in names:
        path=root/'.local/stack'/secret.removeprefix('stack-')
        if path.is_symlink() or not path.is_file():raise ValueError('Private fixture configuration unavailable')
        result+=['--mount','type=bind,source='+str(path)+',target=/run/secrets/'+secret+',readonly']
    return result

def volume_command(target,args,input=None,write=False,root_chown=False):
    base=['docker','run','--rm','-i','--network','none','--read-only','--cap-drop','ALL',
          '--security-opt','no-new-privileges:true','--memory','128m','--cpus','2','--pids-limit','32',
          '--user','0:0' if root_chown else '10001:10001',
          '--mount','type=volume,source='+target+',target=/data'+('' if write else ',readonly')]
    if root_chown:base+=['--cap-add','CHOWN']
    return command(base+[ALPINE]+args,input=input).stdout

def archive(target):
    size=volume_command(target,['du','-sk','/data']).decode().split()[0]
    if not size.isdigit() or int(size)>16*1024:raise ValueError('Object volume exceeds drill bound')
    raw=volume_command(target,['tar','-C','/data','-cf','-','.'])
    if len(raw)>TAR_LIMIT:raise ValueError('Object archive exceeds drill bound')
    return raw

def restore_source():
    command(stack_compose(root)+['up','-d','--no-build','--wait','--wait-timeout','90','stack-object-store'],timeout=120)

def read_evidence(run_id):
    until=time.monotonic()+30
    while True:
        try:return client.request('runs/'+run_id+'/evidence')
        except AssertionError:
            status=report.get('unexpectedHttpStatus')
            if status not in [409,503] or time.monotonic()>until:raise
            counts=report.setdefault('evidenceReadRetryStatusCounts',{})
            counts[str(status)]=counts.get(str(status),0)+1
            for key in ['unexpectedHttpStatus','expectedHttpStatus','responseCode']:report.pop(key,None)
            time.sleep(.5)

try:
    if shutil.disk_usage(root).free<(20 if os.name=='nt' else 4)*1073741824:raise ValueError('Insufficient disk headroom')
    source=inspect('agenttrust-stack-object-store-1')
    if source['Config']['Labels'].get('com.docker.compose.project')!='agenttrust' or source['Config']['Labels'].get('com.docker.compose.service')!='stack-object-store' or source['State']['Health']['Status']!='healthy':raise ValueError('Unexpected source object store')
    mounts=[row for row in source['Mounts'] if row['Destination']=='/tmp' and row['Type']=='volume']
    if len(mounts)!=1 or mounts[0]['Name']!='agenttrust_stack-object-data':raise ValueError('Unexpected source volume')
    source_volume=mounts[0]['Name'];labels=json.loads(command(['docker','volume','inspect',source_volume]).stdout)[0]['Labels']
    if labels.get('com.docker.compose.project')!='agenttrust' or labels.get('com.docker.compose.volume')!='stack-object-data':raise ValueError('Unexpected volume ownership')
    stage='synthetic-versioned-evidence'
    client=StackClient('http://127.0.0.1:4320',json.loads((root/'.local/stack/demo-credentials.json').read_text(encoding='utf-8')),report)
    own=client.login('demo-admin')
    record=client.request('runs','POST',{'scenario':'pass','requiresApproval':True},{'Idempotency-Key':str(uuid.uuid4())})
    until=time.monotonic()+30
    while record['state']=='queued' and time.monotonic()<until:time.sleep(.4);record=client.request('runs/'+record['id'])
    if record['state']!='succeeded' or record['decision']!='pass' or client.request('runs/'+record['id']+'/gate')['deploymentAllowed']:raise ValueError('Synthetic admission unverified')
    evidence=read_evidence(record['id'])
    if evidence.get('integrityVerified') is not True or not evidence.get('storageVersion'):raise ValueError('Synthetic archive unavailable')
    probe={'key':'organizations/'+own['organizationId']+'/projects/'+own['projectId']+'/runs/'+record['id']+'/'+evidence['contentSha256']+'.json',
           'version':evidence['storageVersion'],'hash':evidence['contentSha256'],'bytes':evidence['contentBytes']}
    stage='stopped-source-snapshot';source_stopped=True
    command(['docker','stop','--time','15','agenttrust-stack-object-store-1'])
    snapshot=archive(source_volume);before=minio_tar_fingerprints(snapshot)
    restore_source();source_stopped=False
    report['checks'].append('snapshot reads only the stopped owned MinIO volume and source service is restored before fixture work')
    stage='encrypted-snapshot'
    with keyfile.open('xb') as stream:stream.write(secrets.token_bytes(32))
    keyfile.chmod(0o600);encrypted=crypt(root,keyfile,'encrypt',snapshot);backup=directory/'object-volume.aesgcm'
    with backup.open('xb') as stream:stream.write(encrypted)
    backup.chmod(0o600);plain=crypt(root,keyfile,'decrypt',backup.read_bytes())
    if hashlib.sha256(plain).digest()!=hashlib.sha256(snapshot).digest():raise ValueError('Encrypted snapshot mismatch')
    report['encryptedArchiveSha256']=hashlib.sha256(encrypted).hexdigest()
    report['checks'].append('authenticated encrypted archive restores exact bytes without plaintext host files')
    stage='isolated-fixture-volume'
    command(['docker','volume','create','--label','agenttrust.fixture='+identifier,'--label','com.docker.compose.project=agenttrust',name]);volume=True
    volume_command(name,['chown','10001:10001','/data'],write=True,root_chown=True)
    volume_command(name,['tar','-C','/data','-xof','-'],input=plain,write=True)
    if minio_tar_fingerprints(archive(name))!=before:raise ValueError('Restored volume file bytes mismatch')
    report['restoredFiles']=len(before);report['checks'].append('every restored physical file fingerprint matches before fixture startup')
    command(['docker','network','create','--internal','--label','agenttrust.fixture='+identifier,'--label','com.docker.compose.project=agenttrust',name]);network=True
    root_secrets=['stack-minio-root-user','stack-minio-root-password']
    command(['docker','run','-d','--name',name,'--label','agenttrust.fixture='+identifier,'--label','com.docker.compose.project=agenttrust',
             '--network',name,'--network-alias','stack-object-store','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true',
             '--memory','512m','--cpus','2','--pids-limit','128','--mount','type=volume,source='+name+',target=/tmp']+
             secrets_mounts(root_secrets)+[source['Image']]);container=True
    until=time.monotonic()+90
    while True:
        state=inspect(name)
        if state['State'].get('Health',{}).get('Status')=='healthy':break
        if time.monotonic()>until:raise TimeoutError('Restored MinIO health unverified')
        time.sleep(.5)
    net=json.loads(command(['docker','network','inspect',name]).stdout)[0]
    if net['Internal'] is not True or len(net['Containers'])!=1 or state['HostConfig']['PortBindings'] or state['Config']['User']!='10001:10001':raise ValueError('Fixture isolation unverified')
    stage='restored-version-retention-and-iam'
    verified=command(['docker','run','--rm','-i','--network',name,'--read-only','--cap-drop','ALL',
                      '--security-opt','no-new-privileges:true','--memory','128m','--cpus','2','--pids-limit','32',
                      '--tmpfs','/tmp:size=16m,mode=1777','--entrypoint','/usr/local/bin/minio-init']+
                     secrets_mounts(root_secrets+['stack-minio-user','stack-minio-password'])+[source['Image'],'--verify'],input=json.dumps(probe).encode())
    proof=json.loads(verified.stdout)
    if not all(proof.get(key) is True for key in ['completed','applicationDeleteAndObjectListRefused','rootCannotDeleteLockedVersion','specificVersionStillMatchesAfterNewerShadow']):raise ValueError('Restored object boundaries unverified')
    if proof.get('retentionMode')!='COMPLIANCE' or proof.get('retentionDays')!=7:raise ValueError('Restored retention unverified')
    report['checks'].append('restored IAM, exact pinned object version and bytes, COMPLIANCE retention and root/application deletion refusal survive restore')
    stage='source-readback'
    again=read_evidence(record['id'])
    if again.get('integrityVerified') is not True or any(again[key]!=evidence[key] for key in ['contentSha256','contentBytes','storageVersion']):raise ValueError('Source pinned evidence changed')
    if client.request('runs/'+record['id']+'/gate')['deploymentAllowed']:raise ValueError('Restore drill must not grant deployment')
    report['checks'].append('source pinned evidence remains verified and approval-required gate remains held')
    report['completed']=True
except Exception as error:report.update(failedStage=stage,errorType=type(error).__name__)
finally:
    restored=True;cleaned=True;closed=True
    if source_stopped:
        try:restore_source()
        except Exception:restored=False
    if client:
        try:client.logout()
        except Exception:closed=False
    try:
        if container:
            if inspect(name)['Config']['Labels'].get('agenttrust.fixture')!=identifier:raise ValueError('Fixture ownership mismatch')
            command(['docker','rm','-f',name])
        if network:
            value=json.loads(command(['docker','network','inspect',name]).stdout)[0]
            if value['Labels'].get('agenttrust.fixture')!=identifier or value['Containers']:raise ValueError('Network ownership mismatch')
            command(['docker','network','rm',name])
        if volume:
            value=json.loads(command(['docker','volume','inspect',name]).stdout)[0]
            if value['Labels'].get('agenttrust.fixture')!=identifier:raise ValueError('Volume ownership mismatch')
            command(['docker','volume','rm',name])
        if keyfile.exists():
            if keyfile.is_symlink() or keyfile.resolve().parent!=directory.resolve():raise ValueError('Fixture key path mismatch')
            keyfile.unlink()
    except Exception:cleaned=False
    report.update(sourceServiceRestored=restored,ownFixtureAndTemporaryKeyCleaned=cleaned,ownSessionLoggedOut=closed,
                  finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
    path=directory/'summary.json';path.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print(json.dumps({**report,'reportPath':str(path)}))
if not report['completed'] or not report['sourceServiceRestored'] or not report['ownFixtureAndTemporaryKeyCleaned'] or not report['ownSessionLoggedOut']:raise SystemExit(1)
