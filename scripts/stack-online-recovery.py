"""Online logical DB evidence and isolated business-stack restore; never quiesce sources.
Independent per-database snapshots are NOT a coherent cross-store operating backup.
--include-live-state copies persistent object/queue/quota files read-only with drift
checks. JVM login session continuity and monitoring/model history remain excluded.
"""
import argparse,base64,datetime,hashlib,importlib.util,json,os,pathlib,secrets,sys,time,traceback,uuid
from stack_image_identity import cached_identity
from stack_host_capacity import require_host_capacity
ROOT=pathlib.Path(__file__).resolve().parent.parent

def load(name,file):
 spec=importlib.util.spec_from_file_location(name,ROOT/'scripts'/file);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
d=load('online_deployment','stack-local-cd-deploy.py');e=d.e;c=load('online_coherent_utilities','stack-coherent-recovery.py')
DATABASES=('agenttrust_stack','agenttrust_stack_identity')

def dump_command(database):
 e.require(database in DATABASES)
 return ['docker','exec','agenttrust-stack-db-1','pg_dump','-U','agenttrust_stack','-d',database,'-Fc','--create','--no-password','--lock-wait-timeout=5s']

def protect(directory):
 directory.mkdir(mode=0o700)
 if os.name=='nt':
  owner=c.run(['whoami']).stdout.decode().strip()
  c.run(['icacls',str(directory),'/inheritance:r','/grant:r',owner+':(OI)(CI)F','SYSTEM:(OI)(CI)F'])
  # Python's Windows mkdir(mode=0700) can add explicit Administrators/OWNER RIGHTS.
  c.run(['icacls',str(directory),'/remove:g','*S-1-5-32-544','*S-1-3-4'])
  from stack_backup_custody import windows_owner_only
  windows_owner_only((directory,))

def component(raw):return {'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}

def verify_retained(directory,key_path,expected,identifier):
 custody=c.retained_key(ROOT,key_path);directory=directory.resolve();key_path=custody[0]
 e.require(directory.parent==(ROOT/'.local').resolve() and key_path.parent.parent==(ROOT/'.local').resolve() and key_path.parent!=directory)
 e.require(str(uuid.UUID(identifier))==identifier and key_path.is_file() and key_path.stat().st_size==32)
 raw=e.anchored_file(directory/'online-manifest.aesgcm',expected)
 crypto=load('retained_online_envelope','stack-backup-crypt.py');key=key_path.read_bytes();manifest=json.loads(crypto.transform('decrypt',key,raw))
 e.require(manifest['schemaVersion']==1 and manifest['kind']=='online-independent-logical' and manifest['snapshotId']==identifier)
 e.require(manifest['crossDatabaseSnapshotAtomic'] is False and manifest['crossStoreSnapshotAtomic'] is False)
 created=datetime.datetime.fromisoformat(manifest['createdAt']);e.require(created.tzinfo is not None and 0<=(datetime.datetime.now(datetime.timezone.utc)-created).total_seconds()<=86400)
 names={'roles','configuration','businessFingerprints',*DATABASES}
 if manifest.get('liveStateIncluded') is True:names|={'stack-object-store-live','stack-nats-live','stack-redis-live','liveStateMetadata'}
 e.require(set(manifest['components'])==names)
 decoded={}
 for name in names:
  path=directory/(name+'.aesgcm');limit=64*1024*1024 if name.endswith('-live') else 34*1024*1024
  e.require(not path.is_symlink() and path.is_file() and 0<path.stat().st_size<=limit)
  ciphertext=path.read_bytes();e.require(component(ciphertext)==manifest['components'][name]);decoded[name]=crypto.transform('decrypt',key,ciphertext)
 e.require(all(decoded[name].startswith(b'PGDMP') for name in DATABASES) and 0<len(decoded['roles'])<1048576)
 configuration=json.loads(decoded['configuration']);e.require(set(configuration)==set(c.SERVICES)==set(manifest['sourceImageIds']))
 e.require(all(configuration[s]['imageId']==manifest['sourceImageIds'][s] and e.re.fullmatch('sha256:[a-f0-9]{64}',configuration[s]['imageId']) for s in c.SERVICES))
 fingerprints=json.loads(decoded['businessFingerprints']);e.require(isinstance(fingerprints,dict) and 0<len(fingerprints)<=64)
 for row in fingerprints.values():e.require(type(row['rows']) is int and row['rows']>=0 and e.re.fullmatch('[a-f0-9]{64}',row['sha256']))
 if manifest.get('liveStateIncluded') is True:
  import stack_live_state as live
  metadata=json.loads(decoded['liveStateMetadata']);e.require(metadata['schemaVersion']==1 and metadata['crossStoreSnapshotAtomic'] is False)
  e.require(set(metadata['fileFingerprints'])==set(live.VOLUMES) and isinstance(metadata['queue'],list) and 0<len(metadata['queue'])<=16)
  e.require(isinstance(metadata['objectReferences'],list) and 0<len(metadata['objectReferences'])<=4096)
  for service in live.VOLUMES:e.require(c.archive_fingerprints(decoded[service+'-live'])==metadata['fileFingerprints'][service])
 e.require(c.key_unchanged(*custody))
 return {'completed':True,'kind':'authenticated-online-logical-archive','databaseArchives':2,'configurationServices':11,
         'onlineLogicalArchiveAuthenticated':True,'liveStateArchivesAuthenticated':3 if manifest.get('liveStateIncluded') is True else 0,
         'fullStackRecoveryVerified':False,'coherentOperatingBackupVerified':False}

def fixture_command(drill,service,entry,env,state_volumes=None):
 e.require(service in c.SERVICES and entry['user'] not in ('','0','root','0:0'))
 name=drill.prefix+'-'+service
 args=['docker','run','-d','--name',name,'--label','agenttrust.fixture='+drill.id,'--network',drill.prefix,'--network-alias',service,
       '--log-driver','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--user',entry['user'],
       '--env-file',str(env),'--memory',str(entry['memory']),'--cpus',str(entry['cpus']/1000000000),'--pids-limit',str(entry['pids'])]
 for destination,options in entry['tmpfs'].items():args+=['--tmpfs',destination+':'+options]
 if service in (state_volumes or {}):
  volume=state_volumes[service];e.require(volume==drill.prefix+'-'+service+'-live');drill.own_volume(volume)
  args+=['--mount','type=volume,source='+volume+',target='+entry['volumeDestination']]
 elif service in c.STATEFUL:
  args+=['--tmpfs',entry['volumeDestination']+':size=512m,uid='+entry['user'].split(':')[0]+',mode=0700']
 if service=='stack-db':args+=['-e','POSTGRES_USER=agenttrust_restore_fixture','-e','POSTGRES_DB=postgres']
 if service=='stack-ai-worker':args+=['-e','STACK_ENABLE_PAID_PROVIDERS=false','-e','STACK_TELEMETRY_ENABLED=false']
 if service=='stack-core-api':args+=['-e','OTEL_SDK_DISABLED=true']
 if entry['workingDirectory']:args+=['--workdir',entry['workingDirectory']]
 for index,file in enumerate(entry['files']):
  path=drill.directory/(service+'-secret-'+str(index));c.private_file(path,base64.b64decode(file['content'],validate=True));path.chmod(0o444)
  drill.private.append(path);file['fixturePath']=str(path)
  args+=['--mount','type=bind,source='+str(path)+',target='+file['destination']+',readonly']
 endpoint=entry['entrypoint'] or []
 return args+['--entrypoint',endpoint[0] if endpoint else '',entry['imageId']]+endpoint[1:]+(entry['command'] or [])

def target_sql(name,statement):
 e.require(e.re.fullmatch('agenttrust-stack-coldrestore-[a-f0-9-]{36}-stack-db',name))
 return c.run(['docker','exec','-i',name,'psql','-X','-q','-U','agenttrust_restore_fixture','-d','postgres','-v','ON_ERROR_STOP=1','-At'],data=statement.encode()).stdout

def restore(drill,config,payload,checkpoint,services=None):
 selected=c.SERVICES if services is None else tuple(services)
 e.require(len(selected)==len(set(selected))>0 and set(selected)<=set(c.SERVICES))
 state_volumes={}
 if 'liveStateMetadata' in payload:
  import stack_live_state as live
  state_volumes=live.prepare_volumes(drill,payload);metadata=json.loads(payload['liveStateMetadata'])
 c.run(['docker','network','create','--internal','--label','agenttrust.fixture='+drill.id,drill.prefix]);drill.network=True
 for service in selected:
  checkpoint()
  entry=config[service];env=drill.directory/(service+'.env');c.private_file(env,('\n'.join(entry['env'])+'\n').encode());drill.private.append(env)
  args=fixture_command(drill,service,entry,env,state_volumes);name=drill.prefix+'-'+service;drill.containers.append(name)
  c.run(args)
  if service=='stack-db':
   until=time.monotonic()+90
   while time.monotonic()<until:
    logs=c.run(['docker','exec',name,'pg_isready','-U','agenttrust_restore_fixture','-d','postgres'],check=False)
    # Initialization's temporary server runs before TCP is ready.
    tcp=c.run(['docker','exec',name,'pg_isready','-h','127.0.0.1','-U','agenttrust_restore_fixture','-d','postgres'],check=False)
    if logs.returncode==tcp.returncode==0:break
    time.sleep(.5)
   else:raise TimeoutError('Owned database initialization unavailable')
   target_sql(name,payload['roles'].decode())
   for database in DATABASES:
    c.run(['docker','exec','-i',name,'pg_restore','-U','agenttrust_restore_fixture','-d','postgres','--create','--exit-on-error'],data=payload[database],timeout=120)
   e.require(c.fingerprint(name)==payload['businessFingerprints'])
  drill.wait(name,service)
  row=c.inspect(name)
  e.require(row['Image']==entry['imageId'] and not row['HostConfig']['PortBindings'] and set(row['NetworkSettings']['Networks'])=={drill.prefix})
  for mount in row['Mounts']:
   if mount['Type']=='volume':e.require(service in state_volumes and mount['Name']==state_volumes[service]);drill.own_volume(mount['Name'])
   else:e.require(mount['Type']=='bind' and not mount['RW'])
  if service=='stack-nats' and state_volumes:
   e.require(live.queue_state(name)==metadata['queue']);drill.report['allCapturedStreamsAndDurableConsumerPositionsRestored']=True
  if service=='stack-redis' and state_volumes:drill.report['redisStateProof']=live.verify_redis(drill,metadata)
  if service=='stack-object-store':
   init=['docker','exec',name,'/usr/local/bin/minio-init']
   # Provision only this empty fixture store using copied private bind files.
   c.run(init,timeout=60)
 network=json.loads(c.run(['docker','network','inspect',drill.prefix]).stdout)[0]
 e.require(network['Internal'] is True and len(network['Containers'])==len(selected))

def state_probe(drill,fixture,phase,input_value=None):
 tools=json.loads(c.run(['docker','image','inspect','agenttrust-security:local']).stdout)[0]['Id']
 corefiles={f['destination']:f['fixturePath'] for service in ('stack-core-api','stack-object-store') for f in fixture[service]['files'] if 'fixturePath' in f}
 name=drill.prefix+'-probe-state-'+phase;drill.containers.append(name)
 args=['docker','run','--rm','--log-driver','none','--name',name,'--label','agenttrust.fixture='+drill.id,'--network',drill.prefix,
       '--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--tmpfs','/tmp:size=32m,mode=1777','--memory','256m','--cpus','1','--pids-limit','64',
       '--mount','type=bind,source='+str(ROOT/'scripts')+',target=/scripts,readonly']
 destinations=('/run/secrets/stack-minio-user','/run/secrets/stack-minio-password') if phase=='historical' else ('/run/secrets/stack-demo-credentials',)
 for destination in destinations:
  target='/credentials.json' if destination.endswith('stack-demo-credentials') else destination
  args+=['--mount','type=bind,source='+corefiles[destination]+',target='+target+',readonly']
 if input_value is not None:
  path=drill.directory/('state-input-'+phase+'.json');c.private_file(path,json.dumps(input_value).encode());path.chmod(0o444);drill.private.append(path)
  args+=['--mount','type=bind,source='+str(path)+',target=/state-input.json,readonly']
 result=c.run(args+[tools,'python','/scripts/stack-stateful-recovery-probe.py','--phase',phase],timeout=300,check=False)
 proof=json.loads(result.stdout)
 if result.returncode or not proof.get('completed'):drill.report['stateProbeFailure']={k:proof[k] for k in ('phase','errorType','completed') if k in proof}
 e.require(result.returncode==0 and proof['completed']);return proof

def owned_runtime(drill,service,action):
 e.require(service in ('stack-nats','stack-ai-worker','stack-core-api','stack-redis') and action in ('stop','start','restart'))
 name=drill.prefix+'-'+service;row=c.inspect(name);e.require(row['Config']['Labels'].get('agenttrust.fixture')==drill.id)
 c.run(['docker',action,row['Id']],timeout=90)
 if action!='stop':drill.wait(name,service)

def state_exercise(drill,fixture,payload,key):
 import stack_live_state as live
 metadata=json.loads(payload['liveStateMetadata']);drill.report['historicalObjectProof']=state_probe(drill,fixture,'historical',metadata)
 drill.report['historicalObjectVersionsRestored']=True
 quota_key=live.seed_fixture_quota(drill);owned_runtime(drill,'stack-redis','restart')
 quota=live.redis_values(drill.prefix+'-stack-redis',[quota_key])[0];e.require(quota[1]=='3' and 0<quota[2]<=15)
 drill.report['fixtureQuotaAofReplayVerified']=True
 owned_runtime(drill,'stack-ai-worker','stop')
 capsule=state_probe(drill,fixture,'admit')['capsule']
 crypto=load('state_capsule_envelope','stack-backup-crypt.py');c.private_file(drill.directory/'fixture-session.aesgcm',crypto.transform('encrypt',key,json.dumps(capsule).encode()))
 queued=live.queue_state(drill.prefix+'-stack-nats');e.require(sum(s['state']['messages'] for s in queued)>=1)
 owned_runtime(drill,'stack-nats','restart');restarted=live.queue_state(drill.prefix+'-stack-nats')
 e.require([(s['name'],s['created'],s['state']['messages'],s['state']['last_seq']) for s in queued]==[(s['name'],s['created'],s['state']['messages'],s['state']['last_seq']) for s in restarted])
 owned_runtime(drill,'stack-ai-worker','start');drill.report['queuedReplayProof']=state_probe(drill,fixture,'completion',capsule)
 owned_runtime(drill,'stack-core-api','restart');drill.report['sessionRestartProof']=state_probe(drill,fixture,'reauth',capsule)
 until=time.monotonic()+17
 while live.redis_values(drill.prefix+'-stack-redis',[quota_key])[0][1] is not None:
  e.require(time.monotonic()<until);time.sleep(.5)
 drill.report.update(queuePersistenceAndReplayVerified=True,sessionReauthenticationRequired=True,existingSessionContinuityVerified=False,
                     fixtureQuotaExpiredWithoutResurrection=True,excludedFromRecovery=['cross-store atomic consistency','JVM login session continuity',
                                                                                       'observability history and services','local model cache and inference','legacy services','HA and production RPO/RTO'])
 e.require(live.queue_state('agenttrust-stack-nats-1')==metadata['queue']);drill.report['sourceQueuePositionsUnchanged']=True

def store_queue_probe(drill,fixture,phase):
 entry=next(f for f in fixture['stack-ai-worker']['files'] if f['destination']=='/run/secrets/stack-nats-token')
 path=drill.directory/('queue-token-'+phase);c.private_file(path,base64.b64decode(entry['content'],validate=True));path.chmod(0o444);drill.private.append(path)
 name=drill.prefix+'-queue-'+phase;drill.containers.append(name)
 result=c.run(['docker','run','--rm','--log-driver','none','--name',name,'--label','agenttrust.fixture='+drill.id,'--network',drill.prefix,
               '--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--tmpfs','/tmp:size=16m,mode=1777','--memory','128m','--cpus','1','--pids-limit','32',
               '--mount','type=bind,source='+str(ROOT/'scripts')+',target=/scripts,readonly','--mount','type=bind,source='+str(path)+',target=/run/secrets/stack-nats-token,readonly',
               '--entrypoint','python',fixture['stack-ai-worker']['imageId'],'/scripts/stack-store-queue-probe.py','--phase',phase],timeout=60,check=False)
 proof=json.loads(result.stdout);drill.report['storeQueue'+phase]=proof;e.require(result.returncode==0 and proof['completed']);return proof

def store_exercise(drill,fixture,payload):
 import stack_live_state as live
 metadata=json.loads(payload['liveStateMetadata']);drill.report['historicalObjectProof']=state_probe(drill,fixture,'historical',metadata);drill.report['historicalObjectVersionsRestored']=True
 key=live.seed_fixture_quota(drill);owned_runtime(drill,'stack-redis','restart');value=live.redis_values(drill.prefix+'-stack-redis',[key])[0]
 e.require(value[1]=='3' and 0<value[2]<=15);drill.report['fixtureQuotaAofReplayVerified']=True
 store_queue_probe(drill,fixture,'admit');before=live.queue_state(drill.prefix+'-stack-nats');owned_runtime(drill,'stack-nats','restart');after=live.queue_state(drill.prefix+'-stack-nats')
 e.require([(s['name'],s['created'],s['state']['messages'],s['state']['last_seq']) for s in before]==[(s['name'],s['created'],s['state']['messages'],s['state']['last_seq']) for s in after])
 store_queue_probe(drill,fixture,'completion');until=time.monotonic()+17
 while live.redis_values(drill.prefix+'-stack-redis',[key])[0][1] not in (None,False):e.require(time.monotonic()<until);time.sleep(.5)
 e.require(live.queue_state('agenttrust-stack-nats-1')==metadata['queue'])
 drill.report.update(queuePersistenceAndReplayVerified=True,fixtureQuotaExpiredWithoutResurrection=True,sourceQueuePositionsUnchanged=True,
                     sessionReauthenticationRequired=True,existingSessionContinuityVerified=False,
                     excludedFromRecovery=['cross-store atomic consistency','JVM login session continuity','API restart reauthentication exercise',
                                           'observability history and services','local model cache and inference','legacy services','HA and production RPO/RTO'])

def session_capacity(minimum_mib=2048):
 host=require_host_capacity(minimum_mib)
 total=int(c.run(['docker','info','--format','{{.MemTotal}}']).stdout)
 # A --rm helper can exit while Docker assembles stats and yield '--'.
 # Retry the complete sample; never omit an unknown usage row from the sum.
 matches=[]
 for attempt in range(3):
  lines=c.run(['docker','stats','--no-stream','--format','{{.MemUsage}}']).stdout.decode().splitlines()
  matches=[e.re.fullmatch(r'([0-9.]+)(B|KiB|MiB|GiB)',line.split('/')[0].strip()) for line in lines]
  if 0<len(lines)<=64 and all(matches):break
 e.require(0<len(matches)<=64 and all(matches))
 used=sum(float(match[1])*{'B':1,'KiB':1024,'MiB':1048576,'GiB':1073741824}[match[2]] for match in matches)
 free=total-used;e.require(free>=minimum_mib*1048576)
 return {**host,'dockerMemoryMiB':int(total/1048576),'reportedFreeWorkingSetMiB':int(free/1048576),'requiredFreeMiB':minimum_mib}

def session_exercise(drill,fixture,key,checkpoint):
 checkpoint();opened=state_probe(drill,fixture,'session-open');capsule=opened['capsule']
 crypto=load('session_only_envelope','stack-backup-crypt.py');c.private_file(drill.directory/'fixture-session.aesgcm',crypto.transform('encrypt',key,json.dumps(capsule).encode()))
 drill.report['preRestartSessionProof']=state_probe(drill,fixture,'session-check',capsule)
 before=c.inspect(drill.prefix+'-stack-core-api');checkpoint();owned_runtime(drill,'stack-core-api','restart');checkpoint()
 after=c.inspect(drill.prefix+'-stack-core-api');e.require(before['Id']==after['Id'] and before['Image']==after['Image'] and before['State']['StartedAt']!=after['State']['StartedAt'])
 drill.report['sessionRestartProof']=state_probe(drill,fixture,'reauth',capsule);checkpoint()
 drill.report.update(apiRestartReauthenticationVerified=True,sessionReauthenticationRequired=True,existingSessionContinuityVerified=False,fixtureApiIdAndImagePreserved=True,
                     excludedFromRecovery=['cross-database and cross-store atomic consistency','JVM login session continuity','gateway and queue/storage paths in this phase',
                                           'observability history and services','local model cache and inference','legacy services','HA and production RPO/RTO'])

def run(config_path,config_hash,execute,include_live_state=False,stores_only=False,session_only=False):
 e.require(not stores_only or (execute and include_live_state))
 e.require(not session_only or (execute and not stores_only and not include_live_state))
 capacity=session_capacity() if session_only else None
 ids,raw,inventory,by_service=d.live_baseline();hashes=e.planner.compose_hashes(inventory,ROOT)
 _,protected=d.resolved_groups(inventory,by_service,list(e.planner.COMPONENTS))
 config=e.delivery.json_bytes(e.anchored_file(config_path,config_hash));release=e.verify_candidate_release(config,config['revision'],inventory,{})
 sources=c.source_preflight();drill=c.Rehearsal(sources)
 drill.report.update(kind='online-independent-logical-development-recovery',fullStackRecoveryVerified=False,coherentOperatingBackupVerified=False,
                     historicalObjectVersionsRestored=False,queueAndSessionStateRestored=False,actualDeploymentPerformed=False,sourceServicesStopped=False,
                     excludedFromRecovery=['historical MinIO object versions','JetStream queue state','Redis sessions and quotas',
                                           'observability history and services','local model cache and inference','legacy services','HA and production RPO/RTO'])
 if session_only:drill.report['sessionCapacityPreflight']=capacity
 if not execute:
  drill.report.update(completed=True,readOnly=True);drill.save();return drill
 crypto=load('online_envelope','stack-backup-crypt.py');keydir=ROOT/'.local'/('online-recovery-key-'+drill.id);protect(keydir)
 key=secrets.token_bytes(32);c.private_file(keydir/'key.bin',key)
 drill.report['retainedKeyDirectory']=str(keydir);payload={};encrypted={}
 try:
  drill.stage('online-database-logical-capture')
  payload['configuration']=c.Rehearsal.configuration(drill)
  before=c.fingerprint();payload['businessFingerprints']=json.dumps(before,sort_keys=True).encode()
  e.same_schema(e.migration_catalog(config['revision']),e.live_ledger())
  payload['roles']=c.run(['docker','exec','agenttrust-stack-db-1','pg_dumpall','-U','agenttrust_stack','--roles-only','--no-password'],timeout=60).stdout
  e.require(0<len(payload['roles'])<1048576)
  for database in DATABASES:
   payload[database]=c.run(dump_command(database),timeout=180).stdout
   e.require(payload[database].startswith(b'PGDMP') and 0<len(payload[database])<32*1024*1024)
  if include_live_state:
   import stack_live_state as live
   drill.stage('read-only-live-state-copy-with-stability-checks');payload.update(live.capture(sources,c.sql))
  e.require(c.fingerprint()==before)
  for name,body in payload.items():
   encrypted[name]=crypto.transform('encrypt',key,body);c.private_file(drill.directory/(name+'.aesgcm'),encrypted[name])
  manifest={'schemaVersion':1,'kind':'online-independent-logical','snapshotId':drill.id,'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'components':{n:component(v) for n,v in encrypted.items()},'sourceImageIds':{s:v['Image'] for s,v in sources.items()},'candidateRevision':config['revision'],
            'crossDatabaseSnapshotAtomic':False,'crossStoreSnapshotAtomic':False,'liveStateIncluded':include_live_state}
  cipher=crypto.transform('encrypt',key,json.dumps(manifest).encode());c.private_file(drill.directory/'online-manifest.aesgcm',cipher)
  recovered=json.loads(crypto.transform('decrypt',key,cipher));e.require(recovered==manifest)
  for name in payload:
   stored=(drill.directory/(name+'.aesgcm')).read_bytes();e.require(component(stored)==manifest['components'][name]);e.require(crypto.transform('decrypt',key,stored)==payload[name])
  drill.report.update(freshOnlineLogicalEvidenceCaptured=True,encryptedManifestSha256=hashlib.sha256(cipher).hexdigest(),independentDatabaseSnapshots=2)
  drill.save()
  child=c.run([sys.executable,str(ROOT/'scripts/stack-online-recovery.py'),'--verify-snapshot',str(drill.directory),'--retained-key-file',str(keydir/'key.bin'),
               '--expected-manifest-sha256',drill.report['encryptedManifestSha256'],'--expected-snapshot-id',drill.id],timeout=60)
  verified=json.loads(child.stdout);e.require(verified.get('onlineLogicalArchiveAuthenticated') is True);drill.report['freshProcessArchiveVerification']=verified
  payload['businessFingerprints']=before
  fixture=json.loads(payload['configuration']);runtime=json.loads((release['directory']/'runtime-identity.json').read_bytes())['imageIds']
  for service in c.SERVICES:
   if stores_only and service not in ('stack-nats','stack-redis','stack-object-store','stack-ai-worker'):continue
   if session_only and service not in ('stack-db','stack-identity','stack-core-api','stack-console'):continue
   if service not in e.planner.COMPONENTS:continue
   name=e.planner.COMPONENTS[service];ref=next(row['reference'] for row in release['receipt']['images'] if row['name']==name)
   c.run(['docker','pull',ref],timeout=600);image=json.loads(c.run(['docker','image','inspect',ref]).stdout)[0];cached_identity(image,ref,runtime[name]);fixture[service]['imageId']=image['Id']
  # The fixture's initializer needs both root and restricted application secrets.
  corefiles={f['destination']:f for f in fixture['stack-core-api']['files']}
  for name in ('stack-minio-user','stack-minio-password'):fixture['stack-object-store']['files'].append(dict(corefiles['/run/secrets/'+name]))
  def checkpoint():
   e.planner.recheck(ids,inventory,ROOT,hashes);e.require(d.hash_files(protected)==protected)
   if session_only:session_capacity(512)
  selected=('stack-nats','stack-redis','stack-object-store') if stores_only else None
  if session_only:
   session_capacity();selected=('stack-db','stack-identity','stack-core-api','stack-console')
   fixture['stack-console']['env']=[v for v in fixture['stack-console']['env'] if not v.startswith('CORE_API_URL=')]+['CORE_API_URL=http://stack-core-api:8080']
   drill.report['fixtureRoutingOverride']={'stack-console':{'CORE_API_URL':'http://stack-core-api:8080'}}
  drill.stage('isolated-logical-restore-and-candidate-startup');restore(drill,fixture,payload,checkpoint,selected)
  if session_only:
   drill.stage('isolated-api-restart-and-session-reauthentication');session_exercise(drill,fixture,key,checkpoint);e.require(c.fingerprint()==before)
   drill.report.update(completed=True,businessStackServicesStarted=4,operatingDatabaseLogicalRestoreVerified=True,operatingBusinessRowsUnchanged=True)
   return drill
  if stores_only:
   drill.stage('isolated-three-store-history-and-replay');store_exercise(drill,fixture,payload);checkpoint();e.require(c.fingerprint()==before)
   drill.report.update(completed=True,businessStackServicesStarted=3,operatingDatabaseLogicalRestoreVerified=False,operatingBusinessRowsUnchanged=True)
   return drill
  if include_live_state:
   drill.stage('historical-versions-queued-restart-and-session-contract');state_exercise(drill,fixture,payload,key);checkpoint()
  tools=json.loads(c.run(['docker','image','inspect','agenttrust-security:local']).stdout)[0]['Id']
  credential=next(f['fixturePath'] for f in fixture['stack-core-api']['files'] if f['destination']=='/run/secrets/stack-demo-credentials')
  name=drill.prefix+'-probe-online';drill.containers.append(name)
  result=c.run(['docker','run','--rm','--name',name,'--label','agenttrust.fixture='+drill.id,'--network',drill.prefix,'--read-only','--cap-drop','ALL',
                '--security-opt','no-new-privileges:true','--tmpfs','/tmp:size=32m,mode=1777','--memory','256m','--cpus','1','--pids-limit','64',
                '--mount','type=bind,source='+str(ROOT/'scripts')+',target=/scripts,readonly','--mount','type=bind,source='+credential+',target=/credentials.json,readonly',
                tools,'python','/scripts/stack-online-recovery-probe.py'],timeout=180,check=False)
  proof=json.loads(result.stdout);drill.report['applicationProof']=proof;e.require(result.returncode==0 and proof['completed'] and proof['ownSessionsClosed'])
  e.require(c.fingerprint()==before)
  drill.report.update(completed=True,businessStackServicesStarted=11,candidateBusinessPathVerified=True,operatingDatabaseLogicalRestoreVerified=True,
                      restoredBusinessFingerprintsEqual=True,operatingBusinessRowsUnchanged=True)
 except Exception as error:
  drill.report.update(completed=False,errorType=type(error).__name__,code='ONLINE_RECOVERY_UNVERIFIED',
                      failureLocations=[{'file':pathlib.Path(x.filename).name,'line':x.lineno} for x in traceback.extract_tb(error.__traceback__)])
 finally:
  try:e.planner.recheck(ids,inventory,ROOT,hashes);e.require(d.hash_files(protected)==protected);drill.report['operationalContainersUnchanged']=True
  except Exception:
   drill.report.update(completed=False,operationalContainersUnchanged=False)
   try:
    states=json.loads(c.run(['docker','inspect',*ids]).stdout)
    drill.report['operationalContainerIdsAndImagesUnchanged']=all(row['Id']==inventory[row['Config']['Labels']['com.docker.compose.service']]['containerId'] and row['Image']==inventory[row['Config']['Labels']['com.docker.compose.service']]['rollbackImageId'] for row in states)
    drill.report['sourceHealthAtFailure']=[{'service':row['Config']['Labels']['com.docker.compose.service'],'running':row['State']['Running'],'health':row['State'].get('Health',{}).get('Status'),'oomKilled':row['State'].get('OOMKilled')} for row in states if not row['State']['Running'] or row['State'].get('Health',{}).get('Status')!='healthy']
   except Exception:drill.report['sourceHealthDiagnosticAvailable']=False
  drill.cleanup()
 return drill

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--config',type=pathlib.Path);p.add_argument('--expected-config-sha256');p.add_argument('--execute',action='store_true')
 p.add_argument('--verify-snapshot',type=pathlib.Path);p.add_argument('--retained-key-file',type=pathlib.Path);p.add_argument('--expected-manifest-sha256');p.add_argument('--expected-snapshot-id');p.add_argument('--include-live-state',action='store_true');p.add_argument('--state-stores-only',action='store_true');p.add_argument('--session-only',action='store_true');args=p.parse_args()
 try:
  if args.verify_snapshot:
   e.require(not args.execute and not args.config and pathlib.Path.cwd().resolve()==ROOT)
   print(json.dumps(verify_retained(args.verify_snapshot,args.retained_key_file,args.expected_manifest_sha256,args.expected_snapshot_id)));return 0
  e.require(pathlib.Path.cwd().resolve()==ROOT);drill=run(args.config,args.expected_config_sha256,args.execute,args.include_live_state,args.state_stores_only,args.session_only)
  print(json.dumps({'completed':drill.report['completed'],'reportPath':str(drill.directory/'summary.json'),'fullStackRecoveryVerified':False,'actualDeploymentPerformed':False}));return 0 if drill.report['completed'] else 1
 except Exception as error:
  print(json.dumps({'completed':False,'code':'ONLINE_RECOVERY_UNVERIFIED','errorType':type(error).__name__}));return 1
if __name__=='__main__':sys.exit(main())
