"""Verify rebuilt Prometheus, promtool and preserved browser assets without secrets."""
import datetime,json,pathlib,subprocess,uuid

root=pathlib.Path(__file__).resolve().parent.parent
report={'completed':False,'checks':[],'credentialsRecorded':False,'actualDeploymentPerformed':False,
        'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
stage='service-identity'
def command(args):
    return subprocess.run(args,cwd=root,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=30)
try:
    state=command(['docker','inspect','agenttrust-stack-prometheus-1']);assert state.returncode==0
    service=json.loads(state.stdout)[0];labels=service['Config']['Labels']
    assert labels['com.docker.compose.project']=='agenttrust' and labels['com.docker.compose.service']=='stack-prometheus'
    assert service['State']['Health']['Status']=='healthy' and service['Config']['User']=='10001:10001'
    assert service['HostConfig']['ReadonlyRootfs'] and service['HostConfig']['CapDrop']==['ALL']
    report['checks'].append('own Prometheus is healthy with a nonroot read-only runtime')
    stage='binary-versions'
    for binary in ['prometheus','promtool']:
        result=command(['docker','exec','agenttrust-stack-prometheus-1','/bin/'+binary,'--version'])
        assert result.returncode==0 and 'version 3.15.0' in result.stdout and 'go1.27.3' in result.stdout
        assert '5241a27fe3c6983549fccc32f6e65917408c63cd' in result.stdout and 'builtinassets' in result.stdout
    config=command(['docker','exec','agenttrust-stack-prometheus-1','/bin/promtool','check','config','/etc/prometheus.yaml'])
    assert config.returncode==0
    report['checks'].append('both patched upstream binaries retain versions and promtool validates the actual config')
    stage='browser-assets'
    code='''import html.parser,httpx,json,re,urllib.parse
class Scripts(html.parser.HTMLParser):
 def __init__(self):super().__init__();self.paths=[]
 def handle_starttag(self,tag,attrs):
  if tag=='script' and dict(attrs).get('src'):self.paths.append(dict(attrs)['src'])
base='http://stack-prometheus:9090'
with httpx.Client(timeout=5,follow_redirects=False,trust_env=False) as client:
 with client.stream('GET',base+'/query') as response:
  assert response.status_code==200;chunks=[];size=0
  for chunk in response.iter_bytes():
   size+=len(chunk);assert size<=1048576;chunks.append(chunk)
 parser=Scripts();parser.feed(b''.join(chunks).decode('utf-8'));assert 1<=len(parser.paths)<=16
 for path in parser.paths:
  assert len(path)<=1024;url=urllib.parse.urljoin(base+'/query',path);parsed=urllib.parse.urlsplit(url)
  assert parsed.scheme=='http' and parsed.netloc=='stack-prometheus:9090' and not parsed.query and not parsed.fragment
  assert re.fullmatch(r'/assets/[A-Za-z0-9_-]+\\.js',parsed.path)
  with client.stream('GET',url) as response:
   assert response.status_code==200;size=0
   for chunk in response.iter_bytes():size+=len(chunk);assert size<=4194304
   assert size>0
 build=client.get(base+'/api/v1/status/buildinfo');assert build.status_code==200 and len(build.content)<=4096
 info=build.json()['data'];assert info['version']=='3.15.0' and info['goVersion']=='go1.27.3' and info['revision']=='5241a27fe3c6983549fccc32f6e65917408c63cd'
 print(json.dumps({'browserScriptCount':len(parser.paths),'buildInfoVerified':True}))
'''
    probe=command(['docker','exec','agenttrust-stack-ai-worker-1','python','-c',code]);assert probe.returncode==0
    report.update(json.loads(probe.stdout));report['checks'].append('original browser UI scripts and matching live build metadata are served')
    report['completed']=True
except Exception:
    report['code']='STACK_PROMETHEUS_UNVERIFIED';report['failedStage']=stage
finally:
    report['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()
    path=root/'.local'/('stack-prometheus-smoke-'+str(uuid.uuid4())+'.json')
    path.open('x',encoding='utf-8').write(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'completed':report['completed'],'checks':len(report['checks']),'failedStage':report.get('failedStage'),'reportPath':str(path)}))
    if not report['completed']:raise SystemExit(1)
