"""Render/validate with synthetic values and mocked providers. Never reads a kubeconfig or calls a cluster."""
import copy,hashlib,json,pathlib,shutil,subprocess,yaml
source=pathlib.Path('/src');output=pathlib.Path('/out');report={'completed':False,'checks':[],'clusterContacted':False,'resourcesApplied':False,'credentialsMounted':False}
schema='https://raw.githubusercontent.com/yannh/kubernetes-json-schema/5f1fa4f7908afc9b6641c62d282a4a22437626e1/{{.NormalizedKubernetesVersion}}-standalone{{.StrictSuffix}}/{{.ResourceKind}}{{.KindSuffix}}.json'
names=['core-api','ai-worker','gateway','console','opa'];values={'mode':'local-review','revision':'1'*40,'existingSecret':'agenttrust-stack-config','images':{name:'ghcr.io/automaster5013/agenttrust-'+name+'@sha256:'+'1'*64 for name in names},'dependencies':{'namespace':'agenttrust-dependencies',**{name:name.lower()+'.agenttrust-dependencies.svc.cluster.local' for name in ['postgres','nats','redis','identity','objectStore']}}}
def run(command,name,expected=0,cwd=None):
 result=subprocess.run(command,capture_output=True,text=True,timeout=300,cwd=cwd);(output/(name+'.log')).write_text(result.stdout+'\n'+result.stderr,encoding='utf-8');assert result.returncode==expected
 return result.stdout
try:
 (output/'fixture-values.json').write_text(json.dumps(values),encoding='utf-8')
 run(['helm','lint','--strict','-f','/out/fixture-values.json','/src/charts/agenttrust-review'],'helm-lint');report['checks'].append('Helm strict lint')
 rendered=run(['helm','template','agenttrust-review','/src/charts/agenttrust-review','--namespace','agenttrust-review','--kube-version','1.34.0','-f','/out/fixture-values.json'],'helm-render');(output/'rendered.yaml').write_text(rendered,encoding='utf-8');documents=list(yaml.safe_load_all(rendered));assert all(isinstance(doc,dict) for doc in documents)
 deployments=[doc for doc in documents if doc['kind']=='Deployment'];assert len(deployments)==5
 for doc in deployments:
  spec=doc['spec']['template']['spec'];container=spec['containers'][0];security=container['securityContext'];assert doc['spec']['replicas']==1 and spec['automountServiceAccountToken'] is False and spec['securityContext']['runAsNonRoot'] and spec['securityContext']['seccompProfile']['type']=='RuntimeDefault' and security['readOnlyRootFilesystem'] and security['allowPrivilegeEscalation'] is False and security['capabilities']['drop']==['ALL']
  assert container['resources']['requests'] and container['resources']['limits'] and container['readinessProbe'] and container['startupProbe'] and container['image']==values['images'][container['name']] and all(not v.get('hostPath') for v in spec['volumes']) and not spec.get('hostNetwork')
  assert all(not ('PASSWORD' in entry['name'] and 'value' in entry) for entry in container.get('env',[]))
 assert not any(doc['kind'] in ['Secret','Ingress','PersistentVolume','PersistentVolumeClaim'] for doc in documents)
 services=[doc for doc in documents if doc['kind']=='Service'];assert len(services)==10 and all(doc['spec']['type'] in ['ClusterIP','ExternalName'] for doc in services)
 policies=[doc for doc in documents if doc['kind']=='NetworkPolicy'];assert len(policies)==16 and any(doc['metadata']['name']=='agenttrust-default-deny' and doc['spec']['policyTypes']==['Ingress','Egress'] for doc in policies)
 report['checks'].append('five bounded non-root workloads and internal network/secret references')
 validation=json.loads(run(['kubeconform','-strict','-summary','-output','json','-kubernetes-version','1.34.0','-schema-location',schema,'/out/rendered.yaml'],'kubernetes-schema'));assert validation['summary']['valid']==len(documents) and validation['summary']['invalid']==validation['summary']['errors']==validation['summary']['skipped']==0;report['validatedResources']=len(documents);report['checks'].append('pinned Kubernetes schemas; no missing-schema exemptions')
 for name in ['mutable-tag','public-production','external-dependency','unknown-setting']:
  invalid=copy.deepcopy(values)
  if name=='mutable-tag':invalid['images']['core-api']='ghcr.io/automaster5013/agenttrust-core-api:main'
  elif name=='public-production':invalid['mode']='production'
  elif name=='external-dependency':invalid['dependencies']['postgres']='outside.invalid'
  else:invalid['hostNetwork']=True
  path=output/(name+'.json');path.write_text(json.dumps(invalid),encoding='utf-8');run(['helm','template','agenttrust-review','/src/charts/agenttrust-review','-f',str(path)],name,expected=1)
 report['checks'].append('mutable image, production mode, external dependency and unknown field rejected')
 tf=output/'terraform';shutil.copytree(source/'terraform/review',tf)
 run(['terraform','fmt','-check','-recursive','-no-color'], 'terraform-format',cwd=tf)
 run(['terraform','init','-backend=false','-input=false','-lockfile=readonly','-no-color'],'terraform-init',cwd=tf)
 run(['terraform','validate','-no-color'],'terraform-validate',cwd=tf);report['checks'].append('Terraform pinned providers and module validation')
 run(['terraform','test','-no-color'],'terraform-mock-plans',cwd=tf);report['checks'].append('four mocked Terraform plans including negative input boundaries')
 report['completed']=True
except Exception as error:report['errorType']=type(error).__name__
finally:
 (output/'summary.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print(json.dumps(report))
if not report['completed']:raise SystemExit(1)
