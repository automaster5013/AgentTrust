"""Verify actual Java -> JetStream -> Python -> Java parent spans through authenticated Grafana."""
import base64,datetime,json,pathlib,time,traceback,urllib.error,urllib.parse,urllib.request,uuid
from stack_test_client import StackClient

root=pathlib.Path(__file__).resolve().parent.parent
report={'completed':False,'checks':[],'credentialsRecorded':False,'payloadAttributesRecorded':False,
        'paidApiCalls':False,'actualDeploymentPerformed':False,
        'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
client=None
stage='login'

def grafana(path):
    password=(root/'.local/stack/grafana-password').read_text(encoding='utf-8')
    authorization='Basic '+base64.b64encode(('admin:'+password).encode()).decode()
    with urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:4324'+path,
            headers={'Authorization':authorization}),timeout=10) as response:
        raw=response.read(2097153)
    assert len(raw)<=2097152
    return json.loads(raw)

def identifier(value,length):
    # Tempo JSON normally uses hexadecimal IDs; protobuf JSON may use base64.
    if isinstance(value,str) and len(value)==length*2:
        try:return bytes.fromhex(value)
        except ValueError:pass
    if not isinstance(value,str):return None
    try:
        decoded=base64.b64decode(value,validate=True)
        return decoded if len(decoded)==length else None
    except ValueError:return None

try:
    client=StackClient('http://127.0.0.1:4320',json.loads((root/'.local/stack/demo-credentials.json').read_text(encoding='utf-8')),report)
    owner=client.login('demo-admin')
    started=int(time.time())
    stage='queued-evaluation'
    record=client.request('runs','POST',{'scenario':'pass','requiresApproval':True},
                          {'Idempotency-Key':str(uuid.uuid4())})
    until=time.monotonic()+35
    while record['state']=='queued' and time.monotonic()<until:
        time.sleep(.4);record=client.request('runs/'+record['id'])
    assert record['state']=='succeeded' and record['decision']=='pass'
    assert not client.request('runs/'+record['id']+'/gate')['deploymentAllowed']
    report['checks'].append('real queued synthetic evaluation completes while required approval remains held')
    stage='actual-parent-chain'
    until=time.monotonic()+60
    linked=False
    while time.monotonic()<until and not linked:
        try:
            search=grafana('/api/datasources/proxy/uid/agenttrust-tempo/api/search?'+urllib.parse.urlencode({
                'q':'{resource.service.name="agenttrust-core-api" && kind=producer} && {resource.service.name="agenttrust-ai-worker" && kind=consumer}',
                'start':str(started),'end':str(int(time.time())+1),'limit':'20'}))
        except (TimeoutError,urllib.error.URLError) as pending:
            if isinstance(pending,urllib.error.HTTPError):
                if pending.code not in [400,404,502,503,504]:raise
                report.setdefault('searchRetryStatuses',[]).append(pending.code)
            time.sleep(1)
            continue
        for entry in search.get('traces',[]):
            try:trace=grafana('/api/datasources/proxy/uid/agenttrust-tempo/api/traces/'+entry['traceID'])
            except urllib.error.HTTPError as pending:
                if pending.code not in [404,502,503,504]:raise
                continue
            spans=[]
            for batch in trace.get('batches',trace.get('resourceSpans',[])):
                service=next((attribute['value'].get('stringValue') for attribute in batch.get('resource',{}).get('attributes',[]) if attribute['key']=='service.name'),None)
                for scope in batch.get('scopeSpans',batch.get('instrumentationLibrarySpans',[])):
                    spans.extend((service,span) for span in scope.get('spans',[]))
            def kind(span,number,name):return span.get('kind') in [number,'SPAN_KIND_'+name]
            producers=[span for service,span in spans if service=='agenttrust-core-api' and kind(span,4,'PRODUCER')]
            consumers=[span for service,span in spans if service=='agenttrust-ai-worker' and kind(span,5,'CONSUMER')]
            callbacks=[span for service,span in spans if service=='agenttrust-core-api' and kind(span,2,'SERVER')]
            for consumer in consumers:
                parent=identifier(consumer.get('parentSpanId'),8)
                own=identifier(consumer.get('spanId'),8)
                if parent and own and any(identifier(span.get('spanId'),8)==parent for span in producers) and any(identifier(span.get('parentSpanId'),8)==own for span in callbacks):
                    raw=json.dumps(trace)
                    assert all(value not in raw for value in [record['id'],owner['organizationId'],owner['projectId'],owner['actorId']])
                    assert all(span.get('name')=='agenttrust.operation' and not span.get('events') and not span.get('links') for _,span in spans)
                    report['verifiedSpanKinds']=['Java PRODUCER','Python CONSUMER','Java SERVER']
                    linked=True
                    break
            if linked:break
        if not linked:time.sleep(1)
    assert linked
    report['checks'].append('actual queue consumer parent equals Java producer span; completion server parent equals Python consumer span')
    report['checks'].append('exported joined trace has no run or organization/project/actor IDs, events or links and only fixed operation names')
    report['completed']=True
except Exception as error:
    if isinstance(error,urllib.error.HTTPError):report['unexpectedHttpStatus']=error.code
    report.update(code='QUEUE_TRACE_UNVERIFIED',failedStage=stage,errorType=type(error).__name__,failureLocations=[{'file':pathlib.Path(item.filename).name,'line':item.lineno} for item in traceback.extract_tb(error.__traceback__)])
finally:
    closed=True
    if client:
        try:client.logout()
        except Exception:closed=False
    report.update(ownSessionLoggedOut=closed,finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
    path=root/'.local'/('stack-queue-trace-'+str(uuid.uuid4())+'.json')
    path.open('x',encoding='utf-8').write(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'completed':report['completed'],'checks':len(report['checks']),'ownSessionLoggedOut':closed,'failedStage':report.get('failedStage'),'reportPath':str(path)}))
    if not report['completed'] or not closed:raise SystemExit(1)
