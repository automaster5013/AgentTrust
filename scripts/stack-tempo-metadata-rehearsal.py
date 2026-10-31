"""Reproduce empty metadata and rehearse quarantine only in owned Tempo copies.
Never edits operating metadata, stops source writers, or enables deployment.
"""
import argparse,datetime,decimal,hashlib,importlib.util,json,pathlib,re,secrets,sys,time,traceback,urllib.parse,uuid
import stack_chunked_cache as chunks
from stack_tempo_poll_evidence import counters, classify_inverse
from stack_host_capacity import require_sustained_host_capacity
from stack_local_cd_executor import normalized_host_path
ROOT=pathlib.Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('metadata_tempo',ROOT/'scripts/stack-tempo-history-recovery.py');tempo=importlib.util.module_from_spec(spec);spec.loader.exec_module(tempo);m=tempo.m;cache=tempo.cache

def block_prefix(value):
 path=pathlib.PurePosixPath(value);m.e.require(str(path)==value);parts=path.parts
 m.e.require(len(parts)==3 and parts[0]=='blocks' and m.e.re.fullmatch('[A-Za-z0-9_-]{1,128}',parts[1]) and str(uuid.UUID(parts[2]))==parts[2])
 return value

def cached_candidate(reference,runtime):
 # A local drill must not add pull/unpack pressure or silently fetch missing assets.
 image=json.loads(m.c.run(['docker','image','inspect',reference]).stdout)[0]
 m.cached_identity(image,reference,runtime)
 return image

def memory_sample(drill,name,expected):
 # One bounded CLI read, no helper/exec/cgroup writes or operating-container stats.
 def bound():
  row=owned_container(drill,name)
  identity=(row['Id'],row['Image'],row['State']['StartedAt'])
  m.e.require(identity==expected and re.fullmatch('[a-f0-9]{64}',identity[0]))
  m.e.require(row['State']['Running'] is True and row['State'].get('OOMKilled') is False and row['RestartCount']==0)
  m.e.require(row['HostConfig']['Memory']==512*1048576)
  env=row['Config'].get('Env',[])
  for key,value in [('GOMEMLIMIT','384MiB'),('GOMAXPROCS','1')]:
   m.e.require([v for v in env if v.startswith(key+'=')]==[key+'='+value])
  return identity
 bound()
 result=m.c.run(['docker','stats','--no-stream','--no-trunc','--format','{{.MemUsage}}',expected[0]],timeout=10)
 m.e.require(type(result.stdout) is bytes and 0<len(result.stdout)<=256)
 match=re.fullmatch(rb'([0-9]+(?:\.[0-9]+)?) ?(B|KiB|MiB|GiB) / ([0-9]+(?:\.[0-9]+)?) ?(B|KiB|MiB|GiB)\s*',result.stdout)
 m.e.require(match)
 units={b'B':1,b'KiB':1024,b'MiB':1048576,b'GiB':1073741824}
 usage=decimal.Decimal(match[1].decode())*units[match[2]];limit=decimal.Decimal(match[3].decode())*units[match[4]]
 m.e.require(limit==512*1048576 and 0<usage<=limit)
 bound()
 return {'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'containerId':expected[0],
         'dockerCliCacheAdjustedUsageBytesApprox':int(usage),'containerLimitBytes':int(limit),
         'identityAndProfilePreserved':True,'exactRssMeasured':False,'lifetimePeakMeasured':False}

def fresh(report):
 created=datetime.datetime.fromisoformat(report['startedAt']);m.e.require(created.tzinfo is not None and 0<=(datetime.datetime.now(datetime.timezone.utc)-created).total_seconds()<=86400)
 m.e.require(report['completed'] is True and report['operationalContainersUnchanged'] is True and report['ownFixtureAndTemporarySecretsCleaned'] is True)

def file_rows(manifest):return {name:{k:v for k,v in row.items() if k!='chunks'} for name,row in manifest['files'].items()}

def verdict(before,negative,after):
 m.e.require(before and before==after and all(v[1]>0 for v in before.values()))
 m.e.require(negative['statusCode']==404 and negative['ready'] is True and negative['truncatedJsonErrors']>0)
 return {'metadataFailureReproduced':True,'ownedCopyQuarantineRecoveryVerified':True,'matchingTraces':len(after),'matchingSpans':sum(v[1] for v in after.values()),
         'operatingMetadataRepaired':False,'affectedBlockContentsRecovered':False,'fullStackRecoveryVerified':False,'automaticDeploymentAllowed':False,'actualDeploymentPerformed':False}

def owned_container(drill,name):
 m.e.require(name in drill.containers and name.startswith(drill.prefix+'-'))
 row=m.c.inspect(name);m.e.require(row['Config']['Labels'].get('agenttrust.fixture')==drill.id);return row

def stop_owned(drill,name):
 owned_container(drill,name);m.c.run(['docker','rm','-f',name])

def quarantine_owned(drill,volume,prefix,expected):
 m.e.require(volume==drill.target_volume and volume!=drill.source_volume);drill.own_volume(volume);block_prefix(prefix)
 current=json.loads(m.c.run(cache.file_command(drill,volume,'inventory',prefix=prefix)).stdout);m.e.require(current==expected)
 result=json.loads(m.c.run(cache.file_command(drill,volume,'quarantine-block',prefix)).stdout);m.e.require(result=={'quarantined':True,'bytesDeleted':False})
 copied=json.loads(m.c.run(cache.file_command(drill,volume,'inventory',prefix='quarantine/'+prefix)).stdout)
 m.e.require({name.removeprefix('quarantine/'):row for name,row in copied.items()}==expected)

def inverse_owned(drill,volume,prefix,expected):
 m.e.require(volume==drill.target_volume and volume!=drill.source_volume);drill.own_volume(volume);block_prefix(prefix)
 copied=json.loads(m.c.run(cache.file_command(drill,volume,'inventory',prefix='quarantine/'+prefix)).stdout)
 m.e.require({name.removeprefix('quarantine/'):row for name,row in copied.items()}==expected)
 result=json.loads(m.c.run(cache.file_command(drill,volume,'restore-quarantined-block',prefix)).stdout);m.e.require(result=={'restored':True,'bytesDeleted':False})
 m.e.require(json.loads(m.c.run(cache.file_command(drill,volume,'inventory',prefix=prefix)).stdout)==expected)


def hot_identity(drill,name):
 row=owned_container(drill,name);m.e.require(row['State']['Running'] is True and row['State'].get('OOMKilled') is False and row['RestartCount']==0)
 return row['Id'],row['Image'],row['State']['StartedAt']


def observe_hot(drill,name,checkpoint,condition,timeout=900):
 identity=hot_identity(drill,name);deadline=time.monotonic()+timeout;attempts=0
 while True:
  checkpoint();m.e.require(hot_identity(drill,name)==identity);attempts+=1
  result=condition()
  if result:return result,{'attempts':attempts,'identityUnchanged':True,'restartPerformed':False}
  m.e.require(time.monotonic()<deadline)
  time.sleep(20)


def restore(drill,volume,manifest,directory,key):
 drill.target_volume=volume;drill.own_volume(volume)
 def cipher(name):
  row=next(c for f in manifest['files'].values() for c in f['chunks'] if c['file']==name)
  return m.e.anchored_file(directory/name,row['cipherSha256'],limit=chunks.CHUNK+128)
 chunks.restore(manifest,cipher,lambda raw:drill.crypto.transform('decrypt',key,raw),
                lambda name,offset,raw:m.c.run(cache.file_command(drill,volume,'write',name,offset,len(raw)),data=raw),
                lambda name,size,mode:m.c.run(cache.file_command(drill,volume,'finalize',name,size,0,mode)))

def protected_logitrack(ids=None):
 if ids is None:ids=m.c.run(['docker','ps','-q','--filter','label=com.docker.compose.project=logitrack']).stdout.decode().split()
 m.e.require(len(ids)==12 and len(set(ids))==12 and all(m.e.re.fullmatch('[a-f0-9]{12,64}',value) for value in ids))
 rows=json.loads(m.c.run(['docker','inspect',*ids]).stdout);m.e.require(len(rows)==12)
 for row in rows:
  m.e.require(row['Config']['Labels'].get('com.docker.compose.project')=='logitrack' and row['State']['Running'] is True and row['State'].get('Health',{}).get('Status')=='healthy')
  m.e.require(m.e.re.fullmatch('[a-f0-9]{64}',row['Id']) and m.e.re.fullmatch('sha256:[a-f0-9]{64}',row['Image']))
 result=tuple(sorted((row['Id'],row['Image']) for row in rows));m.e.require(len({row[0] for row in result})==12);return result

def run(config):
 host_window=require_sustained_host_capacity();m.session_capacity();logitrack=protected_logitrack();ids,raw,inventory,by=m.d.live_baseline();hashes=m.e.planner.compose_hashes(inventory,ROOT);_,protected=m.d.resolved_groups(inventory,by,list(m.e.planner.COMPONENTS))
 source=by['stack-tempo'];mounts=[v for v in source['Mounts'] if v['Type']=='volume'];m.e.require(len(mounts)==1 and mounts[0]['Name']=='agenttrust_stack-tempo-data')
 volume=json.loads(m.c.run(['docker','volume','inspect',mounts[0]['Name']]).stdout)[0];m.e.require(volume['Labels']['com.docker.compose.project']=='agenttrust' and volume['Labels']['com.docker.compose.volume']=='stack-tempo-data');m.c.reserve()
 baseline_path=pathlib.Path(config['baselineSummary']).resolve();audit_path=pathlib.Path(config['auditSummary']).resolve()
 for path in (baseline_path,audit_path):m.e.require(path.parent.parent==(ROOT/'.local').resolve())
 baseline=json.loads(m.e.anchored_file(baseline_path,config['baselineSummarySha256']));audit_report=json.loads(m.e.anchored_file(audit_path,config['auditSummarySha256']));fresh(baseline);fresh(audit_report)
 custody=[m.c.retained_key(ROOT,pathlib.Path(r['retainedKeyDirectory'])/'key.bin') for r in (baseline,audit_report)]
 keys=[v[0].read_bytes() for v in custody];crypto=m.load('metadata_control_crypto','stack-backup-crypt.py')
 manifest=json.loads(crypto.transform('decrypt',keys[0],m.e.anchored_file(baseline_path.parent/'blocks-manifest.aesgcm',baseline['encryptedManifestSha256'],limit=8*1024*1024)));chunks.validate(manifest)
 m.e.require(manifest['component']=='tempo-closed-block-selection' and manifest['sourceImageId']==source['Image'])
 selected=manifest['selected'];m.e.require(1<=len(selected)<=3)
 for block in selected:block_prefix(block['prefix']);m.e.require(type(block['start']) is int and type(block['end']) is int and 0<block['start']<block['end']<time.time()-120)
 m.e.require(all(any(name.startswith(b['prefix']+'/') for b in selected) for name in manifest['files']))
 audit=json.loads(crypto.transform('decrypt',keys[1],m.e.anchored_file(audit_path.parent/'metadata-audit.aesgcm',audit_report['encryptedAuditSha256'])))
 m.e.require(audit['oversizedNotValidated']==audit['volatileNotValidated']==0 and len(audit['invalid'])==2)
 bad_prefixes=[]
 for row in audit['invalid']:
  m.e.require(row['bytes']==0 and row['category']=='empty-json' and row['sha256']==hashlib.sha256(b'').hexdigest() and pathlib.PurePosixPath(row['path']).name=='meta.json')
  bad_prefixes.append(block_prefix(pathlib.PurePosixPath(row['path']).parent.as_posix()))
 m.e.require(len(set(bad_prefixes))==2 and not set(bad_prefixes)&{b['prefix'] for b in selected})
 candidate=json.loads(m.e.anchored_file(config['candidateConfig'],config['candidateConfigSha256']));m.e.require(candidate['revision']==manifest['candidateRevision'])
 release=m.e.verify_candidate_release(candidate,candidate['revision'],inventory,{})
 reference=next(v['reference'] for v in release['receipt']['images'] if v['name']=='tempo');m.e.require(reference==manifest['candidateReference'])
 runtime=json.loads((release['directory']/'runtime-identity.json').read_bytes())['imageIds']['tempo'];image=cached_candidate(reference,runtime)
 drill=m.c.Rehearsal({'stack-tempo':source});drill.crypto=crypto;drill.source_volume=mounts[0]['Name'];drill.target_volume=drill.prefix+'-candidate';drill.file_user=source['Config']['User'];drill.tools=json.loads(m.c.run(['docker','image','inspect','agenttrust-security:local']).stdout)[0]['Id']
 drill.report.update(hostMemoryWindow=host_window,kind='isolated-empty-tempo-metadata-control',candidateRevision=candidate['revision'],candidateReference=reference,sourceImageId=source['Image'],sourceServicesStopped=False,
                     fullStackRecoveryVerified=False,automaticDeploymentAllowed=False,actualDeploymentPerformed=False,operatingMetadataRepaired=False,affectedBlockContentsRecovered=False,
                     localCandidateCacheOnly=True,fixtureGoMemoryLimitMiB=384,fixtureGoMaxProcs=1,fixtureMemoryLimitMiB=512,fixtureMemorySavingsMeasured=False)
 keydir=ROOT/'.local'/('tempo-control-key-'+drill.id);m.protect(keydir);key=secrets.token_bytes(32);m.c.private_file(keydir/'key.bin',key);drill.report['retainedKeyDirectory']=str(keydir)
 active_memory={};last_memory=[None];memory_samples=[]
 drill.report.update(fixtureMemorySamples=memory_samples,fixtureMemoryUsageObserved=False,fixtureMemoryLifetimePeakMeasured=False)
 def sample_memory(force=False):
  if not active_memory:return
  now=time.monotonic()
  if not force and last_memory[0] is not None and now-last_memory[0]<20:return
  m.e.require(len(memory_samples)<128 and len(active_memory)==1)
  m.session_capacity(512)
  for name,identity in active_memory.items():memory_samples.append(memory_sample(drill,name,identity))
  m.session_capacity(512)
  last_memory[0]=time.monotonic();drill.report.update(fixtureMemoryUsageObserved=True,
    fixtureMemorySampledMaximumBytesApprox=max(v['dockerCliCacheAdjustedUsageBytesApprox'] for v in memory_samples))
 def stop_reader(name):
  sample_memory(True);stop_owned(drill,name);active_memory.pop(name)
 def protected_checkpoint():
  m.e.planner.recheck(ids,inventory,ROOT,hashes);m.e.require(m.d.hash_files(protected)==protected and all(m.c.key_unchanged(*v) for v in custody) and protected_logitrack([v[0] for v in logitrack])==logitrack)
 def checkpoint():
  protected_checkpoint();m.session_capacity(512);sample_memory()
 def source_files(prefix):return json.loads(m.c.run(cache.file_command(drill,drill.source_volume,'inventory',prefix=prefix),timeout=120).stdout)
 def create_volume(name):
  drill.volumes.append(name);m.c.run(['docker','volume','create','--label','agenttrust.fixture='+drill.id,name]);drill.own_volume(name);drill.volume_command(name,drill.file_user,['chown',drill.file_user,'/data'],write=True,initialize=True)
 try:
  drill.stage('bind-current-good-and-empty-source-files')
  good_files=file_rows(manifest);bad_files={}
  for block in selected:m.e.require(source_files(block['prefix'])=={k:v for k,v in good_files.items() if k.startswith(block['prefix']+'/')})
  for prefix in bad_prefixes:bad_files.update(source_files(prefix))
  for row in audit['invalid']:m.e.require(bad_files[row['path']]['bytes']==0 and bad_files[row['path']]['sha256']==row['sha256'])
  m.e.require(not set(good_files)&set(bad_files));affected=drill.directory/'affected';affected.mkdir(mode=0o700)
  def read(name,offset,size):checkpoint();return m.c.run(cache.file_command(drill,drill.source_volume,'read',name,offset,size),timeout=120).stdout
  bad_manifest=chunks.capture(bad_files,read,lambda raw:crypto.transform('encrypt',key,raw),lambda name,raw:m.c.private_file(affected/name,raw));cipher=crypto.transform('encrypt',key,json.dumps(bad_manifest).encode());m.c.private_file(affected/'manifest.aesgcm',cipher);drill.report['encryptedAffectedManifestSha256']=hashlib.sha256(cipher).hexdigest()
  bad_manifest=json.loads(crypto.transform('decrypt',key,m.e.anchored_file(affected/'manifest.aesgcm',drill.report['encryptedAffectedManifestSha256'],limit=8*1024*1024)));chunks.validate(bad_manifest)
  for prefix in bad_prefixes:m.e.require(source_files(prefix)=={k:v for k,v in bad_files.items() if k.startswith(prefix+'/')})
  settings=next(v for v in source['Mounts'] if v['Type']=='bind' and v['Destination']=='/etc/tempo.yaml');path=pathlib.Path(normalized_host_path(settings['Source']));m.e.require(path.is_file() and path.resolve().is_relative_to(ROOT));settings_bytes=path.read_bytes()
  copied_config=drill.directory/'tempo.yaml';m.c.private_file(copied_config,settings_bytes);copied_config.chmod(0o444);drill.private.append(copied_config)
  def start(name,volume,image_id,logs=False):
   checkpoint();m.e.require(path.read_bytes()==settings_bytes);drill.own_volume(volume)
   # All cold controls are sequential; a running old fixture must not overlap.
   for previous in drill.containers:
    if previous!=name:
     result=m.c.run(['docker','ps','-q','--filter','name=^/'+previous+'$']).stdout
     m.e.require(not result.strip())
   if name not in drill.containers:drill.containers.append(name)
   args=['docker','run','-d','--name',name,'--label','agenttrust.fixture='+drill.id,'--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--user',drill.file_user,'--memory','512m','--env','GOMEMLIMIT=384MiB','--env','GOMAXPROCS=1','--cpus','1','--pids-limit','128','--tmpfs','/tmp:size=32m,mode=1777']
   args+=['--log-driver','local','--log-opt','max-size=1m','--log-opt','max-file=2'] if logs else ['--log-driver','none']
   result=m.c.run(args+['--mount','type=volume,source='+volume+',target=/var/tempo','--mount','type=bind,source='+str(copied_config)+',target=/etc/tempo.yaml,readonly',image_id,'-config.file=/etc/tempo.yaml','-target=all'],check=False)
   if result.returncode:
    raw=result.stderr[:65536];cipher=crypto.transform('encrypt',key,raw);m.c.private_file(drill.directory/'fixture-start-error.aesgcm',cipher)
    lower=raw.lower();category='resource' if any(v in lower for v in (b'memory',b'cannot allocate',b'resource temporarily unavailable')) else 'logging' if b'log' in lower else 'mount' if b'mount' in lower else 'other'
    drill.report.update(fixtureStartFailed=True,fixtureStartExitCode=result.returncode,fixtureStartErrorCategory=category,encryptedStartErrorSha256=hashlib.sha256(cipher).hexdigest())
   m.e.require(result.returncode==0);drill.wait(name,'stack-tempo')
   row=owned_container(drill,name);m.e.require(row['Image']==image_id and row['HostConfig']['NetworkMode']=='none' and not row['HostConfig']['PortBindings'])
   m.e.require(not active_memory);active_memory[name]=(row['Id'],row['Image'],row['State']['StartedAt']);sample_memory(True)
  original_volume=drill.prefix+'-original';candidate_volume=drill.prefix+'-candidate';original_name=drill.prefix+'-original-stack-tempo';candidate_name=drill.prefix+'-stack-tempo'
  drill.stage('independent-original-image-positive-control');create_volume(original_volume);restore(drill,original_volume,manifest,baseline_path.parent,keys[0]);m.e.require(json.loads(m.c.run(cache.file_command(drill,original_volume,'inventory')).stdout)==good_files);start(original_name,original_volume,source['Image'])
  bounds=urllib.parse.urlencode({'start':min(b['start'] for b in selected)-1,'end':max(b['end'] for b in selected)+1});m.e.require(max(b['end'] for b in selected)-min(b['start'] for b in selected)<=7*86400-2)
  search=tempo.get(original_name,'/api/search?'+bounds+'&limit=20');m.e.require(search.get('traces'));paths=['/api/traces/'+tempo.trace_id(v['traceID'])+'?'+bounds for v in search['traces']];before={p:tempo.trace_fingerprint(tempo.get(original_name,p)) for p in paths};m.e.require(len(before)==len(paths))
  reference_cipher=crypto.transform('encrypt',key,json.dumps({'before':before,'baselineManifestSha256':baseline['encryptedManifestSha256']}).encode());m.c.private_file(drill.directory/'positive-reference.aesgcm',reference_cipher);drill.report.update(encryptedPositiveReferenceSha256=hashlib.sha256(reference_cipher).hexdigest(),positiveTraces=len(before),positiveSpans=sum(v[1] for v in before.values()),maximumConcurrentTempoFixtures=1)
  stop_reader(original_name)
  drill.stage('published-candidate-with-exact-two-empty-original-blocks');create_volume(candidate_volume);restore(drill,candidate_volume,manifest,baseline_path.parent,keys[0]);restore(drill,candidate_volume,bad_manifest,affected,key)
  m.e.require(json.loads(m.c.run(cache.file_command(drill,candidate_volume,'inventory')).stdout)=={**good_files,**bad_files});start(candidate_name,candidate_volume,image['Id'],logs=True)
  status=None
  try:tempo.get(candidate_name,paths[0])
  except ValueError as error:status=getattr(error,'read_failure',{}).get('statusCode')
  owned_container(drill,candidate_name);logs=m.c.run(['docker','logs','--tail','100',candidate_name],check=False);log_bytes=logs.stdout+logs.stderr;m.e.require(logs.returncode==0 and len(log_bytes)<=262144)
  negative={'statusCode':status,'ready':True,'truncatedJsonErrors':log_bytes.lower().count(b'unexpected end of json input')};m.e.require(negative['statusCode']==404 and negative['truncatedJsonErrors']>0)
  cipher=crypto.transform('encrypt',key,log_bytes);m.c.private_file(drill.directory/'negative-fixture-logs.aesgcm',cipher);drill.report.update(negativeControl=negative,encryptedNegativeLogsSha256=hashlib.sha256(cipher).hexdigest())
  hot=config.get('hotPolling',False);m.e.require(type(hot) is bool);identity=hot_identity(drill,candidate_name) if hot else None
  drill.stage('quarantine-only-owned-copies-preserving-all-affected-bytes');drill.target_volume=candidate_volume
  if not hot:stop_reader(candidate_name)
  for prefix in bad_prefixes:quarantine_owned(drill,candidate_volume,prefix,{k:v for k,v in bad_files.items() if k.startswith(prefix+'/')})
  if not hot:start(candidate_name,candidate_volume,image['Id'])
  def recovered():
   try:found={p:tempo.trace_fingerprint(tempo.get(candidate_name,p)) for p in paths}
   except ValueError as error:
    m.e.require(getattr(error,'read_failure',{}).get('statusCode')==404);return None
   m.e.require(found==before);return found
  if hot:after,recovery_observation=observe_hot(drill,candidate_name,checkpoint,recovered)
  else:after=recovered()
  result=verdict(before,negative,after)
  hot_evidence={};inverse_metric_samples={}
  if hot:
   metric_tenants={pathlib.PurePosixPath(prefix).parts[1] for prefix in bad_prefixes};m.e.require(len(metric_tenants)==1 and metric_tenants=={pathlib.PurePosixPath(row['prefix']).parts[1] for row in selected});metric_tenant=next(iter(metric_tenants))
   inverse_metrics=counters(tempo.get(candidate_name,'/metrics')['metrics'])
   phase={'metricTenant':metric_tenant,'inverseMetricsBaseline':inverse_metrics,'before':before,'after':after,'observation':recovery_observation,'identity':identity,'restartFreeApplyVerified':True,'automaticDeploymentAllowed':False}
   cipher=crypto.transform('encrypt',key,json.dumps(phase).encode());m.c.private_file(drill.directory/'hot-recovery-phase.aesgcm',cipher)
   drill.report.update(restartFreeApplyVerified=True,restartFreeRollbackVerified=False,encryptedHotRecoveryPhaseSha256=hashlib.sha256(cipher).hexdigest())

  if hot:
   m.e.require(hot_identity(drill,candidate_name)==identity);drill.stage('inverse-owned-namespace-without-restart')
   for prefix in bad_prefixes:inverse_owned(drill,candidate_volume,prefix,{k:v for k,v in bad_files.items() if k.startswith(prefix+'/')})
   def corrupt_again():
    try:tempo.get(candidate_name,paths[0])
    except ValueError as error:
     m.e.require(getattr(error,'read_failure',{}).get('statusCode')==404);return {'inverseKnown404Reproduced':True,'retainedGoodBlocklistObserved':False}
    found={p:tempo.trace_fingerprint(tempo.get(candidate_name,p)) for p in paths};m.e.require(found==before)
    inverse_metric_samples['after']=counters(tempo.get(candidate_name,'/metrics')['metrics'])
    observation=classify_inverse(inverse_metrics,inverse_metric_samples['after'],True,metric_tenant)
    return observation if observation['retainedGoodBlocklistObserved'] else None
   for prefix in bad_prefixes:m.e.require(json.loads(m.c.run(cache.file_command(drill,candidate_volume,'inventory',prefix=prefix)).stdout)=={k:v for k,v in bad_files.items() if k.startswith(prefix+'/')})
   drill.report.update(inverseNamespaceFilesVerified=True);drill.stage('observe-inverse-without-restart')
   inverse_result,inverse_observation=observe_hot(drill,candidate_name,checkpoint,corrupt_again)
   m.e.require(hot_identity(drill,candidate_name)==identity)
   for prefix in bad_prefixes:m.e.require(json.loads(m.c.run(cache.file_command(drill,candidate_volume,'inventory',prefix=prefix)).stdout)=={k:v for k,v in bad_files.items() if k.startswith(prefix+'/')})
   hot_evidence={'restartFreeApplyVerified':True,'restartFreeRollbackVerified':False,'restartFreeNamespaceInverseVerified':True,'healthyRollbackGuaranteed':False,'inverseReproducedKnown404':inverse_result['inverseKnown404Reproduced'],'retainedGoodBlocklistObserved':inverse_result['retainedGoodBlocklistObserved'],'inverseRuntimeResult':inverse_result,'fixtureIdentityAndStartedAtUnchanged':True,'recoveryObservation':recovery_observation,'inverseObservation':inverse_observation,'effectivePollingIntervalVerified':False,'pollingMetricsAcceptanceVerified':False}
   drill.report.update(hot_evidence,kind='isolated-empty-tempo-metadata-hot-control')

  source_status=200
  try:tempo.get('agenttrust-stack-tempo-1',paths[0])
  except ValueError as error:source_status=getattr(error,'read_failure',{}).get('statusCode');m.e.require(source_status==404)
  for prefix in bad_prefixes:m.e.require(source_files(prefix)=={k:v for k,v in bad_files.items() if k.startswith(prefix+'/')})
  checkpoint();sample_memory(True);payload=json.dumps({'before':before,'negative':negative,'after':after,'quarantinedSourcePrefixes':bad_prefixes,'baselineManifestSha256':baseline['encryptedManifestSha256'],'auditSha256':audit_report['encryptedAuditSha256'],'hotPolling':hot_evidence,'inverseMetricSamples':({'tenant':metric_tenant,'before':inverse_metrics,**inverse_metric_samples} if hot else {})}).encode();cipher=crypto.transform('encrypt',key,payload);m.c.private_file(drill.directory/'comparison-evidence.aesgcm',cipher)
  drill.report.update(result,completed=True,sourceApiTraceStatus=source_status,sourceEmptyMetadataUnchanged=True,quarantinedOwnedBlocks=len(bad_prefixes),affectedFiles=len(bad_files),affectedBytes=sum(v['bytes'] for v in bad_files.values()),encryptedComparisonSha256=hashlib.sha256(cipher).hexdigest(),protectedLogitrackServices=len(logitrack),protectedLogitrackIdsAndImagesUnchanged=True,operationalContainersUnchanged=True)
 except Exception as error:drill.report.update(capacityFailure=getattr(error,'capacity_failure',None),completed=False,errorType=type(error).__name__,failureLocations=[{'file':pathlib.Path(v.filename).name,'line':v.lineno} for v in traceback.extract_tb(error.__traceback__)])
 finally:
  try:protected_checkpoint();drill.report['operationalContainersUnchanged']=True
  except Exception:drill.report.update(completed=False,operationalContainersUnchanged=False)
  try:m.session_capacity(512);drill.report['finalCapacityCheckPassed']=True
  except Exception as error:drill.report.update(completed=False,finalCapacityCheckPassed=False,finalCapacityFailure=getattr(error,'capacity_failure',None))
  drill.cleanup()
 return drill

def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--config',type=pathlib.Path,required=True);parser.add_argument('--expected-config-sha256',required=True);parser.add_argument('--execute',action='store_true');args=parser.parse_args()
 try:
  m.e.require(pathlib.Path.cwd().resolve()==ROOT and args.execute);drill=run(json.loads(m.e.anchored_file(args.config,args.expected_config_sha256)));print(json.dumps({'completed':drill.report['completed'],'reportPath':str(drill.directory/'summary.json'),'operatingMetadataRepaired':False,'actualDeploymentPerformed':False}));return 0 if drill.report['completed'] else 1
 except Exception as error:print(json.dumps({'completed':False,'code':'TEMPO_METADATA_REHEARSAL_REFUSED','errorType':type(error).__name__,'httpStatusCode':getattr(error,'code',None),'capacityFailure':getattr(error,'capacity_failure',None),'failureLocations':[{'file':pathlib.Path(v.filename).name,'line':v.lineno} for v in traceback.extract_tb(error.__traceback__)]}));return 1
if __name__=='__main__':sys.exit(main())
