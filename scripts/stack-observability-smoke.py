"""Verify real application telemetry and privacy through internal services and authenticated Grafana."""
import argparse,json,pathlib,subprocess,urllib.request,urllib.error,urllib.parse,base64,uuid,datetime,time
from stack_compose import stack_compose
root=pathlib.Path(__file__).resolve().parent.parent
report={'completed':False,'checks':[],'rawSecretsPrinted':False,'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
def run(args):return subprocess.run(args,cwd=root,capture_output=True,text=True,encoding='utf-8',errors='replace',check=True,timeout=180)
try:
 ids=json.loads(run(['docker','network','inspect','agenttrust_stack-backend']).stdout);assert len(ids)==1 and ids[0]['Internal'] is True
 worker=json.loads(run(['docker','inspect','agenttrust-stack-ai-worker-1']).stdout)[0];assert worker['Config']['Labels']['com.docker.compose.project']=='agenttrust' and worker['Config']['Labels']['com.docker.compose.service']=='stack-ai-worker' and worker['State']['Health']['Status']=='healthy'
 probe=run(['docker','run','--rm','--network','agenttrust_stack-backend','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','128m','--pids-limit','32','--mount','type=bind,source='+str(root/'scripts/stack-observability-probe.py')+',target=/probe.py,readonly',worker['Image'],'python','/probe.py']);value=json.loads(probe.stdout);assert value['completed'] and value['privacyCanaryAbsentInTracesLogsMetrics'];report['privacyProbe']=value;report['checks'].append('actual trace log and metric privacy readback')
 secret=(root/'.local/stack/grafana-password').read_text(encoding='utf-8');header='Basic '+base64.b64encode(('admin:'+secret).encode()).decode()
 def grafana(path):
  with urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:4324'+path,headers={'Authorization':header}),timeout=15) as response:raw=response.read(2097153)
  assert len(raw)<=2097152;return json.loads(raw)
 with urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:4324/api/datasources',headers={'Authorization':header}),timeout=10) as response:rows=json.loads(response.read(65537))
 assert {row['uid'] for row in rows}=={'agenttrust-prometheus','agenttrust-tempo','agenttrust-loki'};report['checks'].append('authenticated Grafana provisioning')
 for kind,uid in [('prometheus','agenttrust-prometheus'),('tempo','agenttrust-tempo'),('loki','agenttrust-loki')]:
  with urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:4324/api/datasources/uid/'+uid+'/health',headers={'Authorization':header}),timeout=15) as response:health=json.loads(response.read(65537))
  assert health['status']=='OK';report['checks'].append('Grafana '+kind+' backend healthy')
 deadline=time.monotonic()+30
 while True:
  metrics=grafana('/api/datasources/proxy/uid/agenttrust-prometheus/api/v1/query?'+urllib.parse.urlencode({'query':'agenttrust_evaluations_total{service_name="agenttrust-ai-worker"}'}))
  if metrics.get('data',{}).get('result'):break
  assert time.monotonic()<deadline;time.sleep(1)
 assert sum(float(row['value'][1]) for row in metrics['data']['result'])>0;report['checks'].append('actual Python evaluations exported as metrics')
 logs=grafana('/api/datasources/proxy/uid/agenttrust-loki/loki/api/v1/query_range?'+urllib.parse.urlencode({'query':'{service_name="agenttrust-ai-worker"}','limit':'20'}));assert logs['data']['result'] and all(line[1]=='application event' for row in logs['data']['result'] for line in row['values']);report['checks'].append('actual evaluator logs contain only fixed body')
 traces=grafana('/api/datasources/proxy/uid/agenttrust-tempo/api/search?'+urllib.parse.urlencode({'q':'{resource.service.name="agenttrust-core-api"} && {resource.service.name="agenttrust-gateway"}','limit':'20'}));assert traces.get('traces')
 joined=False
 for entry in traces['traces']:
  trace=grafana('/api/datasources/proxy/uid/agenttrust-tempo/api/traces/'+entry['traceID']);resources=trace.get('batches',trace.get('resourceSpans',[]));services={attribute['value'].get('stringValue') for batch in resources for attribute in batch.get('resource',{}).get('attributes',[]) if attribute['key']=='service.name'}
  if {'agenttrust-core-api','agenttrust-gateway'}.issubset(services):joined=True;break
 assert joined;report['checks'].append('real Gateway and Core share an exported trace')
 dashboard=grafana('/api/dashboards/uid/agenttrust-overview');assert dashboard['meta']['provisioned'] and len(dashboard['dashboard']['panels'])==4;report['checks'].append('four operational panels provisioned')
 report['completed']=True
except Exception as error:
 report['errorType']=type(error).__name__
 if isinstance(error,urllib.error.HTTPError):report['unexpectedHttpStatus']=error.code
 report['lastVerifiedCheck']=report['checks'][-1] if report['checks'] else None
finally:
 report['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();path=root/'.local'/('stack-observability-smoke-'+str(uuid.uuid4())+'.json');path.open('x',encoding='utf-8').write(json.dumps(report,indent=2)+'\n');print(json.dumps({'completed':report['completed'],'checks':len(report['checks']),'reportPath':str(path),'errorType':report.get('errorType'),'rawSecretsPrinted':False}))
if not report['completed']:raise SystemExit(1)
