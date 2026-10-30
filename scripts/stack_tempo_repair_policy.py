"""Non-executable operating Tempo review policy; never grants write permission."""
import datetime,hashlib,pathlib,re,uuid
EMPTY=hashlib.sha256(b'').hexdigest()

def require(value):
 if not value:raise ValueError('Tempo operating review refused')

def prefix(value):
 path=pathlib.PurePosixPath(value);parts=path.parts
 require(str(path)==value and len(parts)==3 and parts[0]=='blocks' and re.fullmatch('[A-Za-z0-9_-]{1,128}',parts[1]) and str(uuid.UUID(parts[2]))==parts[2]);return value

def affected_groups(files):
 require(len(files)==8);groups={}
 for name,row in files.items():
  path=pathlib.PurePosixPath(name);require(str(path)==name and len(path.parts)==4 and re.fullmatch('[A-Za-z0-9._=-]+',path.name))
  parent=prefix(path.parent.as_posix());require(type(row['bytes']) is int and row['bytes']==0 and row['sha256']==EMPTY and type(row['mode']) is int and 0<=row['mode']<=0o777)
  groups.setdefault(parent,{})[name]=row
 require(len(groups)==2 and all(len(rows)==4 and name+'/meta.json' in rows for name,rows in groups.items()));return groups

def build_review(proof,comparison,files,now):
 require(proof['kind']=='isolated-empty-tempo-metadata-control')
 for flag in ('completed','metadataFailureReproduced','ownedCopyQuarantineRecoveryVerified','operationalContainersUnchanged','sourceEmptyMetadataUnchanged','protectedLogitrackIdsAndImagesUnchanged','ownFixtureAndTemporarySecretsCleaned'):require(proof[flag] is True)
 for flag in ('sourceServicesStopped','operatingMetadataRepaired','affectedBlockContentsRecovered','automaticDeploymentAllowed','actualDeploymentPerformed','fullStackRecoveryVerified'):require(proof[flag] is False)
 require(proof.get('restartFreeApplyVerified') is not True and proof.get('restartFreeRollbackVerified') is not True)
 started=datetime.datetime.fromisoformat(proof['startedAt']);require(started.tzinfo is not None and now.tzinfo is not None and 0<=(now-started).total_seconds()<=86400)
 require(all(type(proof[name]) is int for name in ('protectedLogitrackServices','quarantinedOwnedBlocks','affectedFiles','affectedBytes','sourceApiTraceStatus','matchingTraces','positiveTraces','matchingSpans','positiveSpans')))
 require(proof['protectedLogitrackServices']==12 and proof['quarantinedOwnedBlocks']==2 and proof['affectedFiles']==8 and proof['affectedBytes']==0 and proof['sourceApiTraceStatus']==404)
 require(re.fullmatch('sha256:[a-f0-9]{64}',proof['sourceImageId']) and re.fullmatch('[a-f0-9]{40}',proof['candidateRevision']) and re.fullmatch('docker.io/automaster5013/agenttrust-tempo@sha256:[a-f0-9]{64}',proof['candidateReference']))
 before,after=comparison['before'],comparison['after'];require(before and before==after and 1<=len(before)<=20)
 for path,row in before.items():
  require(re.fullmatch(r'/api/traces/[a-f0-9]{32}\?start=\d+&end=\d+',path) and len(row)==2 and re.fullmatch('[a-f0-9]{64}',row[0]) and type(row[1]) is int and row[1]>0)
 require(proof['matchingTraces']==proof['positiveTraces']==len(before) and proof['matchingSpans']==proof['positiveSpans']==sum(v[1] for v in before.values()))
 negative=comparison['negative'];require(negative==proof['negativeControl'] and type(negative['statusCode']) is int and type(negative['truncatedJsonErrors']) is int and negative['statusCode']==404 and negative['ready'] is True and negative['truncatedJsonErrors']>0)
 groups=affected_groups(files);require(len(comparison['quarantinedSourcePrefixes'])==2 and set(groups)==set(comparison['quarantinedSourcePrefixes']))
 return {'schemaVersion':1,'kind':'non-executable-tempo-operating-recovery-review','createdAt':now.isoformat(),'evidenceExpiresAt':(started+datetime.timedelta(hours=24)).isoformat(),
         'operatingSourceWritesAllowed':False,'operatingStopOrRestartAllowed':False,'automaticRollbackAllowed':False,'automaticDeploymentAllowed':False,'fullStackRecoveryVerified':False,'actualDeploymentPerformed':False,
         'sourceVolume':'agenttrust_stack-tempo-data','sourceImageId':proof['sourceImageId'],'candidateRevision':proof['candidateRevision'],'candidateReference':proof['candidateReference'],
         'sourceFilePreconditions':files,'proposedNamespaceMoves':[{'source':name,'destination':'quarantine/'+name,'overwriteAllowed':False,'deleteAllowed':False} for name in sorted(groups)],
         'expectedTraceFingerprints':before,'matchedTraces':len(before),'matchedSpans':sum(v[1] for v in before.values()),'affectedHistoricContentsRecovered':False,
         'currentProofUsesOwnedContainerRestart':True,'restartFreeApplyVerified':False,'restartFreeRollbackVerified':False,'liveChecksPerformed':False,
         'blockers':['isolated hot polling recovery with unchanged fixture ID/image/StartedAt','isolated inverse namespace move and known-failure reappearance without restart','fresh source/destination path and exact file recheck','fresh original 20 AgentTrust and 12 LogiTrack identities/images/health and host reserve','explicit review of operating file intervention','full telemetry coverage and coherent operating backup remain separate CD gates'],
         'preflightMaxAgeSeconds':300,'hostInitialReserveMiB':2048,'hostCheckpointReserveMiB':1024,
         'polling':{'documentedDefaultSeconds':300,'effectiveRuntimeIntervalVerified':False,'proposedObservationWindowSeconds':900,'minimumCompletedPolls':2,'verifyEffectiveIntervalBeforeUse':True},
         'acceptance':{'allReferenceTraceDigestsMustMatch':True,'traceEndpointMustReturn200':True,'readyAloneSufficient':False,'newPollingErrorDeltaMustBeZero':True,'counterResetOrMissingMetricIsInconclusive':True,'sameTempoContainerIdImageAndStartedAtRequired':True},
         'rollback':{'healthyRecoveryGuaranteed':False,'expectedPreChangeHistoricalApiStatus':404,'automaticOnTimeout':False,'neverOverwriteExistingDestination':True,'neverDeleteConflict':True,'timeoutAction':'pause-and-review','imageRollbackApplicable':False}}

def assess_namespace(files,locations,protected_healthy):
 groups=affected_groups(files);require(set(locations)==set(groups))
 result={'operatingSourceWritesAllowed':False,'automaticRollbackAllowed':False,'healthyRecoveryGuaranteed':False,'expectedStatusAfterNamespaceReversal':404,'proposedReverseMoves':[]}
 if protected_healthy is not True:return {**result,'state':'inconclusive','reason':'protected-health-unverified'}
 states=[]
 for name,expected in groups.items():
  source,destination=locations[name]['source'],locations[name]['quarantine']
  if source['state']=='absent' and destination['state']=='directory' and destination.get('files')=={'quarantine/'+key:row for key,row in expected.items()}:
   states.append('quarantined');result['proposedReverseMoves'].append({'source':'quarantine/'+name,'destination':name,'overwriteAllowed':False})
  elif destination['state']=='absent' and source['state']=='directory' and source.get('files')==expected:states.append('original')
  else:return {**result,'state':'manual-review','reason':'collision-missing-symlink-unknown-or-fingerprint-drift','proposedReverseMoves':[]}
 state='original' if all(v=='original' for v in states) else 'quarantined' if all(v=='quarantined' for v in states) else 'partial-quarantine'
 return {**result,'state':state,'reason':'proposal-only-separate-review-required'}
