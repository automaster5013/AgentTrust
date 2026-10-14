"""Render/validate with synthetic values and mocked providers. Never reads a kubeconfig or calls a cluster."""
import copy,decimal,hashlib,json,pathlib,shutil,subprocess,tempfile,yaml
source=pathlib.Path('/src');output=pathlib.Path('/out');report={'completed':False,'checks':[],'clusterContacted':False,'resourcesApplied':False,'credentialsMounted':False}
work=None
schema='https://raw.githubusercontent.com/yannh/kubernetes-json-schema/5f1fa4f7908afc9b6641c62d282a4a22437626e1/{{.NormalizedKubernetesVersion}}-standalone{{.StrictSuffix}}/{{.ResourceKind}}{{.KindSuffix}}.json'
names=['core-api','ai-worker','gateway','console','opa','quality-verifier'];values={'mode':'local-review','revision':'1'*40,'existingSecret':'agenttrust-stack-config','images':{name:'ghcr.io/automaster5013/agenttrust-'+name+'@sha256:'+'1'*64 for name in names},'dependencies':{'namespace':'agenttrust-dependencies',**{name:name.lower()+'.agenttrust-dependencies.svc.cluster.local' for name in ['postgres','nats','redis','identity','objectStore']}}}
def run(command,name,expected=0,cwd=None):
 result=subprocess.run(command,capture_output=True,text=True,timeout=300,cwd=cwd);(output/(name+'.log')).write_text(result.stdout+'\n'+result.stderr,encoding='utf-8');assert result.returncode==expected
 return result.stdout
def cpu_milli(value):
 text=str(value);result=decimal.Decimal(text[:-1]) if text.endswith('m') else decimal.Decimal(text)*1000
 assert result>=0 and result==result.to_integral_value();return int(result)
def memory_bytes(value):
 text=str(value)
 for suffix,factor in [('Gi',1073741824),('Mi',1048576),('Ki',1024)]:
  if text.endswith(suffix):return int(decimal.Decimal(text[:-len(suffix)])*factor)
 raise ValueError('Unsupported rendered memory quantity')
def ci_isolation(original,infrastructure):
 for workflow,prefix in [(original,'original-stack'),(infrastructure,'stack-infrastructure')]:
  assert workflow['concurrency']=={'group':prefix+'-${{ github.ref }}-${{ github.sha }}','cancel-in-progress':False}
  assert all(job['runs-on']=='ubuntu-latest' for job in workflow['jobs'].values())
  uploads=[step['with']['name'] for job in workflow['jobs'].values() for step in job['steps'] if str(step.get('uses','')).startswith('actions/upload-artifact@')]
  assert uploads and all(name.endswith('-${{ github.sha }}') for name in uploads)
 jobs=original['jobs'];assert set(jobs)=={'security-source','integration','images','security-images'}
 for name,parent in [('integration','security-source'),('images','integration'),('security-images','images')]:
  value=jobs[name]['needs'];assert set(value if isinstance(value,list) else [value])=={parent}
 for name in ['images','security-images']:assert jobs[name]['if']=="github.event_name != 'pull_request' && github.ref == 'refs/heads/main'"
 lines=[line.strip() for job in jobs.values() for step in job['steps'] for line in step.get('run','').splitlines()]
 assert [line for line in lines if line.startswith('docker push ')]==['docker push "$image"']
 assert [line for line in lines if line.startswith('image=')]==['image="ghcr.io/${GITHUB_REPOSITORY_OWNER,,}/agenttrust-$service:$GITHUB_SHA"']
try:
 original=yaml.safe_load((source/'workflows/original-stack.yml').read_text(encoding='utf-8'));infrastructure=yaml.safe_load((source/'workflows/stack-infrastructure.yml').read_text(encoding='utf-8'));ci_isolation(original,infrastructure)
 for kind in ['shared-concurrency','mutable-tag','shared-artifact','cancel-other-revision']:
  first,second=copy.deepcopy(original),copy.deepcopy(infrastructure)
  if kind=='shared-concurrency':first['concurrency']['group']='original-stack-${{ github.ref }}'
  elif kind=='mutable-tag':
   step=next(s for s in first['jobs']['images']['steps'] if s.get('name')=='Build, publish and record immutable image references');step['run']=step['run'].replace('agenttrust-$service:$GITHUB_SHA','agenttrust-$service:main')
  elif kind=='shared-artifact':
   step=next(s for s in first['jobs']['integration']['steps'] if str(s.get('uses','')).startswith('actions/upload-artifact@'));step['with']['name']='shared-diagnostics'
  else:second['concurrency']['cancel-in-progress']=True
  refused=False
  try:ci_isolation(first,second)
  except AssertionError:refused=True
  assert refused
 report['checks'].append('parallel revision isolation binds hosted runners, SHA-only publications/artifacts and the complete security/integration DAG; four unsafe variants refused')
 report['parallelRevisionIsolationVerified']=True;report['unsafeCiVariantsRefused']=4
 (output/'fixture-values.json').write_text(json.dumps(values),encoding='utf-8')
 run(['helm','lint','--strict','-f','/out/fixture-values.json','/src/charts/agenttrust-review'],'helm-lint');report['checks'].append('Helm strict lint')
 rendered=run(['helm','template','agenttrust-review','/src/charts/agenttrust-review','--namespace','agenttrust-review','--kube-version','1.34.0','-f','/out/fixture-values.json'],'helm-render');(output/'rendered.yaml').write_text(rendered,encoding='utf-8');documents=list(yaml.safe_load_all(rendered));assert all(isinstance(doc,dict) for doc in documents)
 deployments=[doc for doc in documents if doc['kind']=='Deployment'];assert len(deployments)==6
 for doc in deployments:
  spec=doc['spec']['template']['spec'];container=spec['containers'][0];security=container['securityContext'];assert doc['spec']['replicas']==1 and spec['automountServiceAccountToken'] is False and spec['securityContext']['runAsNonRoot'] and spec['securityContext']['seccompProfile']['type']=='RuntimeDefault' and security['readOnlyRootFilesystem'] and security['allowPrivilegeEscalation'] is False and security['capabilities']['drop']==['ALL']
  assert container['resources']['requests'] and container['resources']['limits'] and container['readinessProbe'] and container['startupProbe'] and container['image']==values['images'][container['name']] and all(not v.get('hostPath') for v in spec['volumes']) and not spec.get('hostNetwork')
  assert all(not ('PASSWORD' in entry['name'] and 'value' in entry) for entry in container.get('env',[]))
 by_name={doc['spec']['template']['spec']['containers'][0]['name']:doc['spec']['template']['spec']['containers'][0] for doc in deployments}
 console=by_name['console'];core=by_name['core-api']
 for container,prefix in [(console,'NEXT_PUBLIC_STACK_'),(core,'AGENTTRUST_OIDC_'),(by_name['gateway'],'AGENTTRUST_OIDC_')]:
  environment={entry['name']:entry.get('value') for entry in container['env']}
  expected={'PROFILE':'local-review','APPLICATION_ORIGIN':'http://127.0.0.1:4320','PUBLIC_ISSUER':'http://127.0.0.1:4322/realms/agenttrust'}
  for key,value in expected.items():assert environment[prefix+('OIDC_PROFILE' if prefix=='NEXT_PUBLIC_STACK_' and key=='PROFILE' else key)]==value
 for probe in ['startupProbe','readinessProbe']:
  assert console[probe]['httpGet']['httpHeaders']==[{'name':'Host','value':'127.0.0.1:4320'}]
 report['checks'].append('local OIDC contract pinned in all three workloads; console health probes use allowed Host')
 assert not any(doc['kind'] in ['Secret','Ingress','PersistentVolume','PersistentVolumeClaim'] for doc in documents)
 services=[doc for doc in documents if doc['kind']=='Service'];assert len(services)==11 and all(doc['spec']['type'] in ['ClusterIP','ExternalName'] for doc in services)
 policies=[doc for doc in documents if doc['kind']=='NetworkPolicy'];assert len(policies)==18 and any(doc['metadata']['name']=='agenttrust-default-deny' and doc['spec']['policyTypes']==['Ingress','Egress'] for doc in policies)
 report['checks'].append('six bounded non-root workloads and internal network/secret references')
 validation=json.loads(run(['kubeconform','-strict','-summary','-output','json','-kubernetes-version','1.34.0','-schema-location',schema,'/out/rendered.yaml'],'kubernetes-schema'));assert validation['summary']['valid']==len(documents) and validation['summary']['invalid']==validation['summary']['errors']==validation['summary']['skipped']==0;report['validatedResources']=len(documents);report['checks'].append('pinned Kubernetes schemas; no missing-schema exemptions')
 core_deployment=next(d for d in deployments if d['metadata']['name']=='stack-core-api')
 base_keys={i['key'] for v in core_deployment['spec']['template']['spec']['volumes'] if 'secret' in v for i in v['secret']['items']}
 assert not {'stack-gate-key-pair','stack-gate-retired-keys'}&base_keys
 assert next(e['value'] for e in core['env'] if e['name']=='STACK_GATE_SIGNING_MODE')=='disabled'
 report['signingProfiles']=[]
 for profile,history in [('development-active-key',False),('development-public-history',True)]:
  variant=copy.deepcopy(values);variant['signing']={'mode':'local-development','historyEnabled':history}
  path=output/(profile+'.json');path.write_text(json.dumps(variant),encoding='utf-8')
  raw=run(['helm','template','agenttrust-review','/src/charts/agenttrust-review','--namespace','agenttrust-review','--kube-version','1.34.0','-f',str(path)],profile)
  rendered_path=output/(profile+'.yaml');rendered_path.write_text(raw,encoding='utf-8');frames=list(yaml.safe_load_all(raw));assert len(frames)==36 and not any(f['kind']=='Secret' for f in frames)
  for frame in (f for f in frames if f['kind']=='Deployment'):
   pod=frame['spec']['template']['spec'];container=pod['containers'][0]
   keys={i['key'] for v in pod['volumes'] if 'secret' in v for i in v['secret']['items']}
   if container['name']=='core-api':
    expected=base_keys|{'stack-gate-key-pair'}|({'stack-gate-retired-keys'} if history else set());assert keys==expected
    env={e['name']:e.get('value') for e in container['env']};assert env['STACK_GATE_SIGNING_MODE']=='local-development'
    assert (env.get('STACK_GATE_RETIRED_KEYS_FILE')=='/run/secrets/stack-gate-retired-keys') is history
    secret=next(v['secret'] for v in pod['volumes'] if 'secret' in v);assert secret['defaultMode']==0o440 and pod['securityContext']['fsGroup']==10001
    assert next(v for v in container['volumeMounts'] if v['name']=='credentials')['readOnly'] is True
   else:assert not {'stack-gate-key-pair','stack-gate-retired-keys'}&keys
  checked=json.loads(run(['kubeconform','-strict','-summary','-output','json','-kubernetes-version','1.34.0','-schema-location',schema,str(rendered_path)],profile+'-schema'))
  assert checked['summary']['valid']==36 and checked['summary']['invalid']==checked['summary']['errors']==checked['summary']['skipped']==0
  report['signingProfiles'].append({'profile':profile,'validatedResources':36,'privateKeyMountedOnlyIntoCore':True,'historyEnabled':history,'secretValuesGenerated':False})
 report['totalResourcesValidatedAcrossProfiles']=108;report['checks'].append('default signing disabled; optional active key/public history mounted read-only only into Core; all three profiles pass strict schemas')
 for name in ['mutable-tag','public-production','external-dependency','unknown-setting','history-with-disabled-signing','production-signing','string-history-boolean','caller-selected-key-path']:
  invalid=copy.deepcopy(values)
  if name=='mutable-tag':invalid['images']['core-api']='ghcr.io/automaster5013/agenttrust-core-api:main'
  elif name=='public-production':invalid['mode']='production'
  elif name=='external-dependency':invalid['dependencies']['postgres']='outside.invalid'
  elif name=='unknown-setting':invalid['hostNetwork']=True
  elif name=='history-with-disabled-signing':invalid['signing']={'mode':'disabled','historyEnabled':True}
  elif name=='production-signing':invalid['signing']={'mode':'production','historyEnabled':False}
  elif name=='string-history-boolean':invalid['signing']={'mode':'local-development','historyEnabled':'true'}
  else:invalid['signing']={'mode':'local-development','historyEnabled':True,'keyPath':'/outside/private-key'}
  path=output/(name+'.json');path.write_text(json.dumps(invalid),encoding='utf-8');run(['helm','template','agenttrust-review','/src/charts/agenttrust-review','-f',str(path)],name,expected=1)
 report['checks'].append('mutable image, production mode/signing, external dependency, invalid history and caller key paths rejected')
 # The public module and downloaded providers are ephemeral container memory, not host reports.
 work=tempfile.TemporaryDirectory(prefix='agenttrust-terraform-',dir='/tmp');tf=pathlib.Path(work.name)/'review';tf.mkdir()
 for name in ['main.tf','variables.tf','review.tftest.hcl','.terraform.lock.hcl']:
  public=source/'terraform/review'/name
  if public.is_symlink() or not public.is_file() or public.stat().st_size>1048576:raise ValueError('Public module input unavailable')
  shutil.copyfile(public,tf/name)
 budget={}
 for category in ['limits','requests']:
  budget[category+'CpuMilli']=sum(cpu_milli(c['resources'][category]['cpu']) for c in by_name.values())
  budget[category+'MemoryBytes']=sum(memory_bytes(c['resources'][category]['memory']) for c in by_name.values())
 (tf/'rendered-resource-budget.json').write_text(json.dumps(budget),encoding='utf-8');report['renderedResourceBudget']=budget
 report['terraformInputs']='four-public-module-files-and-generated-public-render-budget-only'
 run(['terraform','fmt','-check','-recursive','-no-color'], 'terraform-format',cwd=tf)
 run(['terraform','init','-backend=false','-input=false','-lockfile=readonly','-no-color'],'terraform-init',cwd=tf)
 run(['terraform','validate','-no-color'],'terraform-validate',cwd=tf);report['checks'].append('Terraform pinned providers and module validation')
 run(['terraform','test','-no-color'],'terraform-mock-plans',cwd=tf);report['checks'].append('seven mocked Terraform plans including actual rendered quota coverage, development key references and negative input boundaries')
 report['completed']=True
except Exception as error:report['errorType']=type(error).__name__
finally:
 try:
  if work is not None:work.cleanup()
  report['temporaryTerraformWorkRemoved']=True
 except Exception as error:report.update(completed=False,temporaryTerraformWorkRemoved=False,errorType=type(error).__name__)
 (output/'summary.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print(json.dumps(report))
if not report['completed']:raise SystemExit(1)
