"""Prepare an owner-reviewed release plan; execute only with fresh recovery evidence and approval.
Default mode is read-only. Never invoke --execute under a keep-running instruction.
"""
import argparse,datetime,hashlib,importlib.util,json,pathlib,subprocess,sys,types,uuid
from stack_image_identity import cached_identity
from stack_local_cd_executor import ORDER,STATEFUL,compose_apply_command,environment_matches,live_layout_matches,transition,validate_approval
ROOT=pathlib.Path(__file__).resolve().parent.parent

def load(name,file):
 spec=importlib.util.spec_from_file_location(name,ROOT/'scripts'/file);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

e=load('deployment_evidence','stack-local-cd-evidence.py');r=load('deployment_review','stack-local-cd-reconcile.py')

def command(args,timeout=180):
 result=subprocess.run(args,cwd=ROOT,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=timeout)
 e.require(result.returncode==0);return result.stdout

def hash_files(paths):
 result={}
 for value in paths:
  path=pathlib.Path(value).resolve();e.require(path.is_relative_to(ROOT) and path.is_file() and not path.is_symlink() and 0<path.stat().st_size<=1048576)
  result[str(path)]=hashlib.sha256(path.read_bytes()).hexdigest()
 return result

def live_baseline():
 ids=e.planner.running_ids();raw=json.loads(e.planner.docker(['inspect',*ids]));inventory=e.planner.summarize(raw)
 by_service={item['Config']['Labels']['com.docker.compose.service']:item for item in raw}
 return ids,raw,inventory,by_service

def resolved_groups(inventory,by_service,services):
 groups=[];protected=[]
 for group in e.planner.runtime_file_groups(inventory):
  selected=[s for s in group['services'] if s in services]
  if not selected:continue
  envs=by_service[selected[0]]['Config']['Labels'].get('com.docker.compose.project.environment_file','').split(',')
  e.require(envs and all(envs))
  e.require(all(by_service[s]['Config']['Labels'].get('com.docker.compose.project.environment_file','').split(',')==envs for s in selected))
  args=['docker','compose','--project-name','agenttrust']
  for file in envs:args+=['--env-file',file]
  for file in group['filesInOrder']:args+=['-f',file]
  model=json.loads(command(args+['config','--format','json']))
  for service in selected:protected+=live_layout_matches(model['services'][service],model,by_service[service])
  groups.append({'services':selected,'filesInOrder':group['filesInOrder'],'environmentFiles':envs})
  protected+=envs
 return groups,hash_files(protected)

def prepare(config_path,config_hash,services):
 config=e.delivery.json_bytes(e.anchored_file(config_path,config_hash))
 ids,raw,inventory,by_service=live_baseline();hashes=e.planner.compose_hashes(inventory,ROOT)
 groups,protected=resolved_groups(inventory,by_service,services)
 ledger=e.live_ledger();e.same_schema(e.migration_catalog(config['revision']),ledger)
 release=e.verify_candidate_release(config,config['revision'],inventory,{})
 override=r.candidate_review_override(release['plan'],inventory)
 e.planner.recheck(ids,inventory,ROOT,hashes);e.require(hash_files(protected)==protected and e.live_ledger()==ledger)
 return {'schemaVersion':1,'completed':True,'readOnly':True,'automaticDeploymentAllowed':False,'kind':'owner-local-deployment-plan','createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
         'configPath':str(pathlib.Path(config_path).resolve()),'configSha256':config_hash,'revision':config['revision'],
         'services':services,'inventory':inventory,'groups':groups,'composeFileSha256':hashes,'protectedFileSha256':protected,
         'candidateOverride':override,'rollbackOverride':r.review_baseline_override(inventory),'ledger':ledger,
         'allowServiceRecreation':False,'actualDeploymentPerformed':False,
         'pending':['fresh-authenticated-development-recovery','operator-approval-and-maintenance-window','isolated-full-stack-rehearsal']}

def execute(plan,plan_hash,approval,state=None):
 state=state if state is not None else {"mutationMayHaveStarted":False,"actualDeploymentPerformed":False}
 now=datetime.datetime.now(datetime.timezone.utc);validate_approval(approval,plan_hash,plan['services'],now)
 config_path=pathlib.Path(plan['configPath']);config=e.delivery.json_bytes(e.anchored_file(config_path,plan['configSha256']))
 # No mutation is reachable until all real signed/snapshot/recovery checks complete.
 evidence={};e.run(types.SimpleNamespace(expected_revision=plan['revision'],evidence_config=config_path,expected_config_sha256=plan['configSha256']),evidence)
 e.require(evidence.get('completed') is True and evidence.get('retainedDevelopmentRecoveryEvidenceBound') is True and evidence.get('currentSourceConfigurationBound') is True)
 proof=e.delivery.json_bytes(e.anchored_file(approval['isolatedFullStackProof'],approval['isolatedFullStackProofSha256']))
 e.require(proof['completed'] is True and proof['revision']==plan['revision'] and proof['fullStackRecoveryVerified'] is True)
 e.require(proof['candidateImages']=={s:v['image'] for s,v in plan['candidateOverride']['services'].items() if s in ORDER})
 ids,raw,before,by_service=live_baseline();e.require(before==plan['inventory'])
 groups,protected=resolved_groups(before,by_service,plan['services'])
 e.require(groups==plan['groups'] and protected==plan['protectedFileSha256'])
 e.require(e.planner.compose_hashes(before,ROOT)==plan['composeFileSha256'] and e.live_ledger()==plan['ledger'])
 release=e.verify_candidate_release(config,plan['revision'],before,{})
 e.require(r.candidate_review_override(release['plan'],before)==plan['candidateOverride'])
 expected_ids={};runtime=json.loads((release['directory']/'runtime-identity.json').read_bytes())['imageIds']
 for service in plan['services']:
  reference=plan['candidateOverride']['services'][service]['image'];command(['docker','pull',reference],600)
  image=json.loads(command(['docker','image','inspect',reference]))[0]
  component=next(row['name'] for row in release['receipt']['images'] if row['reference']==reference)
  cached_identity(image,reference,runtime[component]);expected_ids[service]=image['Id']
 directory=ROOT/'.local'/('deployment-'+str(uuid.uuid4()));directory.mkdir()
 paths={}
 for mode,key in [('candidate','candidateOverride'),('rollback','rollbackOverride')]:
  path=directory/(mode+'.compose.json');path.write_text(json.dumps(plan[key]),encoding='utf-8');paths[mode]=path
 journal=[]
 def record(event):
  journal.append(event)
  with (directory/('event-'+str(len(journal)).zfill(4)+'.json')).open('x',encoding='utf-8') as handle:handle.write(json.dumps(event)+'\n')
 def checkpoint(touched):
  names=e.planner.docker(['ps','--filter','label=com.docker.compose.project=agenttrust','--format','{{.Label "com.docker.compose.service"}}']).splitlines()
  e.require(len(names)==len(set(names)) and set(names)<=set(before))
  e.require(hash_files(plan['protectedFileSha256'])==plan['protectedFileSha256'])
  e.require(e.planner.compose_hashes(before,ROOT)==plan['composeFileSha256'])
  untouched=[s for s in before if s not in touched]
  current=json.loads(command(['docker','inspect',*[before[s]['containerId'] for s in untouched]])) if untouched else []
  # Substitute only acknowledged target entries to compare unchanged services; target health is checked separately.
  masked=current+[by_service[s] for s in touched]
  e.require(e.planner.summarize(masked)==before)
  e.require(e.live_ledger()==plan['ledger'])
 def apply(service,rollback):
  if not rollback:validate_approval(approval,plan_hash,plan['services'],datetime.datetime.now(datetime.timezone.utc))
  group=next(g for g in groups if service in g['services']);mode='rollback' if rollback else 'candidate'
  state['mutationMayHaveStarted']=True
  state['journalDirectory']=str(directory)
  record({'service':service,'action':mode,'state':'starting'})
  command(compose_apply_command(ROOT,group['filesInOrder'],group['environmentFiles'],paths[mode],service),180)
 def verify(service,rollback,touched):
  item=json.loads(command(['docker','inspect','agenttrust-'+service+'-1']))[0]
  e.require(item['State'].get('Health',{}).get('Status')=='healthy' and item['State']['Running'])
  e.require(item['Image']==(before[service]['rollbackImageId'] if rollback else expected_ids[service]))
  e.require(item['HostConfig']['RestartPolicy']['Name']=='unless-stopped')
  state['actualDeploymentPerformed']=True
  checkpoint(touched);record({'service':service,'state':'healthy','rollback':rollback})
 result=transition(plan['services'],apply,verify,checkpoint)
 result.update(actualDeploymentPerformed=state['actualDeploymentPerformed'],mutationMayHaveStarted=state['mutationMayHaveStarted'],operationalBackupVerified=False,scope='approved-owner-local-development',journalDirectory=str(directory))
 return result

def main():
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--output',type=pathlib.Path,required=True);parser.add_argument('--config',type=pathlib.Path);parser.add_argument('--expected-config-sha256')
 parser.add_argument('--service',action='append',choices=ORDER);parser.add_argument('--execute',action='store_true')
 parser.add_argument('--plan',type=pathlib.Path);parser.add_argument('--expected-plan-sha256');parser.add_argument('--approval',type=pathlib.Path);parser.add_argument('--expected-approval-sha256')
 args=parser.parse_args();report={'completed':False,'actualDeploymentPerformed':False};state={'actualDeploymentPerformed':False,'mutationMayHaveStarted':False}
 try:
  e.require(pathlib.Path.cwd().resolve()==ROOT);output=args.output.resolve();e.require(output.is_relative_to((ROOT/'.local').resolve()) and not output.exists())
  if args.execute:
   plan_raw=e.anchored_file(args.plan,args.expected_plan_sha256);plan=e.delivery.json_bytes(plan_raw)
   approval=e.delivery.json_bytes(e.anchored_file(args.approval,args.expected_approval_sha256))
   report=execute(plan,hashlib.sha256(plan_raw).hexdigest(),approval,state)
  else:
   e.require(args.config and args.expected_config_sha256);services=args.service or ORDER
   e.require(len(services)==len(set(services))>0)
   report=prepare(args.config,args.expected_config_sha256,services)
  output.parent.mkdir(parents=True,exist_ok=True)
  with output.open('x',encoding='utf-8') as handle:handle.write(json.dumps(report,indent=2)+'\n')
  print(json.dumps({'completed':report.get('completed',True),'prepared':not args.execute,'actualDeploymentPerformed':report['actualDeploymentPerformed']}));return 0 if report.get('completed',True) else 1
 except Exception:
  print(json.dumps({'completed':False,'code':'CD_DEPLOYMENT_BLOCKED','actualDeploymentPerformed':state['actualDeploymentPerformed'],'mutationMayHaveStarted':state['mutationMayHaveStarted'],'journalDirectory':state.get('journalDirectory'),'note':'Review private journal if mutation was started; no automatic stateful downgrade.'}));return 1

if __name__=='__main__':sys.exit(main())
