import datetime,hashlib,json,pathlib,subprocess,sys,uuid
ROOT=pathlib.Path(__file__).resolve().parent.parent;sys.path.insert(0,str(ROOT/'scripts'))
from stack_test_client import StackClient
from stack_business_fingerprint import fingerprint
report={'completed':False,'checks':[],'credentialsRecorded':False,'businessWritesPerformed':False,'kind':'project-audit-export-offline-check'};clients=[]
try:
 before=fingerprint();credentials=json.loads((ROOT/'.local/stack/demo-credentials.json').read_text(encoding='utf-8'));client=StackClient('http://127.0.0.1:4320',credentials,report,clients);owner=client.login('demo-viewer');frame=client.request('audit-export');raw=frame['contentJson'].encode('utf-8');assert len(raw)==frame['contentBytes']<=262144 and hashlib.sha256(raw).hexdigest()==frame['contentSha256']
 folder=ROOT/'.local'/('audit-offline-export-proof-'+str(uuid.uuid4()));folder.mkdir();path=folder/'audit.json';path.write_bytes(raw)
 base=['node','--experimental-strip-types','scripts/stack-verify-audit-export.ts','--file',str(path),'--sha256',frame['contentSha256'],'--organization',owner['organizationId'],'--project',owner['projectId']]
 result=subprocess.run(base,cwd=ROOT,capture_output=True,text=True,encoding='utf-8',timeout=20);value=json.loads(result.stdout);assert result.returncode==0 and value['completed'] and value['recordCount']==len(json.loads(raw)['entries']) and value['issuerAuthenticated'] is False and value['currentDeploymentAuthority'] is False;report['checks'].append('actual downloaded bytes accepted with separately supplied expected hash and exact scope')
 path.write_bytes(raw+b' ');changed=subprocess.run(base,cwd=ROOT,capture_output=True,text=True,encoding='utf-8',timeout=20);assert changed.returncode==1 and json.loads(changed.stdout)['completed'] is False;report['checks'].append('changed actual bytes refused without original overwrite');path.write_bytes(raw);assert hashlib.sha256(path.read_bytes()).hexdigest()==frame['contentSha256'];assert fingerprint()==before;report['checks'].append('all observed business table fingerprints unchanged');report.update(completed=True,recordCount=value['recordCount'],hasOlderRecords=value['hasOlderRecords'],bundleDirectory=str(folder))
except Exception as error:report.update(errorType=type(error).__name__)
finally:
 closed=True
 for client in reversed(clients):
  try:client.logout()
  except Exception:closed=False
 report['ownSessionsLoggedOut']=closed;report['verifiedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();path=ROOT/'.local'/('stack-audit-export-'+str(uuid.uuid4())+'.json');path.open('x',encoding='utf-8').write(json.dumps(report,indent=2)+'\n');print(json.dumps({'completed':report['completed'],'checks':len(report['checks']),'ownSessionsLoggedOut':closed,'reportPath':str(path),'errorType':report.get('errorType')}))
if not report['completed'] or not closed:raise SystemExit(1)
