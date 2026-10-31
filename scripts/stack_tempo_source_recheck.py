"""Bounded read-only archive inspection of the known empty Tempo blocks.

Uses the existing container's copy API only; no exec, helper, fixture or write.
This is not a full source-volume/path/backup/fresh-reader verification.
"""
import hashlib,io,json,pathlib,subprocess,tarfile,threading
from stack_tempo_repair_policy import affected_groups
LIMIT=65536

def need(value):
 if not value:raise ValueError('Read-only Tempo source recheck refused')

def copy_archive(prefix):
 from stack_tempo_repair_policy import prefix as validate_prefix
 validate_prefix(prefix)
 proc=subprocess.Popen(['docker','cp','agenttrust-stack-tempo-1:/var/tempo/'+prefix,'-'],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
 values=[]
 def read():
  try:values.append(proc.stdout.read(LIMIT+1))
  except Exception:values.append(None)
 reader=threading.Thread(target=read,daemon=True);reader.start()
 try:
  proc.wait(timeout=20);reader.join(timeout=2)
  need(not reader.is_alive() and proc.returncode==0 and len(values)==1 and values[0] is not None and 0<len(values[0])<=LIMIT)
  return values[0]
 finally:
  if proc.poll() is None:proc.kill();proc.wait(timeout=5)
  proc.stdout.close();reader.join(timeout=2)

def archive_rows(raw,prefix):
 need(type(raw) is bytes and 0<len(raw)<=LIMIT);root=pathlib.PurePosixPath(prefix).name;rows={};seen=set()
 with tarfile.open(fileobj=io.BytesIO(raw),mode='r:') as archive:
  for member in archive:
   path=pathlib.PurePosixPath(member.name);need(str(path)==member.name.rstrip('/') and not path.is_absolute() and path.parts and path.parts[0]==root and '..' not in path.parts and member.name not in seen);seen.add(member.name);need(len(seen)<=5)
   if member.isdir():need(len(path.parts)==1);continue
   need(member.isreg() and len(path.parts)==2 and member.size==0 and member.mode<=0o777)
   name=prefix+'/'+path.name;need(name not in rows);rows[name]={'bytes':0,'sha256':hashlib.sha256(b'').hexdigest(),'mode':member.mode}
 need(len(rows)==4);return rows

def recheck(source,files,read=copy_archive):
 need(source['Name']=='/agenttrust-stack-tempo-1' and source['Config']['Labels']['com.docker.compose.project']=='agenttrust' and source['Config']['Labels']['com.docker.compose.service']=='stack-tempo')
 need(source['State']['Running'] is True and source['State'].get('Health',{}).get('Status')=='healthy')
 mounts=[v for v in source['Mounts'] if v['Destination']=='/var/tempo'];need(len(mounts)==1 and mounts[0]['Type']=='volume' and mounts[0]['Name']=='agenttrust_stack-tempo-data')
 groups=affected_groups(files);observations=[]
 for _ in range(2):
  current={}
  for prefix,expected in groups.items():
   rows=archive_rows(read(prefix),prefix);need(rows==expected);current.update(rows)
  observations.append(current)
 need(observations[0]==observations[1]==files)
 return {'knownAffectedFilesRechecked':True,'affectedBlocks':2,'affectedFiles':8,'affectedBytes':0,'twoPassManifestEquality':True,'crossFileSnapshotAtomic':False,'maxSourcePreflightAgeSeconds':300,
  'knownAffectedManifestSha256':hashlib.sha256(json.dumps(files,sort_keys=True).encode()).hexdigest(),
  'newContainerStarted':False,'sourceWritesPerformed':False,'fullSourceManifestRechecked':False,'pathAndDestinationRechecked':False,
  'freshReaderExecuted':False,'operatingTempoRecoveryVerified':False,'automaticDeploymentAllowed':False}
