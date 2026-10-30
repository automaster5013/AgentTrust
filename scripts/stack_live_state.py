"""Bounded read-only live copies; equality checks do not establish an atomic snapshot."""
import io,json,pathlib,re,subprocess,tarfile,time
from stack_backup_tools import volume_stream
from stack_coherent_archive import archive_fingerprints,COMPRESSED_LIMIT
ROOT=pathlib.Path(__file__).resolve().parent.parent
VOLUMES={'stack-object-store':'stack-object-data','stack-nats':'stack-nats-data','stack-redis':'stack-redis-data'}

def require(value):
 if not value:raise ValueError('Live state contract refused')

def command(args,data=None):
 result=subprocess.run(args,cwd=ROOT,input=data,capture_output=True,timeout=120);require(result.returncode==0);return result.stdout

def queue_state(name):
 require(name=='agenttrust-stack-nats-1' or re.fullmatch('agenttrust-stack-coldrestore-[a-f0-9-]{36}-stack-nats',name))
 frame=json.loads(command(['docker','exec',name,'wget','-q','-O','-','http://127.0.0.1:8222/jsz?streams=true&consumers=true&config=true']))
 streams=[]
 for account in frame.get('account_details',[]):
  for row in account.get('stream_detail',[]):
   consumers=[{k:c[k] for k in ('stream_name','name','created','config','num_ack_pending','num_redelivered','num_pending')}|
              {k:{s:c[k][s] for s in ('consumer_seq','stream_seq')} for k in ('delivered','ack_floor')} for c in row.get('consumer_detail',[])]
   streams.append({k:row[k] for k in ('name','created','config','state')}|{'consumers':sorted(consumers,key=lambda c:c['name'])})
 require(0<len(streams)<=16);return sorted(streams,key=lambda s:s['name'])

def source_archive(source,service):
 require(service in VOLUMES and source['Config']['Labels']['com.docker.compose.project']=='agenttrust' and source['Config']['Labels']['com.docker.compose.service']==service)
 mounts=[v for v in source['Mounts'] if v['Type']=='volume'];name='agenttrust_'+VOLUMES[service]
 require(len(mounts)==1 and mounts[0]['Name']==name)
 volume=json.loads(command(['docker','volume','inspect',name]))[0]
 require(volume['Labels']['com.docker.compose.project']=='agenttrust' and volume['Labels']['com.docker.compose.volume']==VOLUMES[service])
 size=volume_stream(ROOT,name,['du','-sk','/data'],user=source['Config']['User']).split()[0]
 require(size.isdigit() and int(size)<=65536)
 raw=volume_stream(ROOT,name,['tar','-C','/data','-czf','-','.'],user=source['Config']['User'])
 require(0<len(raw)<=COMPRESSED_LIMIT);archive_fingerprints(raw);return raw

def aof_keys(raw):
 archive_fingerprints(raw)
 keys=set();total=0
 with tarfile.open(fileobj=io.BytesIO(raw),mode='r:gz') as archive:
  for member in archive:
   if not member.isfile() or not member.name.endswith('.incr.aof'):continue
   stream=archive.extractfile(member)
   while line:=stream.readline(65):
    require(line.startswith(b'*') and line.endswith(b'\r\n') and line[1:-2].isdigit());count=int(line[1:-2]);require(1<=count<=64)
    args=[]
    for _ in range(count):
     header=stream.readline(65);require(header.startswith(b'$') and header.endswith(b'\r\n') and header[1:-2].isdigit());size=int(header[1:-2]);require(size<=4096)
     value=stream.read(size);require(len(value)==size and stream.read(2)==b'\r\n');args.append(value);total+=size;require(total<=64*1024*1024)
    operation=args[0].upper();require(operation in (b'SELECT',b'MULTI',b'EXEC',b'INCR',b'EXPIREAT',b'PEXPIREAT',b'DEL'))
    if operation in (b'INCR',b'EXPIREAT',b'PEXPIREAT',b'DEL'):
     for key in args[1:] if operation==b'DEL' else args[1:2]:
      require(re.fullmatch(b'stack:quota:[A-Za-z0-9:._-]{1,240}',key));keys.add(key.decode('ascii'));require(len(keys)<=4096)
 return sorted(keys)

def redis_values(name,keys):
 require(name=='agenttrust-stack-redis-1' or re.fullmatch('agenttrust-stack-coldrestore-[a-f0-9-]{36}-stack-redis',name))
 require(len(keys)<=4096 and all(re.fullmatch('stack:quota:[A-Za-z0-9:._-]{1,240}',key) for key in keys))
 script="local r={} for _,k in ipairs(ARGV) do table.insert(r,{k,redis.call('GET',k) or false,redis.call('TTL',k)}) end return r"
 # Fixed shell reads the existing restricted token in-container; all data is argv, never shell text.
 raw=command(['docker','exec',name,'sh','-c','REDISCLI_AUTH="$(cat /run/secrets/stack-redis-token)" redis-cli --user stack-gateway --json "$@"','readonly','EVAL',script,'0',*keys])
 values=json.loads(raw);require(isinstance(values,list) and len(values)==len(keys));return values

def seed_fixture_quota(drill):
 name=drill.prefix+'-stack-redis';require(name=='agenttrust-stack-coldrestore-'+drill.id+'-stack-redis')
 row=json.loads(command(['docker','inspect',name]))[0];require(row['Config']['Labels'].get('agenttrust.fixture')==drill.id)
 key='stack:quota:restore-probe:'+drill.id
 script="redis.call('INCR',ARGV[1]);redis.call('INCR',ARGV[1]);local n=redis.call('INCR',ARGV[1]);redis.call('EXPIRE',ARGV[1],15);return n"
 raw=command(['docker','exec',name,'sh','-c','REDISCLI_AUTH="$(cat /run/secrets/stack-redis-token)" redis-cli --user stack-gateway --json "$@"','fixture','EVAL',script,'0',key])
 require(json.loads(raw)==3);return key

def reference_rows(sql):
 statement="BEGIN READ ONLY; SET LOCAL statement_timeout='5s'; SELECT coalesce(json_agg(x),'[]'::json) FROM (SELECT object_key,version_id,content_sha256,content_bytes FROM stack_evidence_archives UNION ALL SELECT object_key,version_id,content_sha256,content_bytes FROM stack_campaign_archives) x; COMMIT;"
 output=sql(statement);require(len(output)<=4194304 and output.startswith('BEGIN\nSET\n') and output.endswith('\nCOMMIT'))
 references=json.loads(output[len('BEGIN\nSET\n'):-len('\nCOMMIT')]);require(0<len(references)<=4096)
 return references

def capture(sources,sql):
 before=queue_state('agenttrust-stack-nats-1');payload={};fingerprints={}
 for service in VOLUMES:
  raw=source_archive(sources[service],service);fingerprints[service]=archive_fingerprints(raw)
  require(archive_fingerprints(source_archive(sources[service],service))==fingerprints[service]);payload[service+'-live']=raw
 require(queue_state('agenttrust-stack-nats-1')==before)
 references=reference_rows(sql)
 keys=aof_keys(payload['stack-redis-live']);values=redis_values('agenttrust-stack-redis-1',keys)
 metadata={'schemaVersion':1,'queue':before,'objectReferences':references,'redisKeys':keys,'redisValues':values,'capturedAtEpoch':time.time(),'fileFingerprints':fingerprints,
           'allRedisMemoryKeysEnumerated':False,'crossStoreSnapshotAtomic':False}
 payload['liveStateMetadata']=json.dumps(metadata).encode();return payload

def prepare_volumes(drill,payload):
 metadata=json.loads(payload['liveStateMetadata']);require(metadata['schemaVersion']==1 and metadata['crossStoreSnapshotAtomic'] is False)
 volumes={}
 for service in VOLUMES:
  raw=payload[service+'-live'];expected=archive_fingerprints(raw);require(expected==metadata['fileFingerprints'][service])
  name=drill.prefix+'-'+service+'-live';drill.volumes.append(name)
  command(['docker','volume','create','--label','agenttrust.fixture='+drill.id,name]);drill.own_volume(name)
  user=drill.sources[service]['Config']['User'];drill.volume_command(name,user,['chown',user,'/data'],write=True,initialize=True)
  drill.volume_command(name,user,['tar','-C','/data','-xzopf','-'],data=raw,write=True)
  require(archive_fingerprints(drill.volume_command(name,user,['tar','-C','/data','-czf','-','.']))==expected);volumes[service]=name
 return volumes

def verify_redis(drill,metadata):
 values=redis_values(drill.prefix+'-stack-redis',metadata['redisKeys']);elapsed=time.time()-metadata['capturedAtEpoch'];active=0
 for source,target in zip(metadata['redisValues'],values):
  require(source[0]==target[0]);ttl=source[2]
  if source[1] is None or source[1] is False or ttl<0 or ttl<=elapsed+2:require(target[1] is None or target[1] is False)
  else:require(source[1]==target[1] and abs(target[2]-(ttl-elapsed))<=3);active+=1
 return {'capturedQuotaKeys':len(values),'capturedLiveQuotaValues':sum(v[1] is not None and v[1] is not False for v in metadata['redisValues']),
         'stillLiveQuotaValuesVerified':active,'expiredQuotaKeysNotResurrected':True,'allRedisMemoryKeysEnumerated':False}
