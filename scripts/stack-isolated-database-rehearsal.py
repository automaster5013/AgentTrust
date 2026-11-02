"""Recover SYNTHETIC schema/data between owned memory-only DB fixtures.
No operational DB is dumped, stopped, restored or mounted. Not an operating backup.
"""
import argparse,datetime,hashlib,importlib.util,json,pathlib,secrets,subprocess,sys,time,uuid
from stack_image_identity import cached_identity
ROOT=pathlib.Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('db_evidence',ROOT/'scripts/stack-local-cd-evidence.py');e=importlib.util.module_from_spec(spec);spec.loader.exec_module(e)

def run(args,data=None,timeout=90,check=True):
 result=subprocess.run(args,cwd=ROOT,input=data,capture_output=True,timeout=timeout)
 if check:e.require(result.returncode==0)
 return result

def fixture_command(reference,name,identifier):
 e.require(e.re.fullmatch('docker.io/automaster5013/agenttrust-database@sha256:[a-f0-9]{64}',reference))
 e.require(str(uuid.UUID(identifier))==identifier and name in ('agenttrust-cd-db-'+identifier+'-source','agenttrust-cd-db-'+identifier+'-restore'))
 return ['docker','run','--rm','-d','--name',name,'--label','agenttrust.fixture='+identifier,'--network','none','--log-driver','local',
         '--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--user','70:70',
         '--memory','384m','--cpus','1','--pids-limit','128',
         '--tmpfs','/var/lib/postgresql/data:size=128m,uid=70,gid=70,mode=0700',
         '--tmpfs','/var/run/postgresql:size=16m,uid=70,gid=70,mode=3775','--tmpfs','/tmp:size=32m,mode=1777',
         '-e','POSTGRES_DB=agenttrust_fixture','-e','POSTGRES_USER=agenttrust_fixture','-e','POSTGRES_HOST_AUTH_METHOD=trust',reference]

def sql(name,statement):
 e.require(e.re.fullmatch('agenttrust-cd-db-[a-f0-9-]{36}-(source|restore)',name))
 return run(['docker','exec','-i',name,'psql','-X','-q','-U','agenttrust_fixture','-d','agenttrust_fixture','-v','ON_ERROR_STOP=1','-At'],statement.encode()).stdout.decode().strip()

def wait(name):
 until=time.monotonic()+90
 while time.monotonic()<until:
  ready=run(['docker','exec',name,'pg_isready','-U','agenttrust_fixture','-d','agenttrust_fixture'],check=False)
  logs=run(['docker','logs',name],check=False)
  if ready.returncode==0 and b'PostgreSQL init process complete; ready for start up.' in logs.stdout+logs.stderr:return
  time.sleep(.25)
 raise TimeoutError('Owned fixture initialization timed out')

def inspect(name):return json.loads(run(['docker','inspect',name]).stdout)[0]

def isolation(row,identifier):
 e.require(row['Config']['Labels'].get('agenttrust.fixture')==identifier)
 e.require(row['HostConfig']['NetworkMode']=='none' and not row['HostConfig'].get('PortBindings') and row['HostConfig']['ReadonlyRootfs'])
 e.require(not row['Mounts'] and row['Config']['User']=='70:70')

def fingerprint(name):
 query="SELECT count(*)::text||'|'||encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY id),''),'UTF8')),'hex') FROM stack_audit t;"
 return sql(name,query)

def recover(config,execute,report):
 ids=e.planner.running_ids();inventory=e.planner.summarize(json.loads(e.planner.docker(['inspect',*ids])));hashes=e.planner.compose_hashes(inventory,ROOT)
 release=e.verify_candidate_release(config,config['revision'],inventory,{})
 reference=next(r['reference'] for r in release['receipt']['images'] if r['name']=='database')
 if not execute:return
 from cryptography.hazmat.primitives.ciphers.aead import AESGCM
 from cryptography.exceptions import InvalidTag
 run(['docker','pull',reference],timeout=300)
 image=json.loads(run(['docker','image','inspect',reference]).stdout)[0]
 identity=json.loads((release['directory']/'runtime-identity.json').read_bytes())['imageIds']['database'];cached_identity(image,reference,identity)
 identifier=str(uuid.uuid4());source='agenttrust-cd-db-'+identifier+'-source';target='agenttrust-cd-db-'+identifier+'-restore';owned=[]
 try:
  for name in (source,target):
   owned.append(name);run(fixture_command(reference,name,identifier));wait(name);isolation(inspect(name),identifier)
   sql(name,'CREATE ROLE agenttrust_stack_api NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;')
  catalog=e.migration_catalog(config['revision'])
  for row in catalog:
   raw=e.command(['git','show',config['revision']+':'+e.MIGRATIONS+row['script']])
   sql(source,raw.decode('utf-8-sig'))
  org,project,foreign_org,foreign_project=[str(uuid.uuid4()) for _ in range(4)]
  for i in range(3):
   own=i<2;o,p=(org,project) if own else (foreign_org,foreign_project)
   values=[str(uuid.uuid4()),o,p,str(uuid.uuid4()),'fixture-recovery',str(uuid.uuid4())]
   sql(source,"INSERT INTO stack_audit(id,organization_id,project_id,actor_id,action,resource_id) VALUES("+','.join("'"+v+"'" for v in values)+');')
  before=fingerprint(source)
  dump=run(['docker','exec',source,'pg_dump','-U','agenttrust_fixture','-d','agenttrust_fixture','-Fc','--no-owner','--no-password']).stdout
  e.require(dump.startswith(b'PGDMP') and 0<len(dump)<=8388608)
  key=secrets.token_bytes(32);nonce=secrets.token_bytes(12);cipher=AESGCM(key).encrypt(nonce,dump,identifier.encode())
  restored=AESGCM(key).decrypt(nonce,cipher,identifier.encode());e.require(restored==dump)
  refused=False
  try:AESGCM(key).decrypt(nonce,cipher[:-1]+bytes([cipher[-1]^1]),identifier.encode())
  except InvalidTag:refused=True
  e.require(refused)
  run(['docker','exec','-i',target,'pg_restore','-U','agenttrust_fixture','-d','agenttrust_fixture','--no-owner','--exit-on-error'],restored)
  e.require(fingerprint(target)==before and fingerprint(source)==before)
  policy="SELECT coalesce(json_agg(t ORDER BY tablename,policyname),'[]'::json)::text FROM (SELECT tablename,policyname,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public') t;"
  e.require(sql(target,policy)==sql(source,policy))
  e.require(sql(target,"SELECT '[1,0,0]'::vector <=> '[1,0,0]'::vector;")=='0')
  scoped=sql(target,"BEGIN; SET LOCAL ROLE agenttrust_stack_api; SELECT count(*) FROM stack_audit; SET LOCAL agenttrust.organization_id='"+org+"'; SET LOCAL agenttrust.project_id='"+project+"'; SELECT count(*) FROM stack_audit; ROLLBACK;").splitlines()
  e.require(scoped==['0','2'])
  report.update(candidateRevision=config['revision'],syntheticDataFingerprint=before,sqlMigrationsExecuted=len(catalog),flywayEngineExecuted=False,syntheticAuditRows=3,syntheticDatabaseRecoveryVerified=True,
                rowFingerprintsEqual=True,rlsPoliciesEqual=True,unscopedAndForeignRowsHidden=True,pgvectorQueryVerified=True,tamperedCiphertextRefused=True,
                plaintextBackupWrittenToHost=False,persistentVolumesCreated=False)
 finally:
  cleanup=True
  for name in reversed(owned):
   query=run(['docker','inspect',name],check=False)
   if query.returncode:continue
   row=json.loads(query.stdout)[0]
   if row['Config']['Labels'].get('agenttrust.fixture')!=identifier:cleanup=False;continue
   if run(['docker','rm','-f',row['Id']],check=False).returncode:cleanup=False
  report['ownedFixturesRemoved']=cleanup;e.require(cleanup)
 e.planner.recheck(ids,inventory,ROOT,hashes)
 e.require(e.delivery.validate(release['directory'],config['revision'],config['checksumsSha256'],config['repository'])==(release['directory'],release['identity'],release['records']))

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--config',type=pathlib.Path,required=True);p.add_argument('--expected-config-sha256',required=True);p.add_argument('--output',type=pathlib.Path,required=True);p.add_argument('--execute',action='store_true');args=p.parse_args()
 output_allowed=False
 report={'completed':False,'operationalServicesChanged':False,'operationalDatabaseDumped':False,'operationalBackupVerified':False,'fullStackRecoveryVerified':False,'actualDeploymentPerformed':False}
 try:
  output=args.output.resolve();e.require(pathlib.Path.cwd().resolve()==ROOT and output.is_relative_to((ROOT/'.local').resolve()) and not output.exists())
  output_allowed=True
  config=e.delivery.json_bytes(e.anchored_file(args.config,args.expected_config_sha256));recover(config,args.execute,report)
  e.anchored_file(args.config,args.expected_config_sha256);report.update(completed=True,executed=args.execute)
 except Exception as error:report.update(completed=False,code='SYNTHETIC_DB_RECOVERY_UNVERIFIED',errorType=type(error).__name__)
 if not output_allowed:
  print(json.dumps(report));return 1
 output.parent.mkdir(parents=True,exist_ok=True)
 with output.open('x',encoding='utf-8') as handle:handle.write(json.dumps(report,indent=2)+'\n')
 print(json.dumps(report));return 0 if report['completed'] else 1
if __name__=='__main__':sys.exit(main())
