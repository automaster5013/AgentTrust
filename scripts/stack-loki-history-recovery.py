"""Restore unchanged Loki file observations in isolation, not an atomic live backup."""
import argparse,datetime,hashlib,importlib.util,json,pathlib,secrets,sys,time,traceback,urllib.parse
import stack_chunked_cache as chunks
from stack_local_cd_executor import normalized_host_path
ROOT=pathlib.Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('loki_cache','%s/scripts/stack-model-cache-recovery.py'%ROOT);cache=importlib.util.module_from_spec(spec);spec.loader.exec_module(cache);m=cache.m

def log_fingerprint(frame):
 m.e.require(frame['status']=='success' and frame['data']['resultType']=='streams' and frame['data']['result'] and not frame.get('warnings'))
 result=frame['data']['result'];m.e.require(len(result)<=100 and all(len(v['values'])>=1 for v in result))
 encoded=json.dumps(sorted(result,key=lambda v:json.dumps(v['stream'],sort_keys=True)),sort_keys=True,separators=(',',':')).encode()
 return hashlib.sha256(encoded).hexdigest(),sum(len(v['values']) for v in result)

def get(name,start,end):
 m.e.require(name=='agenttrust-stack-loki-1' or m.e.re.fullmatch('agenttrust-stack-coldrestore-[a-f0-9-]{36}-stack-loki',name))
 m.e.require(type(start) is int and type(end) is int and 0<start<end<time.time() and end-start<=7*86400)
 row=m.c.inspect(name)
 if name!='agenttrust-stack-loki-1':m.e.require(row['HostConfig']['NetworkMode']=='none' and row['Config']['Labels'].get('agenttrust.fixture')==name.removeprefix('agenttrust-stack-coldrestore-').removesuffix('-stack-loki'))
 else:m.e.require(row['Config']['Labels'].get('com.docker.compose.project')=='agenttrust' and row['Config']['Labels'].get('com.docker.compose.service')=='stack-loki')
 result=m.c.run(['docker','run','--rm','--log-driver','none','--network','container:'+row['Id'],'--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','192m','--pids-limit','32','--mount','type=bind,source='+str(ROOT/'scripts/stack-logs-read-probe.py')+',target=/probe.py,readonly','agenttrust-security:local','python','/probe.py',str(start),str(end)],timeout=20)
 m.e.require(0<len(result.stdout)<=2097152);return json.loads(result.stdout)

def run(config_path,config_hash):
 m.session_capacity();ids,raw,inventory,by_service=m.d.live_baseline();hashes=m.e.planner.compose_hashes(inventory,ROOT)
 _,protected=m.d.resolved_groups(inventory,by_service,list(m.e.planner.COMPONENTS));source=by_service['stack-loki']
 mounts=[v for v in source['Mounts'] if v['Type']=='volume'];m.e.require(len(mounts)==1 and mounts[0]['Name']=='agenttrust_stack-loki-data')
 volume=json.loads(m.c.run(['docker','volume','inspect',mounts[0]['Name']]).stdout)[0];m.e.require(volume['Labels']['com.docker.compose.project']=='agenttrust' and volume['Labels']['com.docker.compose.volume']=='stack-loki-data');m.c.reserve()
 config=json.loads(m.e.anchored_file(config_path,config_hash));release=m.e.verify_candidate_release(config,config['revision'],inventory,{})
 reference=next(row['reference'] for row in release['receipt']['images'] if row['name']=='loki');runtime=json.loads((release['directory']/'runtime-identity.json').read_bytes())['imageIds']
 m.c.run(['docker','pull',reference],timeout=600);image=json.loads(m.c.run(['docker','image','inspect',reference]).stdout)[0];m.cached_identity(image,reference,runtime['loki'])
 drill=m.c.Rehearsal({'stack-loki':source});drill.source_volume=mounts[0]['Name'];drill.target_volume=drill.prefix+'-loki';drill.file_user=source['Config']['User'];drill.tools=json.loads(m.c.run(['docker','image','inspect','agenttrust-security:local']).stdout)[0]['Id']
 drill.report.update(kind='stable-loki-file-observation-recovery',actualDeploymentPerformed=False,fullStackRecoveryVerified=False,sourceServicesStopped=False,fullLokiHistoryRecovered=False,activeWalRecovered=False,currentHeadRecovered=False,candidateRevision=config['revision'],candidateReference=reference)
 keydir=ROOT/'.local'/('loki-block-key-'+drill.id);m.protect(keydir);key=secrets.token_bytes(32);m.c.private_file(keydir/'key.bin',key);drill.report['retainedKeyDirectory']=str(keydir);crypto=m.load('loki_block_crypto','stack-backup-crypt.py')
 def checkpoint():m.e.planner.recheck(ids,inventory,ROOT,hashes);m.e.require(m.d.hash_files(protected)==protected);m.session_capacity(512)
 try:
  drill.stage('capture-source-files-with-before-after-drift-checks')
  end=int(time.time())-900;start=end-7*86400;before=log_fingerprint(get('agenttrust-stack-loki-1',start,end));files=json.loads(m.c.run(cache.file_command(drill,drill.source_volume,'inventory'),timeout=120).stdout)
  m.e.require(sum(row['bytes'] for row in files.values())<=chunks.LIMIT)
  def read(name,offset,size):checkpoint();return m.c.run(cache.file_command(drill,drill.source_volume,'read',name,offset,size),timeout=120).stdout
  manifest=chunks.capture(files,read,lambda raw:crypto.transform('encrypt',key,raw),lambda name,cipher:m.c.private_file(drill.directory/name,cipher))
  manifest.update(kind='bounded-file-cache',component='loki-stable-file-observation',queryWindow={'start':start,'end':end,'source':before},candidateRevision=config['revision'],candidateReference=reference,sourceImageId=source['Image'])
  cipher=crypto.transform('encrypt',key,json.dumps(manifest).encode());m.c.private_file(drill.directory/'blocks-manifest.aesgcm',cipher);drill.report['encryptedManifestSha256']=hashlib.sha256(cipher).hexdigest()
  decoded=json.loads(crypto.transform('decrypt',key,m.e.anchored_file(drill.directory/'blocks-manifest.aesgcm',drill.report['encryptedManifestSha256'],limit=8*1024*1024)));chunks.validate(decoded)
  drill.stage('restore-observed-files-only')
  drill.volumes.append(drill.target_volume);m.c.run(['docker','volume','create','--label','agenttrust.fixture='+drill.id,drill.target_volume]);drill.own_volume(drill.target_volume)
  drill.volume_command(drill.target_volume,drill.file_user,['chown',drill.file_user,'/data'],write=True,initialize=True)
  def read_cipher(name):
   chunk=next(c for row in decoded['files'].values() for c in row['chunks'] if c['file']==name)
   return m.e.anchored_file(drill.directory/name,chunk['cipherSha256'],limit=chunks.CHUNK+128)
  chunks.restore(decoded,read_cipher,lambda raw:crypto.transform('decrypt',key,raw),
                 lambda name,offset,raw:m.c.run(cache.file_command(drill,drill.target_volume,'write',name,offset,len(raw)),data=raw),
                 lambda name,size,mode:m.c.run(cache.file_command(drill,drill.target_volume,'finalize',name,size,0,mode)))
  m.e.require(json.loads(m.c.run(cache.file_command(drill,drill.target_volume,'inventory')).stdout)==files)
  m.e.require(json.loads(m.c.run(cache.file_command(drill,drill.source_volume,'inventory')).stdout)==files)
  checkpoint();drill.stage('published-loki-query-of-restored-history');settings=next(v for v in source['Mounts'] if v['Type']=='bind' and v['Destination']=='/etc/loki.yaml')
  source_path=pathlib.Path(normalized_host_path(settings['Source']));m.e.require(source_path.is_file() and source_path.resolve().is_relative_to(ROOT))
  path=drill.directory/'loki.yaml';m.c.private_file(path,source_path.read_bytes());path.chmod(0o444);drill.private.append(path)
  name=drill.prefix+'-stack-loki';drill.containers.append(name)
  m.c.run(['docker','run','-d','--name',name,'--log-driver','none','--label','agenttrust.fixture='+drill.id,'--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true',
           '--user',drill.file_user,'--memory','512m','--cpus','1','--pids-limit','128','--tmpfs','/tmp:size=32m,mode=1777',
           '--mount','type=volume,source='+drill.target_volume+',target=/var/loki','--mount','type=bind,source='+str(path)+',target=/etc/loki.yaml,readonly',image['Id'],*source['Config']['Cmd']])
  drill.wait(name,'stack-loki');restored=log_fingerprint(get(name,start,end));after=log_fingerprint(get('agenttrust-stack-loki-1',start,end));m.e.require(restored==after==before)
  m.e.require(json.loads(m.c.run(cache.file_command(drill,drill.source_volume,'inventory')).stdout)==files);checkpoint()
  drill.report.update(completed=True,boundedLokiHistoryRecoveryVerified=True,restoredFiles=len(files),selectedBytes=sum(v['bytes'] for v in files.values()),matchingLogEntries=restored[1],sourceFilesUnchanged=True,queryLimit=100,allLokiHistoryCompared=False,stableObservationOnly=True)

 except Exception as error:drill.report.update(completed=False,errorType=type(error).__name__,failureLocations=[{'file':pathlib.Path(x.filename).name,'line':x.lineno} for x in traceback.extract_tb(error.__traceback__)])
 finally:
  try:checkpoint();drill.report['operationalContainersUnchanged']=True
  except Exception:drill.report.update(completed=False,operationalContainersUnchanged=False)
  drill.cleanup()
 return drill

def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--config',type=pathlib.Path,required=True);parser.add_argument('--expected-config-sha256',required=True);parser.add_argument('--execute',action='store_true');args=parser.parse_args()
 try:
  m.e.require(pathlib.Path.cwd().resolve()==ROOT and args.execute);drill=run(args.config,args.expected_config_sha256)
  print(json.dumps({'completed':drill.report['completed'],'reportPath':str(drill.directory/'summary.json'),'fullLokiHistoryRecovered':False,'actualDeploymentPerformed':False}));return 0 if drill.report['completed'] else 1
 except Exception as error:print(json.dumps({'completed':False,'code':'LOKI_HISTORY_RECOVERY_REFUSED','errorType':type(error).__name__,'httpStatusCode':getattr(error,'code',None),'failureLocations':[{'file':pathlib.Path(x.filename).name,'line':x.lineno} for x in traceback.extract_tb(error.__traceback__)]}));return 1
if __name__=='__main__':sys.exit(main())
