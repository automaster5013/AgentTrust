"""Create bounded synthetic immutable versions on a disposable CI installation only."""
import argparse,datetime,json,pathlib,uuid
from stack_test_client import StackClient
ROOT=pathlib.Path(__file__).resolve().parent.parent
p=argparse.ArgumentParser();p.add_argument('--execute',action='store_true');args=p.parse_args()
if not args.execute:raise SystemExit('Explicit --execute required; disposable fixture only.')
report={'completed':False,'synthetic':True,'operatingDeploymentPerformed':False,'paidApiCalls':False,'credentialsRecorded':False};clients=[]
try:
 credentials=json.loads((ROOT/'.local/stack/demo-credentials.json').read_text(encoding='utf-8'));admin=StackClient('http://127.0.0.1:4320',credentials,report,clients);admin.login('demo-admin');suffix=uuid.uuid4().hex[:12];keys={'agents':'version-search-agent-'+suffix,'datasets':'version-search-data-'+suffix}
 for kind,key in keys.items():
  for version in range(1,28):
   body={'key':key,'version':version,**({'provider':'synthetic','description':'Disposable full history search fixture'} if kind=='agents' else {'cases':[{'id':'required-pass','scenario':'pass','required':True}]})};value=admin.request('versions/'+kind,'POST',body);assert value['resource_key']==key and value['version']==version
 report.update(completed=True,keys=keys,versionsPerName=27,registeredVersions=54)
except Exception as error:report.update(errorType=type(error).__name__)
finally:
 closed=True
 for client in reversed(clients):
  try:client.logout()
  except Exception:closed=False
 report.update(ownSessionsLoggedOut=closed,finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat());path=ROOT/'.local/stack-version-history-search-fixture.json'
 with path.open('x',encoding='utf-8') as stream:stream.write(json.dumps(report,indent=2)+'\n')
 print(json.dumps({'completed':report['completed'],'registeredVersions':report.get('registeredVersions'),'ownSessionsLoggedOut':closed,'reportPath':str(path)}))
if not report['completed'] or not closed:raise SystemExit(1)
