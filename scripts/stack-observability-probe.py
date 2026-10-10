"""Internal synthetic OTLP privacy probe. Invoked in a restricted one-shot container."""
import base64,json,secrets,time,urllib.request,urllib.parse,urllib.error
sentinel='privacy-canary-'+secrets.token_hex(16)
trace_id=secrets.token_hex(16);span_id=secrets.token_hex(8);now=time.time_ns()
def attribute(key,value):return {'key':key,'value':{'stringValue':value}}
resource={'attributes':[attribute('service.name','agenttrust-privacy-probe'),attribute('process.command_line',sentinel)]}
scope={'name':sentinel,'version':sentinel,'attributes':[attribute('authorization',sentinel)]}
def request(url,body=None):
 assert urllib.parse.urlsplit(url).hostname in ['stack-otel','stack-tempo','stack-loki','stack-prometheus']
 payload=None if body is None else json.dumps(body).encode()
 with urllib.request.urlopen(urllib.request.Request(url,data=payload,headers={'Content-Type':'application/json','Accept':'application/json'}),timeout=5) as response:
  raw=response.read(2097153);assert len(raw)<=2097152
 return json.loads(raw)
def poll(url,accept):
 deadline=time.monotonic()+60
 while time.monotonic()<deadline:
  try:
   value=request(url)
   if accept(value):return value
  except (urllib.error.URLError,json.JSONDecodeError):pass
  time.sleep(1)
 raise AssertionError('Telemetry readback unavailable')
span={'traceId':trace_id,'spanId':span_id,'name':sentinel,'kind':2,'startTimeUnixNano':str(now),'endTimeUnixNano':str(now+1000000),'traceState':sentinel,'attributes':[attribute('url.full',sentinel),attribute('http.request.header.authorization',sentinel),attribute('http.request.method','GET'),{'key':'http.response.status_code','value':{'intValue':'200'}}],'status':{'code':2,'message':sentinel},'events':[{'timeUnixNano':str(now),'name':sentinel,'attributes':[attribute('exception.message',sentinel)]}],'links':[{'traceId':secrets.token_hex(16),'spanId':secrets.token_hex(8),'attributes':[attribute('secret',sentinel)]}]}
linked_id=secrets.token_hex(16);linked={**span,'traceId':linked_id};span={**span,'links':[]}
request('http://stack-otel:4318/v1/traces',{'resourceSpans':[{'resource':resource,'schemaUrl':sentinel,'scopeSpans':[{'scope':scope,'schemaUrl':sentinel,'spans':[span,linked]}]}]})
request('http://stack-otel:4318/v1/logs',{'resourceLogs':[{'resource':resource,'schemaUrl':sentinel,'scopeLogs':[{'scope':scope,'schemaUrl':sentinel,'logRecords':[{'timeUnixNano':str(now),'observedTimeUnixNano':str(now),'severityNumber':9,'severityText':sentinel,'body':{'stringValue':sentinel},'attributes':[attribute('cookie',sentinel)],'traceId':trace_id,'spanId':span_id}]}]}]})
request('http://stack-otel:4318/v1/metrics',{'resourceMetrics':[{'resource':resource,'schemaUrl':sentinel,'scopeMetrics':[{'scope':scope,'schemaUrl':sentinel,'metrics':[{'name':'agenttrust.evaluations','description':sentinel,'unit':sentinel,'sum':{'aggregationTemporality':2,'isMonotonic':True,'dataPoints':[{'startTimeUnixNano':str(now-1000000),'timeUnixNano':str(now),'asInt':'1','attributes':[attribute('prompt',sentinel)]}]}}]}]}]})
traces=poll('http://stack-tempo:3200/api/traces/'+trace_id,lambda value:bool(value.get('batches') or value.get('resourceSpans')))
assert sentinel not in json.dumps(traces)
try:
 request('http://stack-tempo:3200/api/traces/'+linked_id)
 raise AssertionError('Linked span was retained')
except urllib.error.HTTPError as error:assert error.code==404
query=urllib.parse.urlencode({'query':'{service_name="agenttrust-privacy-probe"}','start':str(now-1000000000),'end':str(time.time_ns()+120000000000),'limit':'20'})
logs=poll('http://stack-loki:3100/loki/api/v1/query_range?'+query,lambda value:bool(value.get('data',{}).get('result')))
assert sentinel not in json.dumps(logs) and any(line[1]=='application event' for row in logs['data']['result'] for line in row['values'])
metric_query=urllib.parse.urlencode({'query':'agenttrust_evaluations_total{service_name="agenttrust-privacy-probe"}'})
metrics=poll('http://stack-prometheus:9090/api/v1/query?'+metric_query,lambda value:bool(value.get('data',{}).get('result')))
assert sentinel not in json.dumps(metrics)
print(json.dumps({'completed':True,'privacyCanaryAbsentInTracesLogsMetrics':True,'traceEventsRemovedAndLinkedSpansRefused':True,'logBodyReplaced':True,'fixedMetricReadback':True,'rawSecretsPrinted':False}))
