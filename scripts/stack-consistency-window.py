"""Observe an unchanged DB/object/queue window without pausing source admissions.
This is conservation/readback evidence, never a cross-store atomic backup.
"""
import argparse,datetime,hashlib,importlib.util,json,pathlib,secrets,sys,traceback
import stack_live_state as live
ROOT=pathlib.Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('window_online',ROOT/'scripts/stack-online-recovery.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':'))

def validate_window(before,after,objects):
 m.e.require(before['pending']==after['pending']==0)
 for field in ('business','ledger','queue'):m.e.require(before[field]==after[field])
 m.e.require(sorted(before['references'],key=canonical)==sorted(after['references'],key=canonical))
 m.e.require(objects['completed'] is True and objects['allPinnedVersionIdsAndBytesVerified'] is True and objects['historicalObjectVersionsVerified']==len(before['references']))
 return {'observedCrossStoreConsistencyVerified':True,'atomicSnapshotVerified':False,'sourceAdmissionsPaused':False,'fullStackRecoveryVerified':False,'automaticDeploymentAllowed':False}

def collect():
 return {'business':m.c.fingerprint(),'ledger':m.e.live_ledger(),'queue':live.queue_state('agenttrust-stack-nats-1'),
         'references':live.reference_rows(m.c.sql),'pending':int(m.c.sql(m.c.PENDING))}

def run(revision):
 ids,raw,inventory,by_service=m.d.live_baseline();hashes=m.e.planner.compose_hashes(inventory,ROOT);_,protected=m.d.resolved_groups(inventory,by_service,list(m.e.planner.COMPONENTS))
 sources=m.c.source_preflight();common=set(sources['stack-core-api']['NetworkSettings']['Networks'])&set(sources['stack-object-store']['NetworkSettings']['Networks'])&set(sources['stack-nats']['NetworkSettings']['Networks'])
 m.e.require(len(common)==1);network=next(iter(common));network_before=json.loads(m.c.run(['docker','network','inspect',network]).stdout)[0]
 m.e.require(network_before['Internal'] is True and network_before['Labels']['com.docker.compose.project']=='agenttrust')
 drill=m.c.Rehearsal(sources);drill.report.update(kind='observed-cross-store-consistency-window',actualDeploymentPerformed=False,fullStackRecoveryVerified=False,sourceServicesStopped=False,sourceAdmissionsPaused=False,atomicSnapshotVerified=False)
 keydir=ROOT/'.local'/('consistency-window-key-'+drill.id);m.protect(keydir);key=secrets.token_bytes(32);m.c.private_file(keydir/'key.bin',key);drill.report['retainedKeyDirectory']=str(keydir);crypto=m.load('window_crypto','stack-backup-crypt.py')
 try:
  drill.stage('read-only-before-state-and-pinned-object-reads');before=collect();m.e.same_schema(m.e.migration_catalog(revision),before['ledger'])
  input_path=drill.directory/'object-references.json';m.c.private_file(input_path,json.dumps({'objectReferences':before['references']}).encode());input_path.chmod(0o444);drill.private.append(input_path)
  mounts={v['Destination']:v['PrivateHostPath'] for v in sources['stack-core-api']['Mounts'] if v['Type']=='bind'}
  name=drill.prefix+'-source-object-read';drill.containers.append(name)
  args=['docker','run','--rm','--log-driver','none','--name',name,'--label','agenttrust.fixture='+drill.id,'--network',network,'--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true',
        '--memory','256m','--cpus','1','--pids-limit','32','--tmpfs','/tmp:size=16m,mode=1777','--mount','type=bind,source='+str(ROOT/'scripts')+',target=/scripts,readonly',
        '--mount','type=bind,source='+str(input_path)+',target=/state-input.json,readonly']
  for secret in ('stack-minio-user','stack-minio-password'):args+=['--mount','type=bind,source='+mounts['/run/secrets/'+secret]+',target=/run/secrets/'+secret+',readonly']
  result=m.c.run(args+['agenttrust-security:local','python','/scripts/stack-stateful-recovery-probe.py','--phase','historical'],timeout=300,check=False)
  proof=json.loads(result.stdout);m.e.require(result.returncode==0);after=collect();joined=validate_window(before,after,proof)
  cipher=crypto.transform('encrypt',key,json.dumps({'before':before,'after':after,'objectProof':proof,'revision':revision}).encode());m.c.private_file(drill.directory/'consistency-window.aesgcm',cipher)
  m.e.require(crypto.transform('decrypt',key,cipher)==json.dumps({'before':before,'after':after,'objectProof':proof,'revision':revision}).encode())
  network_after=json.loads(m.c.run(['docker','network','inspect',network]).stdout)[0];m.e.require(set(network_before['Containers'])==set(network_after['Containers']))
  m.e.planner.recheck(ids,inventory,ROOT,hashes);m.e.require(m.d.hash_files(protected)==protected)
  drill.report.update(joined,completed=True,businessTables=len(before['business']),pinnedObjectVersions=proof['historicalObjectVersionsVerified'],streams=len(before['queue']),
                      encryptedEvidenceSha256=hashlib.sha256(cipher).hexdigest(),originalNetworkMembershipRestored=True,operationalContainersUnchanged=True,
                      excludedFromConsistency=['identity DB alignment with application DB','unpersisted Redis memory','active observability WAL','unobserved interleavings between reads'])
 except Exception as error:drill.report.update(completed=False,errorType=type(error).__name__,failureLocations=[{'file':pathlib.Path(x.filename).name,'line':x.lineno} for x in traceback.extract_tb(error.__traceback__)])
 finally:
  try:m.e.planner.recheck(ids,inventory,ROOT,hashes);m.e.require(m.d.hash_files(protected)==protected);drill.report['operationalContainersUnchanged']=True
  except Exception:drill.report.update(completed=False,operationalContainersUnchanged=False)
  drill.cleanup()
 return drill

def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--revision',required=True);parser.add_argument('--execute',action='store_true');args=parser.parse_args()
 try:
  m.e.require(pathlib.Path.cwd().resolve()==ROOT and args.execute and m.e.re.fullmatch('[a-f0-9]{40}',args.revision));drill=run(args.revision)
  print(json.dumps({'completed':drill.report['completed'],'reportPath':str(drill.directory/'summary.json'),'atomicSnapshotVerified':False,'actualDeploymentPerformed':False}));return 0 if drill.report['completed'] else 1
 except Exception as error:print(json.dumps({'completed':False,'code':'CONSISTENCY_WINDOW_REFUSED','errorType':type(error).__name__}));return 1
if __name__=='__main__':sys.exit(main())
