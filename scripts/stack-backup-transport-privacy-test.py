"""Actual owned Docker canaries; no original keys, database bytes or source-service interruptions."""
import datetime,hashlib,json,os,pathlib,secrets,subprocess,uuid
from unittest.mock import patch
import stack_backup_tools as tools
from stack_backup_custody import windows_owner_only

ROOT=pathlib.Path(__file__).resolve().parent.parent

def protect(path):
    if os.name=='nt':
        owner=subprocess.check_output(['whoami'],text=True).strip()
        for args in [['icacls',str(path),'/reset'],['icacls',str(path),'/inheritance:r','/grant:r',owner+(':(OI)(CI)F' if path.is_dir() else ':F'),'SYSTEM'+(':(OI)(CI)F' if path.is_dir() else ':F')]]:
            subprocess.run(args,check=True,capture_output=True)
        windows_owner_only((path,))
    else:path.chmod(0o700 if path.is_dir() else 0o600)

def main():
    identifier=str(uuid.uuid4());directory=ROOT/'.local'/('backup-transport-log-fixture-'+identifier)
    output=ROOT/'.local'/('stack-backup-transport-privacy-'+identifier+'.json')
    report={'completed':False,'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'originalKeysOrBusinessDataUsed':False,'sourceServicesStoppedOrModified':False,'rawOriginalSecretsPrinted':False,'productionDeploymentPerformed':False}
    records=[];keyfile=directory/'key.bin';original_run=tools.run;forced=False;volume='agenttrust-stack-stream-canary-'+identifier;volume_created=False
    def intercept(arguments,input=None,timeout=60,check=True):
        args=list(arguments)
        if args[:2]==['docker','run']:
            assert args[args.index('--log-driver')+1]=='none'
            if forced:args[args.index('--log-driver')+1]='json-file'
            args.remove('--rm');name='agenttrust-stack-crypto-log-canary-'+identifier+'-'+str(len(records))
            args[2:2]=['--name',name,'--label','agenttrust.fixture='+identifier]
            records.append({'name':name,'forcedRegression':forced})
        return original_run(ROOT,args,input=input,timeout=timeout,check=check)
    try:
        assert not directory.exists() and not output.exists();directory.mkdir(mode=0o700);protect(directory)
        fd=os.open(keyfile,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        try:protect(keyfile)
        except Exception:os.close(fd);raise
        with os.fdopen(fd,'wb') as stream:stream.write(secrets.token_bytes(32));stream.flush();os.fsync(stream.fileno())
        canary=b'OWNED_PUBLIC_TRANSPORT_CANARY_NOT_CUSTOMER_DATA'
        with patch.object(tools,'run',lambda root,args,input=None,timeout=60,check=True:intercept(args,input,timeout,check)):
            encrypted=tools.crypt(ROOT,keyfile,'encrypt',canary)
            assert tools.crypt(ROOT,keyfile,'decrypt',encrypted)==canary
            original_run(ROOT,['docker','volume','create','--label','agenttrust.fixture='+identifier,volume]);volume_created=True
            intercept(['docker','run','--rm','--log-driver','none','-i','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','64m','--pids-limit','32','--mount','type=volume,source='+volume+',target=/data',tools.ALPINE,'sh','-c','cat > /data/public-canary.txt'],input=canary)
            physical=tools.volume_stream(ROOT,volume,['tar','-C','/data','-czf','-','.']);assert 0<len(physical)<1048576
            physical=tools.volume_stream(ROOT,volume,['tar','-C','/data','-cf','-','.'],memory='128m');assert 0<len(physical)<1048576
            forced=True
            assert tools.crypt(ROOT,keyfile,'decrypt',encrypted)==canary
        assert len(records)==6
        for record in records:
            state=json.loads(original_run(ROOT,['docker','inspect',record['name']]).stdout)[0]
            assert state['Config']['Labels'].get('agenttrust.fixture')==identifier
            driver=state['HostConfig']['LogConfig']['Type'];logs=original_run(ROOT,['docker','logs',record['name']],check=False)
            if record['forcedRegression']:
                assert driver=='json-file' and canary in logs.stdout
            else:
                assert driver=='none' and canary not in logs.stdout+logs.stderr
            record['actualLogDriver']=driver
        report.update(completed=True,sharedGenericAndDatabaseCryptoTransportDriverNone=True,sharedCoherentAndObjectVolumeTransportDriverNone=True,forcedJsonFileRegressionCapturedOnlySyntheticCanary=True,normalStreamsNotAvailableThroughDockerLogs=True,canaryTransportBytesVerified=True,cases=len(records),networkMode='none',hostPortsPublished=False,originalVolumesMounted=False)
    except Exception as error:report.update(completed=False,errorType=type(error).__name__,code='BACKUP_TRANSPORT_PRIVACY_UNVERIFIED')
    finally:
        cleaned=True
        for record in records:
            try:
                result=original_run(ROOT,['docker','inspect',record['name']],check=False)
                if result.returncode==0:
                    state=json.loads(result.stdout)[0];assert state['Config']['Labels'].get('agenttrust.fixture')==identifier
                    original_run(ROOT,['docker','rm','-f',record['name']])
            except Exception:cleaned=False
        if volume_created:
            try:
                state=json.loads(original_run(ROOT,['docker','volume','inspect',volume]).stdout)[0]
                assert state['Labels'].get('agenttrust.fixture')==identifier
                original_run(ROOT,['docker','volume','rm',volume])
            except Exception:cleaned=False
        try:
            assert directory.resolve().parent==(ROOT/'.local').resolve() and not directory.is_symlink()
            if keyfile.exists():assert not keyfile.is_symlink() and keyfile.resolve().parent==directory.resolve();keyfile.unlink()
            if directory.exists():assert not list(directory.iterdir());directory.rmdir()
        except Exception:cleaned=False
        report.update(ownedCanaryContainersVolumeAndTemporaryKeyRemoved=cleaned,finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
        report['completed']=report['completed'] and cleaned
        with output.open('x',encoding='utf-8') as stream:stream.write(json.dumps(report,indent=2)+'\n')
        print(json.dumps({'completed':report['completed'],'cases':report.get('cases',0),'reportPath':str(output)}))
    return 0 if report['completed'] else 1

if __name__=='__main__':raise SystemExit(main())
