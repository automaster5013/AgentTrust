"""Render real dependency definitions and check their declared cross-chart contracts.

No kubectl, provider credentials, cluster calls or live NetworkPolicy claims.
"""
import copy,decimal,json,pathlib,yaml

NAMES=['db','nats','redis','identity','object-store']
PORTS={'db':5432,'nats':4222,'redis':6379,'identity':8080,'object-store':9000}
UIDS={'db':70,'nats':10001,'redis':999,'identity':1000,'object-store':10001}
MEMORY={'db':'512Mi','nats':'128Mi','redis':'96Mi','identity':'768Mi','object-store':'512Mi'}
MOUNTS={'db':'/var/lib/postgresql/data','nats':'/tmp','redis':'/data','identity':'/opt/keycloak/data','object-store':'/tmp'}

def _matches(selector,labels):
 assert set(selector)<= {'matchLabels'}
 return all(labels.get(key)==value for key,value in selector.get('matchLabels',{}).items())

def _endpoint(namespace,name,dependency=False):
 return {'namespace':namespace,'labels':{'app.kubernetes.io/part-of':'agenttrust-dependencies-review' if dependency else 'agenttrust-review','app.kubernetes.io/name':name}}

def _allowed(policies,side,origin,target,port,protocol='TCP'):
 selected_endpoint=target if side=='Ingress' else origin
 selected=[p for p in policies if p['metadata']['namespace']==selected_endpoint['namespace'] and side in p['spec']['policyTypes'] and _matches(p['spec']['podSelector'],selected_endpoint['labels'])]
 if not selected:return True
 peer_endpoint=origin if side=='Ingress' else target
 for policy in selected:
  for rule in policy['spec'].get(side.lower(),[]):
   ports=rule.get('ports',[])
   if ports and not any(p['port']==port and p.get('protocol','TCP')==protocol for p in ports):continue
   peers=rule.get('from' if side=='Ingress' else 'to',[])
   if not peers:return True
   for peer in peers:
    assert set(peer)<= {'namespaceSelector','podSelector'}
    if 'namespaceSelector' in peer:
     if not _matches(peer['namespaceSelector'],{'kubernetes.io/metadata.name':peer_endpoint['namespace']}):continue
    elif peer_endpoint['namespace']!=policy['metadata']['namespace']:continue
    if 'podSelector' in peer and not _matches(peer['podSelector'],peer_endpoint['labels']):continue
    return True
 return False

def _verify(source,output,schema,run,app_documents,cpu_milli,memory_bytes,result):
 chart=source/'charts/agenttrust-dependencies-review'
 values={'mode':'local-review','revision':'1'*40,'applicationNamespace':'agenttrust-review','existingSecret':'agenttrust-dependency-config','storageClass':'operator-review-fixture','initializeObjectStore':False,'storageGiB':{'db':8,'nats':2,'redis':1,'identity':1,'object-store':8},'images':{name:'ghcr.io/automaster5013/agenttrust-'+name+'@sha256:'+'1'*64 for name in NAMES}}
 result.update(completed=False,phase='strict-lint',clusterContacted=False,resourcesApplied=False,secretValuesGenerated=False,actualStorageOrNetworkEnforcementVerified=False,actualDependencyStartupVerifiedByThisCheck=False,productionReady=False,checks=[],profiles=[])
 input_path=output/'dependency-fixture-values.json';input_path.write_text(json.dumps(values),encoding='utf-8')
 run(['helm','lint','--strict','-f',str(input_path),str(chart)],'dependencies-lint')
 default=None
 for initialize in [False,True]:
  variant=copy.deepcopy(values);variant['initializeObjectStore']=initialize;input_path.write_text(json.dumps(variant),encoding='utf-8');profile='initialization' if initialize else 'default'
  raw=run(['helm','template','agenttrust-dependencies-review',str(chart),'--namespace','agenttrust-dependencies','--kube-version','1.34.0','-f',str(input_path)],'dependencies-'+profile)
  rendered_path=output/('dependencies-'+profile+'-rendered.yaml');rendered_path.write_text(raw,encoding='utf-8');documents=list(yaml.safe_load_all(raw));assert len(documents)==(27 if initialize else 26) and all(isinstance(d,dict) for d in documents)
  assert all(d['metadata']['namespace']=='agenttrust-dependencies' for d in documents)
  assert not any(d['kind'] in ['Secret','Namespace','PersistentVolume','Ingress','Deployment'] for d in documents)
  result['phase']=profile+'-workloads';stateful=[d for d in documents if d['kind']=='StatefulSet'];assert len(stateful)==5
  pods=[];workloads={}
  for item in stateful:
   spec=item['spec'];pod=spec['template']['spec'];container=pod['containers'][0];name=container['name'];workloads[name]=item;pods.append(pod)
   assert name in NAMES and container['image']==values['images'][name] and spec['replicas']==1 and spec['updateStrategy']=={'type':'OnDelete'} and spec['persistentVolumeClaimRetentionPolicy']=={'whenDeleted':'Retain','whenScaled':'Retain'}
   assert spec['serviceName']=='stack-'+name+'-headless' and spec['podManagementPolicy']=='OrderedReady'
   assert pod['serviceAccountName']=='agenttrust-dependencies-review' and pod['automountServiceAccountToken'] is False and pod['shareProcessNamespace'] is False and pod['terminationGracePeriodSeconds']==60
   assert pod['securityContext']=={'runAsNonRoot':True,'runAsUser':UIDS[name],'runAsGroup':UIDS[name],'fsGroup':UIDS[name],'seccompProfile':{'type':'RuntimeDefault'}}
   assert container['securityContext']=={'allowPrivilegeEscalation':False,'readOnlyRootFilesystem':True,'capabilities':{'drop':['ALL']}} and container['resources']['limits']['memory']==MEMORY[name]
   assert container['startupProbe'] and container['readinessProbe'] and not container.get('livenessProbe') and not pod.get('hostNetwork') and not pod.get('hostPID')
   assert all(not v.get('hostPath') for v in pod['volumes']) and all(not e.get('value') for e in container.get('env',[]) if 'PASSWORD' in e['name'])
   claims=spec['volumeClaimTemplates'];assert len(claims)==1 and claims[0]['metadata']['name']=='data' and claims[0]['metadata']['annotations']=={'helm.sh/resource-policy':'keep'}
   assert claims[0]['spec']=={'accessModes':['ReadWriteOnce'],'volumeMode':'Filesystem','storageClassName':values['storageClass'],'resources':{'requests':{'storage':str(values['storageGiB'][name])+'Gi'}}}
   assert {'name':'data','mountPath':MOUNTS[name]} in container['volumeMounts'] and not any(v['name']=='data' for v in pod['volumes'])
   for volume in pod['volumes']:
    if 'secret' in volume:assert volume['secret']['secretName']==values['existingSecret'] and volume['secret']['defaultMode']==0o440 and volume['secret']['items']
   for mount in container['volumeMounts']:
    if mount['name'] not in ['data','temporary','postgres-socket']:assert mount['readOnly'] is True
  assert set(workloads)==set(NAMES)
  result['phase']=profile+'-secret-contracts';db=workloads['db']['spec']['template']['spec'];db_env={e['name']:e for e in db['containers'][0]['env']}
  assert db_env['POSTGRES_PASSWORD_FILE']['value']=='/run/secrets/database-migration-password' and db_env['PGDATA']['value']=='/var/lib/postgresql/data/pgdata'
  assert next(v['secret']['items'] for v in db['volumes'] if v['name']=='database-bootstrap')==[{'key':'database-bootstrap.sql','path':'10-agenttrust.sql'}]
  identity=workloads['identity']['spec']['template']['spec'];identity_env={e['name']:e for e in identity['containers'][0]['env']}
  assert identity_env['KC_DB_PASSWORD']['valueFrom']['secretKeyRef']=={'name':values['existingSecret'],'key':'database-identity-password'}
  assert identity_env['KC_BOOTSTRAP_ADMIN_PASSWORD']['valueFrom']['secretKeyRef']=={'name':values['existingSecret'],'key':'identity-admin-password'}
  assert next(v['secret']['items'] for v in identity['volumes'] if v['name']=='realm')==[{'key':'stack-identity-realm','path':'agenttrust-realm.json'}]
  assert identity['containers'][0]['args']==['start','--optimized','--http-enabled=true','--hostname=http://127.0.0.1:4322','--import-realm']
  result['phase']=profile+'-services';services=[d for d in documents if d['kind']=='Service'];assert len(services)==10
  for service in services:
   name=service['spec']['selector']['app.kubernetes.io/name'];assert service['spec']['type']=='ClusterIP' and service['spec']['ports']==[{'name':'client','port':PORTS[name],'targetPort':'client'}]
   assert service['metadata']['name'] in ['stack-'+name,'stack-'+name+'-headless'] and (service['spec'].get('clusterIP')=='None') is service['metadata']['name'].endswith('-headless')
  result['phase']=profile+'-optional-initialization';jobs=[d for d in documents if d['kind']=='Job'];assert len(jobs)==int(initialize)
  if initialize:
   job=jobs[0];pod=job['spec']['template']['spec'];pods.append(pod);container=pod['containers'][0]
   assert job['metadata']['name']=='stack-object-init-'+'1'*12 and job['spec']['backoffLimit']==0 and job['spec']['activeDeadlineSeconds']==120 and pod['restartPolicy']=='Never'
   assert pod['automountServiceAccountToken'] is False and pod['shareProcessNamespace'] is False and container['command']==['/usr/local/bin/minio-init'] and container['image']==values['images']['object-store']
   assert container['securityContext']=={'allowPrivilegeEscalation':False,'readOnlyRootFilesystem':True,'capabilities':{'drop':['ALL']}} and container['resources']['limits']=={'cpu':'1','memory':'128Mi'}
   assert {v['key'] for volume in pod['volumes'] if 'secret' in volume for v in volume['secret']['items']}=={'stack-minio-root-user','stack-minio-root-password','stack-minio-user','stack-minio-password'}
  result['phase']=profile+'-quota';quota=next(d['spec']['hard'] for d in documents if d['kind']=='ResourceQuota')
  budget={}
  for category in ['limits','requests']:
   cpu=sum(cpu_milli(c['resources'][category]['cpu']) for p in pods for c in p['containers']);memory=sum(memory_bytes(c['resources'][category]['memory']) for p in pods for c in p['containers']);budget[category+'CpuMilli']=cpu;budget[category+'MemoryBytes']=memory
   assert cpu<=cpu_milli(quota[category+'.cpu']) and memory<=memory_bytes(quota[category+'.memory'])
  assert int(quota['pods'])>=len(pods) and int(quota['services'])==len(services) and int(quota['persistentvolumeclaims'])==5 and memory_bytes(quota['requests.storage'])==sum(values['storageGiB'].values())*1073741824
  result['phase']=profile+'-strict-schema';validated=json.loads(run(['kubeconform','-strict','-summary','-output','json','-kubernetes-version','1.34.0','-schema-location',schema,str(rendered_path)],'dependencies-'+profile+'-schema'));assert validated['summary']['valid']==len(documents) and validated['summary']['invalid']==validated['summary']['errors']==validated['summary']['skipped']==0
  result['profiles'].append({'name':profile,'validatedResources':len(documents),'persistentClaims':5,'objectInitializationEnabled':initialize,'renderedBudget':budget,'quotaCoversRenderedBudget':True,'requestedStorageBytes':sum(values['storageGiB'].values())*1073741824})
  if not initialize:default=documents
 result['checks'].append('five digest-pinned bounded non-root persistent workloads; explicit Retain/OnDelete, file secrets, stable services and opt-in bounded initialization')
 result['phase']='cross-chart-dns';app_services={d['metadata']['name']:d for d in app_documents if d['kind']=='Service' and d['spec']['type']=='ExternalName'}
 assert set(app_services)=={'stack-'+n for n in NAMES}
 for name in NAMES:assert app_services['stack-'+name]['spec']['externalName']=='stack-'+name+'.agenttrust-dependencies.svc.cluster.local'
 result['phase']='declared-network-paths';policies=[]
 for d in [*app_documents,*default]:
  if d['kind']!='NetworkPolicy':continue
  policy=copy.deepcopy(d);policy['metadata'].setdefault('namespace','agenttrust-review');policies.append(policy)
 deps=[p for p in policies if p['metadata']['namespace']=='agenttrust-dependencies'];assert len(deps)==9
 assert any(p['spec']=={'podSelector':{},'policyTypes':['Ingress','Egress']} for p in deps)
 for policy in deps:
  for direction in ['ingress','egress']:
   for rule in policy['spec'].get(direction,[]):assert rule.get('from' if direction=='ingress' else 'to') and rule.get('ports')
 app=lambda name:_endpoint('agenttrust-review',name)
 dep=lambda name:_endpoint('agenttrust-dependencies',name,True)
 edges=[(app('core-api'),dep('db'),5432),(app('core-api'),dep('nats'),4222),(app('ai-worker'),dep('nats'),4222),(app('gateway'),dep('redis'),6379),(app('core-api'),dep('identity'),8080),(app('core-api'),dep('object-store'),9000),(dep('identity'),dep('db'),5432),(dep('identity'),app('core-api'),8080),(dep('object-init'),dep('object-store'),9000)]
 allowed=lambda a,b,p:_allowed(policies,'Egress',a,b,p) and _allowed(policies,'Ingress',a,b,p)
 for a,b,port in edges:assert allowed(a,b,port)
 rejected=[(_endpoint('untrusted', 'core-api'),dep('db'),5432),(app('unknown'),dep('db'),5432),(app('gateway'),dep('db'),5432),(app('ai-worker'),dep('object-store'),9000),(app('core-api'),dep('redis'),6379),(dep('redis'),app('core-api'),8080),(dep('identity'),app('gateway'),8080),(dep('object-init'),dep('db'),5432),(app('core-api'),dep('identity'),9000),(app('core-api'),dep('object-store'),9001)]
 for name in NAMES:rejected.append((dep(name),_endpoint('outside','external'),443))
 for a,b,port in rejected:assert not allowed(a,b,port)
 for name in NAMES:
  for protocol in ['UDP','TCP']:
   dns={'namespace':'kube-system','labels':{'k8s-app':'kube-dns'}};foreign={'namespace':'outside','labels':{'k8s-app':'kube-dns'}}
   assert _allowed(policies,'Egress',dep(name),dns,53,protocol) and not _allowed(policies,'Egress',dep(name),foreign,53,protocol)
 result['declaredAllowedNetworkPaths']=len(edges);result['declaredForbiddenNetworkPathsRefused']=len(rejected);result['crossChartDependencyDnsVerified']=True;result['checks'].append('actual application aliases resolve to declared dependency services; reference policy evaluation distinguishes namespace AND pod selection and refuses undeclared paths')
 rejected_values=['mutable-tag','foreign-repository','wrong-component','production-mode','unknown-setting','empty-storage-class','zero-storage','unbounded-storage','nonboolean-init','unsafe-secret-name','foreign-application-namespace','caller-deletion-retention','wrong-release-namespace']
 for kind in rejected_values:
  result['phase']='refuse-'+kind
  bad=copy.deepcopy(values);namespace='agenttrust-dependencies'
  if kind=='mutable-tag':bad['images']['db']='ghcr.io/automaster5013/agenttrust-db:main'
  elif kind=='foreign-repository':bad['images']['db']='ghcr.io/foreign/agenttrust-db@sha256:'+'1'*64
  elif kind=='wrong-component':bad['images']['db']=bad['images']['redis']
  elif kind=='production-mode':bad['mode']='production'
  elif kind=='unknown-setting':bad['hostNetwork']=True
  elif kind=='empty-storage-class':bad['storageClass']=''
  elif kind=='zero-storage':bad['storageGiB']['db']=0
  elif kind=='unbounded-storage':bad['storageGiB']['db']=65
  elif kind=='nonboolean-init':bad['initializeObjectStore']='true'
  elif kind=='unsafe-secret-name':bad['existingSecret']='../other'
  elif kind=='foreign-application-namespace':bad['applicationNamespace']='kube-system'
  elif kind=='caller-deletion-retention':bad['retention']='Delete'
  else:namespace='default'
  path=output/('dependency-refused-'+kind+'.json');path.write_text(json.dumps(bad),encoding='utf-8');run(['helm','template','agenttrust-dependencies-review',str(chart),'--namespace',namespace,'-f',str(path)],'dependency-refused-'+kind,expected=1)
 result['unsafeValuesRefused']=len(rejected_values);result['checks'].append('mutable/foreign/substituted images, public mode, unsafe storage/namespace/secret settings and caller retention overrides refused')
 result.update(completed=True,phase='completed',validatedResourcesAcrossDependencyProfiles=sum(p['validatedResources'] for p in result['profiles']),originalApplicationNamespaceResourcesUnchanged=True,storageClassAndSecretContentsRequireOperatorAcceptance=True,pvcRetentionIsNotBackupOrHa=True)
 (output/'dependency-contracts.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8');return result

def verify(source,output,schema,run,app_documents,cpu_milli,memory_bytes):
 result={}
 try:return _verify(source,output,schema,run,app_documents,cpu_milli,memory_bytes,result)
 except Exception as error:
  result.update(completed=False,errorType=type(error).__name__)
  (output/'dependency-contracts.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
  raise
