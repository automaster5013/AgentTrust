"""Private-byte helpers for bounded development restore drills."""
import hashlib,io,json,os,pathlib,subprocess,tarfile

ALPINE='alpine:3.24@sha256:294b683cb724975bec92580e1e685676bd4b50bda910ddb8c51d4cabeaec77e6'
TAR_LIMIT=32*1024*1024

def run(root,arguments,input=None,timeout=60,check=True):
    result=subprocess.run(arguments,cwd=root,input=input,capture_output=True,timeout=timeout)
    if check and result.returncode:raise RuntimeError('RESTORE_DRILL_COMMAND_FAILED')
    return result

def crypt(root,keyfile,operation,data):
    if operation not in ['encrypt','decrypt'] or not isinstance(data,bytes) or not 0<len(data)<=64*1024*1024:
        raise ValueError('Invalid bounded cryptography request')
    if keyfile.is_symlink() or keyfile.resolve().parent.parent!=(root/'.local').resolve() or keyfile.stat().st_size!=32:
        raise ValueError('Unexpected private fixture key')
    tools=json.loads(run(root,['docker','image','inspect','agenttrust-security:local']).stdout)[0]['Id']
    command=['docker','run','--rm','-i','--network','none','--read-only','--cap-drop','ALL',
             '--security-opt','no-new-privileges:true','--tmpfs','/tmp:size=16m,mode=1777',
             '--memory','384m','--cpus','2','--pids-limit','32',
             '--mount','type=bind,source='+str(root/'scripts/stack-backup-crypt.py')+',target=/crypt.py,readonly',
             '--mount','type=bind,source='+str(keyfile)+',target=/key.bin,readonly']
    if os.name!='nt':
        if os.getuid()==0:raise ValueError('Nonroot host required')
        command+=['--user',str(os.getuid())+':'+str(os.getgid())]
    return run(root,command+[tools,'python','/crypt.py',operation,'--key-file','/key.bin'],input=data).stdout

def minio_tar_fingerprints(raw):
    if not 0<len(raw)<=TAR_LIMIT:raise ValueError('Archive exceeds drill bound')
    result={};seen=set();total=0
    with tarfile.open(fileobj=io.BytesIO(raw),mode='r:') as archive:
        for entry in archive:
            path=pathlib.PurePosixPath(entry.name)
            if len(seen)>=10000 or len(entry.name)>1024 or path.is_absolute() or '..' in path.parts or '\\' in entry.name or '\x00' in entry.name:
                raise ValueError('Unexpected restore member path')
            if str(path)!='.' and (not path.parts or path.parts[0]!='minio-data'):raise ValueError('Unexpected volume prefix')
            if str(path) in seen or entry.type not in [tarfile.REGTYPE,tarfile.AREGTYPE,tarfile.DIRTYPE] or entry.mode&0o6000 or (entry.isfile() and entry.mode&0o1000) or (str(path)=='.' and not entry.isdir()):
                raise ValueError('Unexpected restore member type or duplicate')
            seen.add(str(path))
            if entry.isfile():
                total+=entry.size
                if entry.size<0 or entry.size>16*1024*1024 or total>16*1024*1024:raise ValueError('Restore members exceed drill bound')
                stream=archive.extractfile(entry)
                value=stream.read(entry.size+1)
                if len(value)!=entry.size:raise ValueError('Truncated restore member')
                result[str(path)]={'bytes':entry.size,'sha256':hashlib.sha256(value).hexdigest()}
    if not result:raise ValueError('Empty object-store snapshot')
    return result
