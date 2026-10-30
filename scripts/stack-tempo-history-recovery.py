"""Restore a bounded selection of closed Tempo blocks, not live WAL/full history."""
import argparse,datetime,hashlib,importlib.util,json,pathlib,secrets,sys,time,traceback,urllib.parse
import stack_chunked_cache as chunks
from stack_local_cd_executor import normalized_host_path
ROOT=pathlib.Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('tempo_cache','%s/scripts/stack-model-cache-recovery.py'%ROOT);cache=importlib.util.module_from_spec(spec);spec.loader.exec_module(cache);m=cache.m

def trace_fingerprint(frame):
 spans=[]
 for batch in frame.get('batches',frame.get('resourceSpans',[])):
  resource=sorted(batch.get('resource',{}).get('attributes',[]),key=lambda row:row['key'])
  for scope in batch.get('scopeSpans',batch.get('instrumentationLibrarySpans',[])):
   for raw in scope.get('spans',[]):
    span=dict(raw);span['attributes']=sorted(span.get('attributes',[]),key=lambda row:row['key'])
    spans.append({'resource':resource,'span':span})
 m.e.require(spans);encoded=json.dumps(sorted(spans,key=lambda row:json.dumps(row,sort_keys=True)),sort_keys=True,separators=(',',':')).encode()
 return hashlib.sha256(encoded).hexdigest(),len(spans)

def trace_id(value):
 m.e.require(isinstance(value,str) and m.e.re.fullmatch('[a-fA-F0-9]{1,32}',value));return value.lower().zfill(32)

def get(name,path):
 m.e.require(name=='agenttrust-stack-tempo-1' or m.e.re.fullmatch('agenttrust-stack-coldrestore-[a-f0-9-]{36}-stack-tempo',name))
 m.e.require(path.startswith('/api/search?') or m.e.re.fullmatch('/api/traces/[a-f0-9]{32}',path))
 row=m.c.inspect(name)
 if name!='agenttrust-stack-tempo-1':m.e.require(row['HostConfig']['NetworkMode']=='none' and row['Config']['Labels'].get('agenttrust.fixture')==name.removeprefix('agenttrust-stack-coldrestore-').removesuffix('-stack-tempo'))
 else:m.e.require(row['Config']['Labels'].get('com.docker.compose.project')=='agenttrust' and row['Config']['Labels'].get('com.docker.compose.service')=='stack-tempo')
 result=m.c.run(['docker','run','--rm','--log-driver','none','--network','container:'+row['Id'],'--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','192m','--pids-limit','32','--mount','type=bind,source='+str(ROOT/'scripts/stack-tempo-read-probe.py')+',target=/probe.py,readonly','agenttrust-security:local','python','/probe.py',path],timeout=20)
 m.e.require(0<len(result.stdout)<=2097152);return json.loads(result.stdout)

def run(config_path,config_hash):
 m.session_capacity();ids,raw,inventory,by_service=m.d.live_baseline();hashes=m.e.planner.compose_hashes(inventory,ROOT)
 _,protected=m.d.resolved_groups(inventory,by_service,list(m.e.planner.COMPONENTS));source=by_service['stack-tempo']
 mounts=[v for v in source['Mounts'] if v['Type']=='volume'];m.e.require(len(mounts)==1 and mounts[0]['Name']=='agenttrust_stack-tempo-data')
 volume=json.loads(m.c.run(['docker','volume','inspect',mounts[0]['Name']]).stdout)[0];m.e.require(volume['Labels']['com.docker.compose.project']=='agenttrust' and volume['Labels']['com.docker.compose.volume']=='stack-tempo-data');m.c.reserve()
 config=json.loads(m.e.anchored_file(config_path,config_hash));release=m.e.verify_candidate_release(config,config['revision'],inventory,{})
 reference=next(row['reference'] for row in release['receipt']['images'] if row['name']=='tempo');runtime=json.loads((release['directory']/'runtime-identity.json').read_bytes())['imageIds']
 m.c.run(['docker','pull',reference],timeout=600);image=json.loads(m.c.run(['docker','image','inspect',reference]).stdout)[0];m.cached_identity(image,reference,runtime['tempo'])
 drill=m.c.Rehearsal({'stack-tempo':source});drill.source_volume=mounts[0]['Name'];drill.target_volume=drill.prefix+'-tempo';drill.file_user=source['Config']['User'];drill.tools=json.loads(m.c.run(['docker','image','inspect','agenttrust-security:local']).stdout)[0]['Id']
 drill.report.update(kind='selected-closed-tempo-block-recovery',actualDeploymentPerformed=False,fullStackRecoveryVerified=False,sourceServicesStopped=False,fullTempoHistoryRecovered=False,activeWalRecovered=False,candidateRevision=config['revision'],candidateReference=reference)
 keydir=ROOT/'.local'/('tempo-block-key-'+drill.id);m.protect(keydir);key=secrets.token_bytes(32);m.c.private_file(keydir/'key.bin',key);drill.report['retainedKeyDirectory']=str(keydir);crypto=m.load('tempo_block_crypto','stack-backup-crypt.py')
 def checkpoint():m.e.planner.recheck(ids,inventory,ROOT,hashes);m.e.require(m.d.hash_files(protected)==protected);m.session_capacity(512)
 try:
  drill.stage('select-closed-blocks-without-reading-live-wal')
  selected=json.loads(m.c.run(cache.file_command(drill,drill.source_volume,'select-blocks'),timeout=120).stdout);files={}
  for block in selected:
   current=json.loads(m.c.run(cache.file_command(drill,drill.source_volume,'inventory',prefix=block['prefix']),timeout=120).stdout);m.e.require(not set(current)&set(files));files.update(current)
  m.e.require(sum(row['bytes'] for row in files.values())<=chunks.LIMIT)
  def read(name,offset,size):checkpoint();return m.c.run(cache.file_command(drill,drill.source_volume,'read',name,offset,size),timeout=120).stdout
  manifest=chunks.capture(files,read,lambda raw:crypto.transform('encrypt',key,raw),lambda name,cipher:m.c.private_file(drill.directory/name,cipher))
  manifest.update(kind='bounded-file-cache',component='tempo-closed-block-selection',selected=selected,candidateRevision=config['revision'],candidateReference=reference,sourceImageId=source['Image'])
  cipher=crypto.transform('encrypt',key,json.dumps(manifest).encode());m.c.private_file(drill.directory/'blocks-manifest.aesgcm',cipher);drill.report['encryptedManifestSha256']=hashlib.sha256(cipher).hexdigest()
  decoded=json.loads(crypto.transform('decrypt',key,m.e.anchored_file(drill.directory/'blocks-manifest.aesgcm',drill.report['encryptedManifestSha256'],limit=8*1024*1024)));chunks.validate(decoded)
  drill.stage('restore-selected-closed-blocks-only')
  drill.volumes.append(drill.target_volume);m.c.run(['docker','volume','create','--label','agenttrust.fixture='+drill.id,drill.target_volume]);drill.own_volume(drill.target_volume)
  drill.volume_command(drill.target_volume,drill.file_user,['chown',drill.file_user,'/data'],write=True,initialize=True)
  def read_cipher(name):
   chunk=next(c for row in decoded['files'].values() for c in row['chunks'] if c['file']==name)
   return m.e.anchored_file(drill.directory/name,chunk['cipherSha256'],limit=chunks.CHUNK+128)
  chunks.restore(decoded,read_cipher,lambda raw:crypto.transform('decrypt',key,raw),
                 lambda name,offset,raw:m.c.run(cache.file_command(drill,drill.target_volume,'write',name,offset,len(raw)),data=raw),
                 lambda name,size,mode:m.c.run(cache.file_command(drill,drill.target_volume,'finalize',name,size,0,mode)))
  m.e.require(json.loads(m.c.run(cache.file_command(drill,drill.target_volume,'inventory')).stdout)==files)
  for block in selected:m.e.require(json.loads(m.c.run(cache.file_command(drill,drill.source_volume,'inventory',prefix=block['prefix'])).stdout)=={p:v for p,v in files.items() if p.startswith(block['prefix']+'/')})
  checkpoint();drill.stage('published-tempo-query-of-restored-history');settings=next(v for v in source['Mounts'] if v['Type']=='bind' and v['Destination']=='/etc/tempo.yaml')
  source_path=pathlib.Path(normalized_host_path(settings['Source']));m.e.require(source_path.is_file() and source_path.resolve().is_relative_to(ROOT))
  path=drill.directory/'tempo.yaml';m.c.private_file(path,source_path.read_bytes());path.chmod(0o444);drill.private.append(path)
  name=drill.prefix+'-stack-tempo';drill.containers.append(name)
  m.c.run(['docker','run','-d','--name',name,'--log-driver','none','--label','agenttrust.fixture='+drill.id,'--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true',
           '--user',drill.file_user,'--memory','512m','--cpus','1','--pids-limit','128','--tmpfs','/tmp:size=32m,mode=1777',
           '--mount','type=volume,source='+drill.target_volume+',target=/var/tempo','--mount','type=bind,source='+str(path)+',target=/etc/tempo.yaml,readonly',image['Id'],'-config.file=/etc/tempo.yaml','-target=all'])
  drill.wait(name,'stack-tempo');query=urllib.parse.urlencode({'start':min(b['start'] for b in selected)-1,'end':max(b['end'] for b in selected)+1,'limit':20});search=get(name,'/api/search?'+query);until=time.monotonic()+90
  while not search.get('traces') and time.monotonic()<until:checkpoint();time.sleep(2);search=get(name,'/api/search?'+query)
  drill.report.update(searchResults=len(search.get('traces',[])),traceIdLengths=sorted({len(v['traceID']) for v in search.get('traces',[])}),selectedClosedBlocks=len(selected),restoredFiles=len(files),restoredFileHashesAndModesVerified=True);matches=[]
  for row in search.get('traces',[]):
   trace=trace_id(row['traceID']);restored=trace_fingerprint(get(name,'/api/traces/'+trace));original=trace_fingerprint(get('agenttrust-stack-tempo-1','/api/traces/'+trace))
   if restored==original:matches.append({'sha256':restored[0],'spans':restored[1]})
  m.e.require(matches);checkpoint();drill.report.update(completed=True,selectedTempoHistoryRecoveryVerified=True,selectedClosedBlocks=len(selected),restoredFiles=len(files),selectedBytes=sum(v['bytes'] for v in files.values()),matchingHistoricalTraces=len(matches),matchingSpans=sum(v['spans'] for v in matches),sourceSelectedFilesUnchanged=True)
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
  print(json.dumps({'completed':drill.report['completed'],'reportPath':str(drill.directory/'summary.json'),'fullTempoHistoryRecovered':False,'actualDeploymentPerformed':False}));return 0 if drill.report['completed'] else 1
 except Exception as error:print(json.dumps({'completed':False,'code':'TEMPO_HISTORY_RECOVERY_REFUSED','errorType':type(error).__name__,'failureLocations':[{'file':pathlib.Path(x.filename).name,'line':x.lineno} for x in traceback.extract_tb(error.__traceback__)]}));return 1
if __name__=='__main__':sys.exit(main())
