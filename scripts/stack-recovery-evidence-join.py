"""Join separately pinned recovery phases against the unchanged live source.
Phased evidence never becomes a cross-store atomic snapshot or deployment consent.
"""
import argparse,datetime,importlib.util,json,pathlib,sys
from types import SimpleNamespace
ROOT=pathlib.Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('joined_online','%s/scripts/stack-online-recovery.py'%ROOT);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def validate_phase(name,proof,manifest,revision,images,now):
 require=m.e.require
 require(name in ('application','stores','session'))
 require(proof['completed'] is True and proof['ownFixtureAndTemporarySecretsCleaned'] is True and proof['operationalContainersUnchanged'] is True)
 require(proof['actualDeploymentPerformed'] is False and proof['fullStackRecoveryVerified'] is False)
 require(proof['fixtureId']==manifest['snapshotId'] and proof['encryptedManifestSha256']==manifest['_pinnedCiphertextSha256'])
 require(manifest['candidateRevision']==revision and manifest['sourceImageIds']==images)
 start=datetime.datetime.fromisoformat(proof['startedAt']);end=datetime.datetime.fromisoformat(proof['finishedAt'])
 require(start.tzinfo is not None and end.tzinfo is not None and start<=end<=now and 0<=(now-start).total_seconds()<=86400)
 captured=datetime.datetime.fromisoformat(manifest['createdAt']);require(captured.tzinfo is not None and start<=captured<=end)
 if name=='application':
  require(proof['candidateBusinessPathVerified'] is True and proof['operatingDatabaseLogicalRestoreVerified'] is True)
  require(proof['applicationProof']['completed'] is True and proof['applicationProof']['ownSessionsClosed'] is True and proof['applicationProof']['paidProviderCallsPerformed'] is False)
 elif name=='stores':
  require(manifest['liveStateIncluded'] is True and proof['historicalObjectVersionsRestored'] is True)
  require(proof['historicalObjectProof']['completed'] is True and proof['historicalObjectProof']['allPinnedVersionIdsAndBytesVerified'] is True)
  require(proof['allCapturedStreamsAndDurableConsumerPositionsRestored'] is True and proof['sourceQueuePositionsUnchanged'] is True)
  require(proof['queuePersistenceAndReplayVerified'] is True and proof['storeQueuecompletion']['completed'] is True and proof['storeQueuecompletion']['exactPayloadAndDurableAckVerified'] is True)
  require(proof['fixtureQuotaAofReplayVerified'] is True and proof['fixtureQuotaExpiredWithoutResurrection'] is True)
 else:
  require(proof['operatingDatabaseLogicalRestoreVerified'] is True and proof['apiRestartReauthenticationVerified'] is True)
  require(proof['preRestartSessionProof']['completed'] is True and proof['sessionRestartProof']['completed'] is True)
  require(proof['preRestartSessionProof']['oldCookieAuthenticatedBeforeRestart'] is True and proof['fixtureApiIdAndImagePreserved'] is True)
  require(proof['sessionRestartProof']['oldCookieRejectedAfterApiRestart'] is True and proof['sessionRestartProof']['freshOidcLoginVerified'] is True)
  require(proof['sessionRestartProof']['sessionReauthenticationRequired'] is True and proof['sessionRestartProof']['existingSessionContinuityVerified'] is False)

def read_phase(row,revision,images,configuration,fingerprints,now):
 proof=json.loads(m.e.anchored_file(row['proof'],row['proofSha256']))
 directory=pathlib.Path(row['snapshot']).resolve();key_path=pathlib.Path(row['keyFile'])
 verified=m.verify_retained(directory,key_path,row['manifestSha256'],row['snapshotId']);m.e.require(verified['completed'])
 crypto=m.load('join_envelope','stack-backup-crypt.py');custody=m.c.retained_key(ROOT,key_path);key=custody[0].read_bytes()
 ciphertext=m.e.anchored_file(directory/'online-manifest.aesgcm',row['manifestSha256']);manifest=json.loads(crypto.transform('decrypt',key,ciphertext));manifest['_pinnedCiphertextSha256']=row['manifestSha256']
 validate_phase(row['phase'],proof,manifest,revision,images,now)
 def decode(name):
  expected=manifest['components'][name];raw=m.e.anchored_file(directory/(name+'.aesgcm'),expected['sha256'],limit=64*1024*1024)
  m.e.require(m.component(raw)==expected);return crypto.transform('decrypt',key,raw)
 m.e.require(json.loads(decode('configuration'))==configuration and json.loads(decode('businessFingerprints'))==fingerprints)
 if row['phase']=='stores':
  state=json.loads(decode('liveStateMetadata'));m.e.require(proof['historicalObjectProof']['historicalObjectVersionsVerified']==len(state['objectReferences']))
 m.e.require(m.c.key_unchanged(*custody))
 m.e.anchored_file(row['proof'],row['proofSha256']);m.e.anchored_file(directory/'online-manifest.aesgcm',row['manifestSha256'])
 return {'phase':row['phase'],'proofSha256':row['proofSha256'],'encryptedManifestSha256':row['manifestSha256'],'snapshotId':row['snapshotId'],'sourceConfigurationAndBusinessRowsBound':True}

def join(config):
 m.e.require(len(config['phases'])==3 and {r['phase'] for r in config['phases']}=={'application','stores','session'})
 ids,raw,inventory,by_service=m.d.live_baseline();hashes=m.e.planner.compose_hashes(inventory,ROOT)
 _,protected=m.d.resolved_groups(inventory,by_service,list(m.e.planner.COMPONENTS))
 candidate=json.loads(m.e.anchored_file(config['candidateConfig'],config['candidateConfigSha256']))
 release=m.e.verify_candidate_release(candidate,candidate['revision'],inventory,{})
 sources=m.c.source_preflight();configuration=json.loads(m.c.Rehearsal.configuration(SimpleNamespace(sources=sources)))
 fingerprints=m.c.fingerprint();images={service:row['Image'] for service,row in sources.items()};now=datetime.datetime.now(datetime.timezone.utc)
 phases=[read_phase(row,candidate['revision'],images,configuration,fingerprints,now) for row in config['phases']]
 m.e.require(m.c.fingerprint()==fingerprints);m.e.planner.recheck(ids,inventory,ROOT,hashes);m.e.require(m.d.hash_files(protected)==protected)
 m.e.anchored_file(config['candidateConfig'],config['candidateConfigSha256'])
 return {'schemaVersion':1,'completed':True,'kind':'phased-business-recovery-evidence','createdAt':now.isoformat(),'candidateRevision':candidate['revision'],
         'phases':phases,'phasedBusinessRecoveryEvidenceVerified':True,'liveServicesBound':len(inventory),'businessTablesBound':len(fingerprints),
         'sessionReauthenticationRequired':True,'existingSessionContinuityVerified':False,'crossStoreSnapshotAtomic':False,
         'fullStackRecoveryVerified':False,'operationalBackupVerified':False,'automaticDeploymentAllowed':False,'actualDeploymentPerformed':False,
         'remaining':['cross-database and cross-store atomic consistency','monitoring history and local model recovery','reviewed operating transition approval']}

def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--config',type=pathlib.Path,required=True);parser.add_argument('--expected-config-sha256',required=True);parser.add_argument('--output',type=pathlib.Path,required=True);args=parser.parse_args()
 try:
  m.e.require(pathlib.Path.cwd().resolve()==ROOT);output=args.output.resolve();m.e.require(output.is_relative_to((ROOT/'.local').resolve()) and not output.exists())
  raw=m.e.anchored_file(args.config,args.expected_config_sha256);report=join(json.loads(raw));m.e.anchored_file(args.config,args.expected_config_sha256)
  with output.open('x',encoding='utf-8') as handle:handle.write(json.dumps(report,indent=2)+'\n')
  print(json.dumps({'completed':True,'phasesVerified':3,'fullStackRecoveryVerified':False,'automaticDeploymentAllowed':False}));return 0
 except Exception as error:
  print(json.dumps({'completed':False,'code':'PHASED_RECOVERY_JOIN_REFUSED','errorType':type(error).__name__}));return 1
if __name__=='__main__':sys.exit(main())
