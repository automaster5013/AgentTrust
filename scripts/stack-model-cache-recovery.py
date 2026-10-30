"""Copy an immutable model cache in authenticated chunks, restore only an owned volume.
No source writers, host ports, paid provider, downloads or operational recreation.
"""
import argparse,base64,datetime,hashlib,importlib.util,json,pathlib,secrets,sys,traceback
import stack_chunked_cache as chunks
ROOT=pathlib.Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('model_online',ROOT/'scripts/stack-online-recovery.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def verify_retained(directory,key_file,expected):
 directory=directory.resolve();m.e.require(directory.parent==(ROOT/'.local').resolve())
 custody=m.c.retained_key(ROOT,key_file);key=custody[0].read_bytes();crypto=m.load('retained_cache_crypto','stack-backup-crypt.py')
 cipher=m.e.anchored_file(directory/'cache-manifest.aesgcm',expected,limit=8*1024*1024);manifest=json.loads(crypto.transform('decrypt',key,cipher));total=chunks.validate(manifest)
 m.e.require(m.e.re.fullmatch('[a-f0-9]{40}',manifest['candidateRevision']) and m.e.re.fullmatch('sha256:[a-f0-9]{64}',manifest['sourceImageId']))
 m.e.require(m.e.re.fullmatch('docker.io/automaster5013/agenttrust-local-model@sha256:[a-f0-9]{64}',manifest['candidateReference']))
 created=datetime.datetime.fromisoformat(manifest['createdAt']);m.e.require(created.tzinfo is not None and 0<=(datetime.datetime.now(datetime.timezone.utc)-created).total_seconds()<=86400)
 count=0
 for row in manifest['files'].values():
  digest=hashlib.sha256()
  for chunk in row['chunks']:
   raw=m.e.anchored_file(directory/chunk['file'],chunk['cipherSha256'],limit=chunks.CHUNK+128);m.e.require(len(raw)==chunk['cipherBytes'])
   plain=crypto.transform('decrypt',key,raw);m.e.require(len(plain)==chunk['bytes'] and hashlib.sha256(plain).hexdigest()==chunk['plainSha256']);digest.update(plain);count+=1
  m.e.require(digest.hexdigest()==row['sha256'])
 m.e.require(m.c.key_unchanged(*custody));m.e.anchored_file(directory/'cache-manifest.aesgcm',expected,limit=8*1024*1024)
 return {'completed':True,'kind':'authenticated-chunked-model-cache','files':len(manifest['files']),'bytes':total,'chunks':count,'fullStackRecoveryVerified':False,'inferenceExecutedHere':False}

def file_command(drill,volume,action,path=None,offset=0,size=0,mode=384,prefix=None,target=None):
 m.e.require(volume in (drill.source_volume,drill.target_volume) and action in ('inventory','links','link','select-blocks','select-prometheus','quarantine-block','read','write','finalize'))
 write=action in ('write','finalize','link','quarantine-block')
 if write:m.e.require(volume==drill.target_volume)
 if volume==drill.target_volume:drill.own_volume(volume)
 args=['docker','run','--rm','--log-driver','none','-i','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true',
       '--memory','192m','--cpus','1','--pids-limit','32','--user',drill.file_user,
       '--mount','type=volume,source='+volume+',target=/data'+('' if write else ',readonly'),
       '--mount','type=bind,source='+str(ROOT/'scripts/stack-file-volume-helper.py')+',target=/helper.py,readonly',drill.tools,'python','/helper.py',action]
 if path is not None:args+=['--path',path,'--offset',str(offset),'--size',str(size),'--mode',str(mode)]
 if prefix is not None:args+=['--prefix',prefix]
 if target is not None:args+=['--target',target]
 return args

def no_writers(volume,source_id):
 ids=m.c.run(['docker','ps','-q','--filter','volume='+volume]).stdout.decode().split();m.e.require(ids)
 rows=json.loads(m.c.run(['docker','inspect',*ids]).stdout)
 m.e.require(any(row['Id']==source_id for row in rows))
 for row in rows:
  m.e.require(all(not mount['RW'] for mount in row['Mounts'] if mount['Type']=='volume' and mount['Name']==volume))

def run(config_path,config_hash,retained=None):
 m.session_capacity();ids,raw,inventory,by_service=m.d.live_baseline();hashes=m.e.planner.compose_hashes(inventory,ROOT)
 _,protected=m.d.resolved_groups(inventory,by_service,list(m.e.planner.COMPONENTS))
 source=by_service['stack-ollama'];mounts=[v for v in source['Mounts'] if v['Type']=='volume']
 m.e.require(len(mounts)==1 and mounts[0]['Name']=='agenttrust_stack-ollama-models' and mounts[0]['Destination']=='/models' and not mounts[0]['RW'])
 volume=json.loads(m.c.run(['docker','volume','inspect',mounts[0]['Name']]).stdout)[0]
 m.e.require(volume['Labels']['com.docker.compose.project']=='agenttrust' and volume['Labels']['com.docker.compose.volume']=='stack-ollama-models')
 no_writers(mounts[0]['Name'],source['Id']);m.c.reserve()
 config=json.loads(m.e.anchored_file(config_path,config_hash));release=m.e.verify_candidate_release(config,config['revision'],inventory,{})
 reference=next(row['reference'] for row in release['receipt']['images'] if row['name']=='local-model');runtime=json.loads((release['directory']/'runtime-identity.json').read_bytes())['imageIds']
 m.c.run(['docker','pull',reference],timeout=600);image=json.loads(m.c.run(['docker','image','inspect',reference]).stdout)[0];m.cached_identity(image,reference,runtime['local-model'])
 drill=m.c.Rehearsal({'stack-ollama':source});drill.source_volume=mounts[0]['Name'];drill.target_volume=drill.prefix+'-models';drill.tools=json.loads(m.c.run(['docker','image','inspect','agenttrust-security:local']).stdout)[0]['Id'];drill.file_user=source['Config']['User']
 drill.report.update(kind='chunked-model-cache-recovery',actualDeploymentPerformed=False,fullStackRecoveryVerified=False,sourceServicesStopped=False,candidateRevision=config['revision'],candidateReference=reference)
 if retained:
  data_directory,key_file,expected=retained;verify_retained(data_directory,key_file,expected);custody=m.c.retained_key(ROOT,key_file);key=custody[0].read_bytes();keydir=custody[0].parent
 else:
  data_directory=drill.directory;keydir=ROOT/'.local'/('model-cache-key-'+drill.id);m.protect(keydir);key=secrets.token_bytes(32);key_file=keydir/'key.bin';m.c.private_file(key_file,key)
 drill.report['retainedKeyDirectory']=str(keydir)
 crypto=m.load('model_cache_crypto','stack-backup-crypt.py')
 def checkpoint():m.e.planner.recheck(ids,inventory,ROOT,hashes);m.e.require(m.d.hash_files(protected)==protected);m.session_capacity(512)
 try:
  drill.stage('read-only-cache-fingerprints-and-chunked-encryption')
  files=json.loads(m.c.run(file_command(drill,drill.source_volume,'inventory'),timeout=180).stdout)
  def read(name,offset,size):
   checkpoint();return m.c.run(file_command(drill,drill.source_volume,'read',name,offset,size),timeout=120).stdout
  if retained:
   encoded=m.e.anchored_file(data_directory/'cache-manifest.aesgcm',expected,limit=8*1024*1024);manifest=json.loads(crypto.transform('decrypt',key,encoded));chunks.validate(manifest)
   m.e.require(manifest['candidateReference']==reference and manifest['candidateRevision']==config['revision'] and manifest['sourceImageId']==source['Image'])
   m.e.require({name:{k:v for k,v in row.items() if k!='chunks'} for name,row in manifest['files'].items()}==files)
   drill.report.update(restoredFromRetainedSnapshot=True,retainedSnapshotDirectory=str(data_directory),encryptedManifestSha256=expected)
  else:manifest=chunks.capture(files,read,lambda raw:crypto.transform('encrypt',key,raw),lambda name,cipher:m.c.private_file(drill.directory/name,cipher))
  after=json.loads(m.c.run(file_command(drill,drill.source_volume,'inventory'),timeout=180).stdout);m.e.require(after==files);no_writers(drill.source_volume,source['Id'])
  if not retained:
   manifest.update(fixtureId=drill.id,candidateRevision=config['revision'],candidateReference=reference,sourceImageId=source['Image'],createdAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
   encoded=crypto.transform('encrypt',key,json.dumps(manifest).encode());m.c.private_file(drill.directory/'cache-manifest.aesgcm',encoded);drill.report['encryptedManifestSha256']=hashlib.sha256(encoded).hexdigest()
  decoded=json.loads(crypto.transform('decrypt',key,m.e.anchored_file(data_directory/'cache-manifest.aesgcm',drill.report['encryptedManifestSha256'],limit=8*1024*1024)));chunks.validate(decoded)
  links=json.loads(m.c.run(file_command(drill,drill.source_volume,'links')).stdout)
  for alias,target in links.items():m.e.require(alias in files and target in files and files[alias]['sha256']==files[target]['sha256'])
  m.c.private_file(drill.directory/'alias-layout.aesgcm',crypto.transform('encrypt',key,json.dumps({'cacheManifestSha256':drill.report['encryptedManifestSha256'],'links':links}).encode()))
  verified=m.c.run([sys.executable,str(ROOT/'scripts/stack-model-cache-recovery.py'),'--verify-snapshot',str(data_directory),'--retained-key-file',str(key_file),'--expected-manifest-sha256',drill.report['encryptedManifestSha256']],timeout=300)
  drill.report['freshProcessChunkAuthentication']=json.loads(verified.stdout);m.e.require(drill.report['freshProcessChunkAuthentication']['completed'] is True)
  drill.stage('owned-cache-volume-restore')
  drill.volumes.append(drill.target_volume);m.c.run(['docker','volume','create','--label','agenttrust.fixture='+drill.id,drill.target_volume]);drill.own_volume(drill.target_volume)
  user=source['Config']['User'];drill.volume_command(drill.target_volume,user,['chown',user,'/data'],write=True,initialize=True)
  def read_cipher(name):
   m.e.require(name.startswith('chunk-') and name.endswith('.aesgcm'));path=data_directory/name;m.e.require(path.is_file() and not path.is_symlink() and path.stat().st_size<=chunks.CHUNK+128);return path.read_bytes()
  def write(name,offset,raw):
   checkpoint();m.c.run(file_command(drill,drill.target_volume,'write',name,offset,len(raw)),data=raw,timeout=120)
  chunks.restore(decoded,read_cipher,lambda cipher:crypto.transform('decrypt',key,cipher),write,
                 lambda name,size,mode:m.c.run(file_command(drill,drill.target_volume,'finalize',name,size,0,mode)))
  restored=json.loads(m.c.run(file_command(drill,drill.target_volume,'inventory'),timeout=180).stdout);m.e.require(restored==files)
  for alias,target in links.items():m.c.run(file_command(drill,drill.target_volume,'link',alias,target=target))
  m.e.require(json.loads(m.c.run(file_command(drill,drill.target_volume,'links')).stdout)==links)
  drill.stage('published-model-offline-startup-and-bounded-inference');checkpoint()
  name=drill.prefix+'-stack-ollama';drill.containers.append(name)
  args=['docker','run','-d','--log-driver','none','--name',name,'--label','agenttrust.fixture='+drill.id,'--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true',
        '--user',user,'--memory','1536m','--cpus','2','--pids-limit','128','--tmpfs','/tmp:size=128m,mode=1777','-e','OLLAMA_MODELS=/models','-e','OLLAMA_NO_CLOUD=true','-e','OLLAMA_NOPRUNE=true',
        '--mount','type=volume,source='+drill.target_volume+',target=/models,readonly',image['Id'],'serve']
  m.c.run(args);drill.wait(name,'stack-ollama')
  model_row=m.c.inspect(name);m.e.require(model_row['Config']['Labels'].get('agenttrust.fixture')==drill.id and model_row['HostConfig']['NetworkMode']=='none')
  probe=drill.prefix+'-offline-probe';drill.containers.append(probe)
  result=m.c.run(['docker','run','--rm','--log-driver','none','--name',probe,'--label','agenttrust.fixture='+drill.id,'--network','container:'+model_row['Id'],'--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true',
                  '--memory','192m','--cpus','1','--pids-limit','32','--mount','type=bind,source='+str(ROOT/'scripts')+',target=/scripts,readonly',drill.tools,'python','/scripts/stack-offline-model-probe.py'],timeout=140,check=False)
  proof=json.loads(result.stdout);drill.report['modelInferenceProof']=proof;m.e.require(result.returncode==0 and proof['completed'])
  row=m.c.inspect(name);m.e.require(row['Image']==image['Id'] and row['HostConfig']['NetworkMode']=='none' and not row['HostConfig']['PortBindings'])
  m.e.require(json.loads(m.c.run(file_command(drill,drill.source_volume,'inventory'),timeout=180).stdout)==files)
  checkpoint();drill.report.update(completed=True,modelCacheRecoveryVerified=True,modelFiles=len(files),modelBytes=sum(v['bytes'] for v in files.values()),encryptedChunks=sum(len(v['chunks']) for v in manifest['files'].values()),
                                  exactFileHashesAndModesRestored=True,internalAliasesRestored=len(links),publishedEntrypointChecksumsPassed=True,offlineInferenceVerified=True,modelDownloadsPerformed=False,paidProviderCallsPerformed=False)
 except Exception as error:drill.report.update(completed=False,errorType=type(error).__name__,failureLocations=[{'file':pathlib.Path(x.filename).name,'line':x.lineno} for x in traceback.extract_tb(error.__traceback__)])
 finally:
  try:checkpoint();drill.report['operationalContainersUnchanged']=True
  except Exception:drill.report.update(completed=False,operationalContainersUnchanged=False)
  drill.cleanup()
 return drill

def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--config',type=pathlib.Path);parser.add_argument('--expected-config-sha256');parser.add_argument('--execute',action='store_true')
 parser.add_argument('--verify-snapshot',type=pathlib.Path);parser.add_argument('--retained-snapshot',type=pathlib.Path);parser.add_argument('--retained-key-file',type=pathlib.Path);parser.add_argument('--expected-manifest-sha256');args=parser.parse_args()
 try:
  if args.verify_snapshot:
   m.e.require(not args.execute and not args.config and pathlib.Path.cwd().resolve()==ROOT);print(json.dumps(verify_retained(args.verify_snapshot,args.retained_key_file,args.expected_manifest_sha256)));return 0
  m.e.require(pathlib.Path.cwd().resolve()==ROOT and args.execute);retained=(args.retained_snapshot,args.retained_key_file,args.expected_manifest_sha256) if args.retained_snapshot else None;drill=run(args.config,args.expected_config_sha256,retained)
  print(json.dumps({'completed':drill.report['completed'],'reportPath':str(drill.directory/'summary.json'),'fullStackRecoveryVerified':False,'actualDeploymentPerformed':False}));return 0 if drill.report['completed'] else 1
 except Exception as error:print(json.dumps({'completed':False,'code':'MODEL_CACHE_RECOVERY_REFUSED','errorType':type(error).__name__}));return 1
if __name__=='__main__':sys.exit(main())
