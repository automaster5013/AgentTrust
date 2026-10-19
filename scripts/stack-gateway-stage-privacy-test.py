"""Exercise the actual Collector metric processors in an owned isolated instance."""
import ctypes,datetime,hashlib,json,os,pathlib,re,secrets,shutil,subprocess,time,uuid

root=pathlib.Path(__file__).resolve().parent.parent
folder=root/'.local'/('gateway-stage-privacy-'+uuid.uuid4().hex);folder.mkdir()
report={'completed':False,'phase':'resource-preflight','checks':[],'originalServicesModified':False,'syntheticFixtureIsApplicationPerformance':False,'rawUrlsBodiesErrorsOrSecretsPrinted':False,'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
name='agenttrust-stage-privacy-'+secrets.token_hex(6);nonce=secrets.token_hex(16);created=False;image=None
disk_floor=(22 if os.name=='nt' else 4)*1073741824
until=time.monotonic()+90

def physical():
 if os.name!='nt':return int(next(line.split()[1] for line in pathlib.Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:')))*1024
 class Memory(ctypes.Structure):
  _fields_=[('length',ctypes.c_ulong),('load',ctypes.c_ulong),('total',ctypes.c_ulonglong),('available',ctypes.c_ulonglong),('page',ctypes.c_ulonglong),('availpage',ctypes.c_ulonglong),('virtual',ctypes.c_ulonglong),('availvirtual',ctypes.c_ulonglong),('extended',ctypes.c_ulonglong)]
 memory=Memory();memory.length=ctypes.sizeof(memory);assert ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(memory));return memory.available

def guard(start=False):
 available=physical();free=shutil.disk_usage(root).free
 report['minimumObservedPhysicalBytes']=min(report.get('minimumObservedPhysicalBytes',available),available)
 report['minimumObservedDiskBytes']=min(report.get('minimumObservedDiskBytes',free),free)
 assert available>=(int(2.75*1073741824) if start else 2*1073741824) and free>=disk_floor+512*1048576 and time.monotonic()<until,'RESOURCE_OR_TIME_GUARD'

def run(args,cleanup=False):
 if not cleanup:guard()
 result=subprocess.run(args,cwd=root,capture_output=True,timeout=15)
 assert len(result.stdout)<=262144 and len(result.stderr)<=262144 and result.returncode==0,'OWNED_FIXTURE_COMMAND_UNAVAILABLE'
 if not cleanup:guard()
 return result.stdout.decode('utf-8').strip()

def bindings(cleanup=False):
 ids=sorted(run(['docker','ps','-q','--filter','label=com.docker.compose.project=agenttrust'],cleanup=cleanup).splitlines());assert ids
 return run(['docker','inspect','--format','{{.Id}}|{{.Image}}|{{.State.StartedAt}}|{{.State.Running}}',*ids],cleanup=cleanup)

class FixtureUnavailable(Exception):pass
def request(port_number,path,body=None):
 guard();assert (port_number,path) in [(8889,'/metrics'),(4318,'/v1/metrics')]
 args=['docker','exec',name,'wget','-q','-T','2','-O','-']
 if body is not None:args+=['--header=Content-Type:application/json','--post-data='+json.dumps(body)]
 args+=['http://127.0.0.1:'+str(port_number)+path]
 result=subprocess.run(args,cwd=root,capture_output=True,timeout=5);guard()
 assert len(result.stdout)<=2097152 and len(result.stderr)<=262144
 if result.returncode!=0:raise FixtureUnavailable()
 return result.stdout.decode('utf-8')

def poll(operation,accept):
 while True:
  guard()
  try:
   result=operation()
   if accept(result):return result
  except (FixtureUnavailable,TimeoutError):pass
  time.sleep(.25)

def attribute(key,value):return {'key':key,'value':{'stringValue':value}}

try:
 guard(True);before=bindings();report['originalRuntimeBeforeSha256']=hashlib.sha256(before.encode()).hexdigest()
 image=run(['docker','inspect','--format','{{.Image}}','agenttrust-stack-otel-1']);assert image.startswith('sha256:') and len(image)==71
 source=root/'infra/stack-observability/collector.yaml';source_bytes=source.read_bytes();source_text=source_bytes.decode('utf-8')
 # Use the exact source metric processors, without application trace/log
 # exporters or persistent backends. Only this instance receives the fixtures.
 # Copy exact YAML section text rather than introducing a host YAML package.
 # Changed section structure fails closed and actual Collector startup validates it.
 assert all(source_text.count('\n'+section+':\n')==1 for section in ['processors','exporters','extensions','service'])
 receiver_text,rest=source_text.split('processors:\n',1);processor_text,rest=rest.split('exporters:\n',1)
 exporter_text=rest.split('extensions:\n',1)[0];assert exporter_text.count('  prometheus:\n')==1
 prometheus_text=exporter_text.split('  prometheus:\n',1)[1];assert not re.search(r'^  [a-z]',prometheus_text,re.M)
 metric_text=source_text.split('\nservice:\n',1)[1].split('    metrics:\n',1)[1];assert 'exporters: [prometheus]' in metric_text and not re.search(r'^    [a-z]',metric_text,re.M)
 isolated=receiver_text+'processors:\n'+processor_text+'exporters:\n  prometheus:\n'+prometheus_text+'service:\n  telemetry:\n    logs:\n      level: error\n  pipelines:\n    metrics:\n'+metric_text
 config_path=folder/'collector.yaml';config_path.write_text(isolated,encoding='utf-8')
 report['sourceCollectorConfigSha256']=hashlib.sha256(source_bytes).hexdigest();report['exactSourceMetricProcessorsUsed']=True
 receive_port,scrape_port=4318,8889
 # No published ports, existing network attachment or application backend.
 # The image's existing wget reads its own loopback through bounded docker exec.
 report['phase']='start-owned-isolated-collector';created=True
 run(['docker','run','-d','--rm','--pull=never','--name',name,'--label','com.docker.compose.project=agenttrust','--label','dev.agenttrust.purpose=gateway-stage-privacy','--label','dev.agenttrust.owner='+nonce,'--network','none','--log-driver','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','384m','--cpus','0.5','--pids-limit','64','--mount','type=bind,source='+str(config_path)+',target=/etc/otel/config.yaml,readonly',image])
 report['phase']='await-isolated-prometheus-endpoint';poll(lambda:request(scrape_port,'/metrics'),lambda text:True)
 sentinel='privacy-canary-'+secrets.token_hex(16);now=time.time_ns();metric_name='agenttrust.gateway.stage.duration'
 def point(stage='quota',outcome='cancelled'):
  return {'startTimeUnixNano':str(now-1000000),'timeUnixNano':str(now),'count':'1','sum':.125,'explicitBounds':[.005,.025,.1,.25,.5,1.,3.,6.],'bucketCounts':['0','0','0','1','0','0','0','0','0'],'attributes':[attribute('agenttrust.gateway.stage',stage),attribute('agenttrust.gateway.outcome',outcome),attribute('url.full',sentinel),attribute('cookie',sentinel),attribute('http.request.method',sentinel)]}
 def histogram(points,unit='s'):
  return {'name':metric_name,'description':sentinel,'unit':unit,'histogram':{'aggregationTemporality':2,'dataPoints':points}}
 missing=point();missing['attributes']=[a for a in missing['attributes'] if a['key']!='agenttrust.gateway.stage']
 typed=point();typed['attributes'][0]={'key':'agenttrust.gateway.stage','value':{'intValue':'42'}}
 missing_outcome=point();missing_outcome['attributes']=[a for a in missing_outcome['attributes'] if a['key']!='agenttrust.gateway.outcome']
 typed_outcome=point();typed_outcome['attributes'][1]={'key':'agenttrust.gateway.outcome','value':{'intValue':'42'}}
 exemplar=point();exemplar['exemplars']=[{'timeUnixNano':str(now),'asDouble':.125,'filteredAttributes':[attribute('secret',sentinel)],'traceId':secrets.token_hex(16),'spanId':secrets.token_hex(8)}]
 metrics=[histogram([point(),point(stage=sentinel),point(outcome=sentinel),missing,typed,missing_outcome,typed_outcome,exemplar]),histogram([point()],unit='ms'),{'name':metric_name,'unit':'s','gauge':{'dataPoints':[{'timeUnixNano':str(now),'asDouble':999.,'attributes':point()['attributes']}]}},{'name':metric_name+'.max','description':sentinel,'gauge':{'dataPoints':[{'timeUnixNano':str(now),'asDouble':999.}]}}]
 def resource(service,values):
  return {'resource':{'attributes':[attribute('service.name',service),attribute('process.command_line',sentinel)]},'schemaUrl':sentinel,'scopeMetrics':[{'scope':{'name':sentinel,'version':sentinel,'attributes':[attribute('authorization',sentinel)]},'schemaUrl':sentinel,'metrics':values}]}
 payload={'resourceMetrics':[resource('agenttrust-gateway',metrics),resource('agenttrust-privacy-probe',[histogram([point()])])]}
 report['phase']='send-bounded-otlp-fixtures';response=json.loads(request(receive_port,'/v1/metrics',payload));assert int(response.get('partialSuccess',{}).get('rejectedDataPoints',0))==0
 def scrape():
  text=request(scrape_port,'/metrics');report.update(sawSecondsStageCount='agenttrust_gateway_stage_duration_seconds_count{' in text,sawUnitlessStageCount='agenttrust_gateway_stage_duration_count{' in text,sawAnyStageMetric='agenttrust_gateway_stage_duration' in text,readbackCanaryAbsent=sentinel not in text and sentinel.replace('-','_') not in text);return text
 report['phase']='await-filtered-histogram';text=poll(scrape,lambda text:'agenttrust_gateway_stage_duration_seconds_count{' in text)
 assert sentinel not in text and sentinel.replace('-','_') not in text
 lines=[line for line in text.splitlines() if line.startswith('agenttrust_gateway_stage_duration')]
 assert lines and all(line.startswith(('agenttrust_gateway_stage_duration_seconds_bucket{','agenttrust_gateway_stage_duration_seconds_sum{','agenttrust_gateway_stage_duration_seconds_count{')) for line in lines)
 assert all('agenttrust_gateway_stage="quota"' in line and 'agenttrust_gateway_outcome="cancelled"' in line and 'service_name="agenttrust-gateway"' in line for line in lines)
 counts=[line for line in lines if line.startswith('agenttrust_gateway_stage_duration_seconds_count{')];sums=[line for line in lines if line.startswith('agenttrust_gateway_stage_duration_seconds_sum{')]
 assert len(counts)==len(sums)==1 and float(counts[0].rsplit(' ',1)[1])==1 and float(sums[0].rsplit(' ',1)[1])==.125
 assert len([line for line in lines if '_bucket{' in line])==9
 assert source.read_bytes()==source_bytes
 report.update(gatewayStageCanaryAbsent=True,gatewayStageWrongServiceUnitTypeAndExemplarRefused=True,gatewayStageMissingTypedAndUnknownValuesRefused=True,exactSingleValidHistogramPreserved=True,applicationMetricsNotInjected=True)
 report['checks']=['actual Collector OTLP-to-Prometheus histogram','resource scope and unknown-label canary removal','fixed stage and outcome values','wrong service unit type and exemplars refused','missing typed and unknown stage values refused','exactly one valid count sum and nine buckets'];report['phase']='completed'
except Exception as error:report['errorType']=type(error).__name__
finally:
 # Cleanup must remain possible after a resource refusal. Ownership and image
 # are checked before stopping only this fixture; unknown names are not adopted.
 try:
  if created:
   metadata=run(['docker','inspect','--format','{{.Image}}|{{index .Config.Labels "dev.agenttrust.owner"}}|{{index .Config.Labels "dev.agenttrust.purpose"}}',name],cleanup=True)
   assert metadata==image+'|'+nonce+'|gateway-stage-privacy'
   run(['docker','stop','--time','5',name],cleanup=True)
   remaining=run(['docker','ps','-a','-q','--filter','label=dev.agenttrust.owner='+nonce],cleanup=True);assert not remaining
  report['ownedCollectorRemoved']=True
  if 'before' in locals():
   after=bindings(cleanup=True);report['originalRuntimeBindingsUnchanged']=before==after;assert before==after
 except Exception as error:report.update(cleanupErrorType=type(error).__name__);report.setdefault('ownedCollectorRemoved',False)
 report['completed']=all(report.get(k) is True for k in ['gatewayStageCanaryAbsent','gatewayStageWrongServiceUnitTypeAndExemplarRefused','gatewayStageMissingTypedAndUnknownValuesRefused','exactSingleValidHistogramPreserved','ownedCollectorRemoved','originalRuntimeBindingsUnchanged'])
 report['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();out=folder/'summary.json';out.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
 print(json.dumps({'completed':report['completed'],'gatewayStageCanaryAbsent':report.get('gatewayStageCanaryAbsent',False),'gatewayStageWrongServiceUnitTypeAndExemplarRefused':report.get('gatewayStageWrongServiceUnitTypeAndExemplarRefused',False),'originalRuntimeBindingsUnchanged':report.get('originalRuntimeBindingsUnchanged',False),'ownedCollectorRemoved':report.get('ownedCollectorRemoved',False),'checks':len(report['checks']),'reportPath':str(out),'rawUrlsBodiesErrorsOrSecretsPrinted':False}))
if not report['completed']:raise SystemExit(1)
