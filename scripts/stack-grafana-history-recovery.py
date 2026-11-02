"""Online SQLite backup -> isolated pinned Grafana metadata restore; no source stop."""
import argparse,base64,datetime,hashlib,importlib.util,json,pathlib,secrets,sys,traceback
from stack_local_cd_executor import normalized_host_path
ROOT=pathlib.Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('grafana_cache',ROOT/'scripts/stack-model-cache-recovery.py');cache=importlib.util.module_from_spec(spec);spec.loader.exec_module(cache);m=cache.m

def run():
 m.session_capacity();ids,raw,inventory,by_service=m.d.live_baseline();hashes=m.e.planner.compose_hashes(inventory,ROOT)
 _,protected=m.d.resolved_groups(inventory,by_service,list(m.e.planner.COMPONENTS));source=by_service['stack-grafana'];user=source['Config']['User']
 volumes=[v for v in source['Mounts'] if v['Type']=='volume'];m.e.require(len(volumes)==1 and volumes[0]['Name']=='agenttrust_stack-grafana-data')
 volume=json.loads(m.c.run(['docker','volume','inspect',volumes[0]['Name']]).stdout)[0];m.e.require(volume['Labels']['com.docker.compose.project']=='agenttrust' and volume['Labels']['com.docker.compose.volume']=='stack-grafana-data')
 binds=[]
 for mount in source['Mounts']:
  if mount['Type']=='bind':
   path=pathlib.Path(normalized_host_path(mount['Source']));m.e.require(not mount['RW'] and path.is_file() and path.resolve().is_relative_to(ROOT));binds.append((mount['Destination'],path,path.read_bytes()))
 m.e.require(all('\n' not in value and '\r' not in value for value in source['Config']['Env']))
 drill=m.c.Rehearsal({'stack-grafana':source});drill.source_volume=volumes[0]['Name'];drill.target_volume=drill.prefix+'-grafana';drill.file_user=user;drill.tools=json.loads(m.c.run(['docker','image','inspect','agenttrust-security:local']).stdout)[0]['Id']
 drill.report.update(kind='grafana-online-sqlite-recovery',actualDeploymentPerformed=False,fullStackRecoveryVerified=False,sourceServicesStopped=False,preservedSourceGrafanaImageUsed=True)
 keydir=ROOT/'.local'/('grafana-history-key-'+drill.id);m.protect(keydir);key=secrets.token_bytes(32);m.c.private_file(keydir/'key.bin',key);drill.report['retainedKeyDirectory']=str(keydir);crypto=m.load('grafana_history_crypto','stack-backup-crypt.py')
 def checkpoint():
  m.e.planner.recheck(ids,inventory,ROOT,hashes);m.e.require(m.d.hash_files(protected)==protected and all(path.read_bytes()==data for _,path,data in binds));m.session_capacity(512)
 def verify_sqlite(raw):
  args=['docker','run','--rm','--log-driver','none','-i','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','192m','--pids-limit','32',
        '--mount','type=bind,source='+str(ROOT/'scripts/stack-file-volume-helper.py')+',target=/helper.py,readonly',drill.tools,'python','/helper.py','sqlite-verify']
  return json.loads(m.c.run(args,data=raw).stdout)
 try:
  drill.stage('source-read-only-sqlite-online-backup')
  args=['docker','run','--rm','--log-driver','none','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','192m','--cpus','1','--pids-limit','32','--user',user,
        '--mount','type=volume,source='+drill.source_volume+',target=/data,readonly','--mount','type=bind,source='+str(ROOT/'scripts/stack-file-volume-helper.py')+',target=/helper.py,readonly',drill.tools,'python','/helper.py','sqlite-snapshot']
  snapshot=m.c.run(args,timeout=120).stdout;m.e.require(0<len(snapshot)<=32*1024*1024);expected=verify_sqlite(snapshot);m.e.require(expected['completed'])
  password=m.c.run(cache.file_command(drill,drill.source_volume,'read','.admin-password',0,64)).stdout;m.e.require(m.e.re.fullmatch(b'[a-f0-9]{64}',password))
  body=json.dumps({'database':base64.b64encode(snapshot).decode(),'password':base64.b64encode(password).decode(),'sourceImageId':source['Image'],'metadata':expected}).encode();cipher=crypto.transform('encrypt',key,body);m.c.private_file(drill.directory/'grafana-snapshot.aesgcm',cipher)
  drill.report['encryptedSnapshotSha256']=hashlib.sha256(cipher).hexdigest();decoded=json.loads(crypto.transform('decrypt',key,m.e.anchored_file(drill.directory/'grafana-snapshot.aesgcm',drill.report['encryptedSnapshotSha256'],limit=48*1024*1024)))
  restored=base64.b64decode(decoded['database'],validate=True);m.e.require(verify_sqlite(restored)==expected)
  drill.stage('owned-pinned-grafana-startup-and-authenticated-metadata-read')
  drill.volumes.append(drill.target_volume);m.c.run(['docker','volume','create','--label','agenttrust.fixture='+drill.id,drill.target_volume]);drill.own_volume(drill.target_volume);drill.volume_command(drill.target_volume,user,['chown',user,'/data'],write=True,initialize=True)
  for filename,data in [('grafana.db',restored),('.admin-password',base64.b64decode(decoded['password'],validate=True))]:
   offset=0
   while offset<len(data):
    part=data[offset:offset+16*1024*1024];m.c.run(cache.file_command(drill,drill.target_volume,'write',filename,offset,len(part)),data=part);offset+=len(part)
   m.c.run(cache.file_command(drill,drill.target_volume,'finalize',filename,len(data),0,0o600))
  checkpoint();env=drill.directory/'grafana.env';m.c.private_file(env,('\n'.join(source['Config']['Env'])+'\n').encode());drill.private.append(env)
  m.c.run(['docker','network','create','--internal','--label','agenttrust.fixture='+drill.id,drill.prefix]);drill.network=True
  name=drill.prefix+'-stack-grafana';drill.containers.append(name)
  args=['docker','run','-d','--name',name,'--log-driver','none','--label','agenttrust.fixture='+drill.id,'--network',drill.prefix,'--network-alias','stack-grafana','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true',
        '--user',user,'--memory','512m','--cpus','1','--pids-limit','512','--tmpfs','/tmp:size=32m,mode=1777','--env-file',str(env),'--mount','type=volume,source='+drill.target_volume+',target=/var/lib/grafana']
  for i,(destination,path,data) in enumerate(binds):
   copy=drill.directory/('grafana-config-'+str(i));m.c.private_file(copy,data);copy.chmod(0o444);drill.private.append(copy);args+=['--mount','type=bind,source='+str(copy)+',target='+destination+',readonly']
  m.c.run(args+[source['Image']]+(source['Config']['Cmd'] or []));drill.wait(name,'stack-grafana')
  import yaml
  effective=json.loads(json.dumps(expected));dashboard_rows={v['uid']:v for v in effective['dashboards']};source_rows={v['uid']:v for v in effective['dataSources']}
  for destination,path,data in binds:
   if destination.startswith('/etc/grafana/agenttrust-dashboards/') and destination.endswith('.json'):
    row=json.loads(data);dashboard_rows[row['uid']]={'uid':row['uid'],'title':row['title']}
   if destination=='/etc/grafana/provisioning/datasources/agenttrust.yaml':
    for row in yaml.safe_load(data)['datasources']:source_rows[row['uid']]={k:row[k] for k in ('uid','type','url')}
  effective.update(dashboards=sorted(dashboard_rows.values(),key=lambda r:r['uid']),dataSources=sorted(source_rows.values(),key=lambda r:r['uid']))
  drill.report.update(snapshotDashboardCount=len(expected['dashboards']),snapshotDataSourceCount=len(expected['dataSources']),provisioningConfigurationReapplied=True)
  expected_path=drill.directory/'expected.json';m.c.private_file(expected_path,json.dumps(effective).encode());expected_path.chmod(0o444);drill.private.append(expected_path)
  probe=drill.prefix+'-probe-grafana';drill.containers.append(probe)
  result=m.c.run(['docker','run','--rm','--log-driver','none','--name',probe,'--label','agenttrust.fixture='+drill.id,'--network',drill.prefix,'--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','192m','--pids-limit','32',
                 '--mount','type=volume,source='+drill.target_volume+',target=/data,readonly','--mount','type=bind,source='+str(ROOT/'scripts')+',target=/scripts,readonly','--mount','type=bind,source='+str(expected_path)+',target=/expected.json,readonly',drill.tools,'python','/scripts/stack-grafana-recovery-probe.py'],timeout=90,check=False)
  proof=json.loads(result.stdout);drill.report['grafanaMetadataProof']=proof;m.e.require(result.returncode==0 and proof['completed']);checkpoint()
  drill.report.update(completed=True,grafanaDatabaseRecoveryVerified=True,sqliteOnlineBackupVerified=True,databaseSha256=expected['databaseSha256'],sqliteSnapshotRestoredBeforeStartup=True,sourceVolumeReadOnly=True,operationalContainersUnchanged=True)
 except Exception as error:drill.report.update(completed=False,errorType=type(error).__name__,failureLocations=[{'file':pathlib.Path(x.filename).name,'line':x.lineno} for x in traceback.extract_tb(error.__traceback__)])
 finally:
  try:checkpoint();drill.report['operationalContainersUnchanged']=True
  except Exception:drill.report.update(completed=False,operationalContainersUnchanged=False)
  drill.cleanup()
 return drill

def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--execute',action='store_true');args=parser.parse_args()
 try:
  m.e.require(pathlib.Path.cwd().resolve()==ROOT and args.execute);drill=run();print(json.dumps({'completed':drill.report['completed'],'reportPath':str(drill.directory/'summary.json'),'actualDeploymentPerformed':False}));return 0 if drill.report['completed'] else 1
 except Exception as error:print(json.dumps({'completed':False,'code':'GRAFANA_HISTORY_RECOVERY_REFUSED','errorType':type(error).__name__}));return 1
if __name__=='__main__':sys.exit(main())
