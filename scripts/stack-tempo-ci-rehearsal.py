"""Hosted-only synthetic Tempo cold/hot/inverse experiment; never operating recovery."""
import argparse,base64,datetime,hashlib,importlib.util,json,os,pathlib,re,signal,subprocess,sys,time,traceback,uuid
from stack_tempo_poll_evidence import counters,classify_inverse,NAMES
from stack_tempo_ci_release import verify,load
ROOT=pathlib.Path(__file__).resolve().parent.parent
PYTHON='python:3.14-alpine@sha256:f6a589d43c42b9e7f7dc67a12d37132491f362859a5d750607710cc56da3bc72'
def need(value):
 if not value:raise ValueError('Hosted synthetic Tempo evidence refused')
def stamp():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def host_guard(case):
 need(sys.platform=='linux' and os.environ.get('GITHUB_ACTIONS')=='true' and os.environ.get('RUNNER_ENVIRONMENT')=='github-hosted' and os.environ.get('GITHUB_REPOSITORY')=='automaster5013/AgentTrust' and not os.environ.get('DOCKER_HOST') and os.environ.get('DOCKER_CONTEXT','default')=='default' and not os.environ.get('DOCKER_TLS_VERIFY'))
 event=json.loads(pathlib.Path(os.environ['GITHUB_EVENT_PATH']).read_bytes());need(event['repository']['private'] is False and event['repository']['full_name']==case['repository'])
 need(case['schemaVersion']==1 and case['repository']=='automaster5013/AgentTrust' and re.fullmatch(r'docker.io/automaster5013/agenttrust-tempo@sha256:[a-f0-9]{64}',case['image']))
 limit=datetime.datetime.fromisoformat(os.environ.get('TEMPO_CI_DEADLINE_UTC') or case['notAfterUtc']);need(limit.tzinfo is not None);deadline=limit.timestamp();need(deadline-time.time()>=1980)
 temp=pathlib.Path(os.environ['RUNNER_TEMP']).resolve();need(temp.is_dir() and not temp.is_symlink());return temp,min(deadline-180,time.time()+38*60)
def available_mib():
 values=dict(line.split(':',1) for line in pathlib.Path('/proc/meminfo').read_text().splitlines());return int(values['MemAvailable'].split()[0])//1024
def fingerprint(frames,start):
 history=load('ci_trace_identity','stack-tempo-history-recovery.py');need(set(frames)=={format(i,'032x') for i in range(1,21)});result={}
 def binary(value,size):
  if re.fullmatch('[a-fA-F0-9]{'+str(size*2)+'}',value or ''):return bytes.fromhex(value)
  raw=base64.b64decode(value or '',validate=True);need(len(raw)==size);return raw
 for i in range(1,21):
  trace=format(i,'032x');frame=frames[trace];spans=[span for batch in frame.get('batches',frame.get('resourceSpans',[])) for scope in batch.get('scopeSpans',batch.get('instrumentationLibrarySpans',[])) for span in scope.get('spans',[])]
  count=7 if i<=13 else 6;need(len(spans)==count and {s['name'] for s in spans}=={'synthetic-'+str(i)+'-'+str(j) for j in range(count)})
  for span in spans:
   j=int(span['name'].split('-')[-1]);need(binary(span['traceId'],16)==i.to_bytes(16,'big') and binary(span['spanId'],8)==(i*100+j+1).to_bytes(8,'big'))
   need(int(span['startTimeUnixNano'])==start*10**9+i*10**6+j*1000 and int(span['endTimeUnixNano'])==start*10**9+i*10**6+j*1000+500)
   if j:need(binary(span['parentSpanId'],8)==(i*100+1).to_bytes(8,'big'))
  result[trace]=list(history.trace_fingerprint(frame))
 need(sum(v[1] for v in result.values())==133);return result
class Driver:
 def __init__(self,root,case,deadline):
  self.id=str(uuid.uuid4());self.prefix='agenttrust-ci-tempo-'+self.id;self.root=root/self.prefix;self.root.mkdir();self.case=case;self.deadline=deadline;self.names=[];self.seq=0;self.data={}
  self.owner={'fixture':self.id,'runId':os.environ.get('GITHUB_RUN_ID'),'attempt':os.environ.get('GITHUB_RUN_ATTEMPT')};(self.root/'owner.json').write_text(json.dumps(self.owner));self.report={'schemaVersion':1,'kind':'hosted-synthetic-tempo-warm-proof','startedAt':stamp(),'completed':False,'syntheticWarmMetricProofVerified':False,'operatingTempoRecoveryVerified':False,'operationalBackupVerified':False,'fullStackRecoveryVerified':False,'actualCDPerformed':False,'automaticDeploymentAllowed':False,'harnessSha':os.environ.get('GITHUB_SHA'),'sourceRevision':case['revision'],'imageReference':case['image'],'phases':[]}
  self.config=self.root/'tempo.yaml';self.config.write_text('stream_over_http_enabled: true\nserver:\n  http_listen_port: 3200\n  log_level: error\ndistributor:\n  receivers:\n    otlp:\n      protocols:\n        http:\n          endpoint: 127.0.0.1:4318\nstorage:\n  trace:\n    backend: local\n    blocklist_poll: 5m\n    wal:\n      path: /var/tempo/wal\n    local:\n      path: /var/tempo/blocks\nusage_report:\n  reporting_enabled: false\n')
  self.report['configSha256']=hashlib.sha256(self.config.read_bytes()).hexdigest()
 def record(self,**values):
  path=self.root/'synthetic-evidence.json';current=json.loads(path.read_bytes()) if path.exists() else {};current.update(values);path.write_text(json.dumps(current,indent=2));self.save()
 def save(self):
  evidence=self.root/'synthetic-evidence.json'
  if evidence.exists():self.report['evidenceSha256']=hashlib.sha256(evidence.read_bytes()).hexdigest()
  (self.root/'summary.json').write_text(json.dumps(self.report,indent=2))
 def phase(self,name):self.report['phases'].append({'name':name,'at':stamp()});self.save()
 def check(self,initial=False):
  need(time.time()<self.deadline and available_mib()>=(4096 if initial else 2048));need(json.loads((self.root/'owner.json').read_bytes())==self.owner)
 def call(self,args,data=None,cleanup=False):
  if not cleanup:self.check()
  timeout=15 if cleanup else max(1,min(90,int(self.deadline-time.time())))
  result=subprocess.run(args,input=data,capture_output=True,timeout=timeout);need(result.returncode==0);return result.stdout
 def owned(self,name):
  need(name in self.names and name.startswith(self.prefix+'-'));row=json.loads(self.call(['docker','inspect',name]))[0];need(row['Config']['Labels'].get('agenttrust.fixture')==self.id);return row
 def identity(self,name):
  row=self.owned(name);need(row['State']['Running'] and not row['State']['OOMKilled'] and row['RestartCount']==0 and row['HostConfig']['NetworkMode']=='none' and not row['HostConfig']['PortBindings']);return [row['Id'],row['Image'],row['State']['StartedAt']]
 def directory(self,name):
  p=self.root/name;need(p.parent==self.root and not p.exists());p.mkdir(mode=0o777);p.chmod(0o777);self.data[name]=p;return p
 def helper(self,action,target=None,source=None,container=None,start=None,cleanup=False):
  need(json.loads((self.root/'owner.json').read_bytes())==self.owner)
  self.seq+=1;name=self.prefix+'-helper-'+str(self.seq);self.names.append(name)
  args=['docker','run','--rm','-i','--name',name,'--label','agenttrust.fixture='+self.id,'--log-driver','none','--network',('container:'+self.owned(container)['Id']) if container else 'none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--user','10001:10001','--memory','192m','--cpus','1','--pids-limit','32','-e','AGENTTRUST_SYNTHETIC_HELPER=1','--mount','type=bind,source='+str(ROOT/'scripts/stack-tempo-ci-helper.py')+',target=/helper.py,readonly']
  for role,p in (('data',target),('source',source)):
   if p is not None:
    need(p in self.data.values() and p.parent==self.root and not p.is_symlink());args+=['--mount','type=bind,source='+str(p)+',target=/'+role+(',readonly' if role=='source' or action in ('closed','bad-files') else '')]
  args +=[PYTHON,'python','/helper.py',action];out=json.loads(self.call(args,json.dumps({'start':start}).encode(),cleanup));need(not out.get('refused'));self.names.remove(name);return out
 def start(self,role,data):
  name=self.prefix+'-'+role;self.names.append(name)
  args=['docker','run','-d','--name',name,'--label','agenttrust.fixture='+self.id,'--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--user','10001:10001','--memory','512m','--cpus','1','--pids-limit','128','--tmpfs','/tmp:size=32m,mode=1777','--log-driver','local','--log-opt','max-size=1m','--log-opt','max-file=2','--mount','type=bind,source='+str(data)+',target=/var/tempo','--mount','type=bind,source='+str(self.config)+',target=/etc/tempo.yaml,readonly',self.case['image'],'-config.file=/etc/tempo.yaml','-target=all'];self.call(args)
  self.wait(lambda:self.helper('ready',container=name)['status']==200,120);identity=self.identity(name);need(identity[1]==self.report['release']['runtimeImageId']);return name
 def stop(self,name):self.owned(name);self.call(['docker','rm','-f',name]);self.names.remove(name)
 def wait(self,condition,seconds,container=None,identity=None):
  end=min(time.time()+seconds,self.deadline-30)
  while True:
   self.check()
   if container:need(self.identity(container)==identity)
   value=condition()
   if value:
    if container:need(self.identity(container)==identity)
    return value
   need(time.time()<end);time.sleep(10)
 def logs(self,name,since=None):
  self.owned(name);args=['docker','logs','--tail','100']
  if since:args+=['--since',since]
  args.append(name);result=subprocess.run(args,capture_output=True,timeout=10);need(result.returncode==0);raw=result.stdout+result.stderr;need(len(raw)<=262144)
  return {'jsonErrors':raw.lower().count(b'unexpected end of json input'),'sha256':hashlib.sha256(raw).hexdigest(),'capturedAt':stamp(),'syntheticLogTail':raw.decode('utf-8',errors='replace')[-65536:]}
 def metrics(self,name,allow_missing=False):
  frame=self.helper('metrics',container=name);need(frame['status']==200)
  if allow_missing and NAMES[0] not in frame['text']:return None
  global_rows=re.findall(r'(?m)^tempodb_blocklist_poll_errors_total\{tenant=""\}\s+(\S+)\s*$',frame['text']);need(len(global_rows)<=1);global_errors=float(global_rows[0]) if global_rows else 0;need(global_errors>=0 and global_errors.is_integer() if isinstance(global_errors,float) else global_errors==0)
  self.last_metrics={'globalPollErrors':int(global_errors),'capturedAt':stamp(),'lines':[line for line in frame['text'].splitlines() if any(line.startswith(key) for key in NAMES)]};return counters(frame['text'])
 def traces(self,name,start):
  frame=self.helper('traces',container=name,start=start)
  if frame['status']==404:
   self.report['lastSyntheticTraceStatus']=404;self.save();return None
  need(frame['status']==200);self.last_frames=frame['traces'];return fingerprint(frame['traces'],start)
 def cleanup(self):
  ok=True
  for name in reversed(self.names):
   try:
    result=subprocess.run(['docker','inspect',name],capture_output=True,timeout=5)
    if result.returncode:continue
    row=json.loads(result.stdout)[0];need(row['Config']['Labels'].get('agenttrust.fixture')==self.id and name.startswith(self.prefix+'-'));self.call(['docker','rm','-f',name],cleanup=True)
   except Exception:ok=False
  for path in self.data.values():
   try:self.helper('clean',target=path,cleanup=True);path.rmdir()
   except Exception:ok=False
  self.report['ownedFixtureCleaned']=ok
  if not ok:self.report.update(completed=False,syntheticWarmMetricProofVerified=False)
  self.save()

def exercise(d):
 d.phase('release-verification');d.report['release']=verify(d.case,d.root/'release',d.check);d.check(True)
 context=json.loads(d.call(['docker','context','inspect']));need(len(context)==1 and context[0]['Endpoints']['docker']['Host']=='unix:///var/run/docker.sock')
 d.call(['docker','pull','--platform','linux/amd64',d.case['image']]);d.call(['docker','pull','--platform','linux/amd64',PYTHON]);image=json.loads(d.call(['docker','image','inspect',d.case['image']]))[0];need(image['Id']==d.report['release']['runtimeImageId']);need(d.deadline-time.time()>=1800)
 d.phase('synthetic-writer');start=int(time.time())-180;data=d.directory('writer-data');writer=d.start('writer',data);need(d.helper('push',container=writer,start=start)=={'traces':20,'spans':133});d.wait(lambda:d.helper('closed',target=data)['blocks'],300);d.stop(writer)
 d.phase('closed-block-only-golden-reader');gold_data=d.directory('gold-data');gold_manifest=d.helper('clone',target=gold_data,source=data);need(gold_manifest['walCopied'] is False);gold=d.start('gold',gold_data);before=d.wait(lambda:d.traces(gold,start),120);d.report['goldenManifestSha256']=hashlib.sha256(json.dumps(gold_manifest,sort_keys=True).encode()).hexdigest();d.stop(gold);d.record(before=before,goldenFrames=d.last_frames,boundsStart=start)
 d.phase('cold-empty-metadata-control');candidate_data=d.directory('candidate-data');d.helper('clone',target=candidate_data,source=data);bad=d.helper('inject',target=candidate_data);candidate=d.start('candidate',candidate_data);identity=d.identity(candidate)
 def cold_failed():
  need(d.traces(candidate,start) is None);metrics=d.metrics(candidate,allow_missing=True)
  if metrics is None or metrics['series'][NAMES[0]].get('"single-tenant"',0)<=0:return None
  logs=d.logs(candidate)
  if logs['jsonErrors']<=0:return None
  d.record(coldLogs=logs,negativeRaw=d.last_metrics);return metrics
 negative=d.wait(cold_failed,120,candidate,identity);d.record(negative=negative,coldTraceStatus=404,badFiles=bad,identity=identity)
 config=d.helper('config',container=candidate);need(config['status']==200);poll=re.findall(r'(?m)^\s*blocklist_poll:\s*(\S+)\s*$',config['text']);need(len(poll)==1 and poll[0] in ('5m','5m0s','300s'));d.report['effectivePollingSeconds']=300
 d.phase('hot-quarantine');need(d.helper('out',target=candidate_data)==bad);samples=[];stable=[]
 def recovered():
  current=d.metrics(candidate);rows=d.traces(candidate,start);samples.append({'at':stamp(),'counters':current,'tracesMatched':rows==before,'rawMetrics':d.last_metrics});d.record(recoverySamples=samples)
  if len(samples)>1:classify_inverse(samples[-2]['counters'],current,True,'single-tenant')
  errors=current['totals'][NAMES[0]];count=current['totals'][NAMES[1]]
  if rows!=before:return None
  if not stable:
   need(count>negative['totals'][NAMES[1]]);stable.append((count,errors,d.last_metrics['globalPollErrors']));return None
  need(errors>=stable[0][1] and d.last_metrics['globalPollErrors']>=stable[0][2]);return rows if count>=stable[0][0]+1 and errors==stable[0][1] and d.last_metrics['globalPollErrors']==stable[0][2] else None
 after=d.wait(recovered,720,candidate,identity);need(after==before);baseline=d.metrics(candidate);d.record(after=after,recoveredFrames=d.last_frames,inverseBaseline=baseline,inverseBaselineRaw=d.last_metrics)
 d.phase('warm-inverse');inverse_since=stamp();need(d.helper('inverse',target=candidate_data)==bad);inverse_samples=[]
 def retained():
  current=d.metrics(candidate);rows=d.traces(candidate,start);inverse_samples.append({'at':stamp(),'counters':current,'tracesMatched':rows==before,'rawMetrics':d.last_metrics});d.record(inverseSamples=inverse_samples,inverseFrames=d.last_frames);need(rows==before);result=classify_inverse(baseline,current,True,'single-tenant')
  if not result['retainedGoodBlocklistObserved']:return None
  logs=d.logs(candidate,inverse_since);d.record(inverseLogs=logs,inverseSince=inverse_since)
  return result if logs['jsonErrors']>0 else None
 inverse=d.wait(retained,480,candidate,identity);need(d.identity(candidate)==identity and d.helper('bad-files',target=candidate_data)==bad)
 evidence={'before':before,'after':after,'negative':negative,'recoverySamples':samples,'inverseBaseline':baseline,'inverseSamples':inverse_samples,'inverseResult':inverse,'badFiles':bad,'identity':identity,'identityAfter':d.identity(candidate),'boundsStart':start,'coldTraceStatus':404};d.record(**evidence)
 d.report.update(completed=True,syntheticWarmMetricProofVerified=True,matchingTraces=20,matchingSpans=133,candidateNeverRestarted=True,inverseFilesPreserved=True,newPollErrors=inverse['newPollErrors'],evidenceSha256=hashlib.sha256((d.root/'synthetic-evidence.json').read_bytes()).hexdigest())

def main():
 parser=argparse.ArgumentParser(description=__doc__);group=parser.add_mutually_exclusive_group(required=True);group.add_argument('--execute',action='store_true');group.add_argument('--verify-output',type=pathlib.Path);args=parser.parse_args();d=None
 if args.verify_output:
  from stack_tempo_ci_verdict import verify_output
  try:print(json.dumps(verify_output(args.verify_output)));return 0
  except Exception as error:print(json.dumps({'verified':False,'errorType':type(error).__name__}));return 1
 try:
  need(args.execute);case=json.loads((ROOT/'ci/tempo-warm-case.json').read_text(encoding='utf-8-sig'));temp,deadline=host_guard(case);d=Driver(temp,case,deadline)
  for sig in (signal.SIGTERM,signal.SIGINT):signal.signal(sig,lambda *_:(_ for _ in ()).throw(RuntimeError('Job interrupted')))
  exercise(d)
 except Exception as error:
  if d:
   d.report.update(completed=False,errorType=type(error).__name__,failureLocations=[{'file':pathlib.Path(row.filename).name,'line':row.lineno} for row in traceback.extract_tb(error.__traceback__)])
   for name in list(d.names):
    try:d.record(failureLogs=d.logs(name))
    except Exception:pass
  else:print(json.dumps({'completed':False,'refusedBeforeDocker':True,'errorType':type(error).__name__}));return 1
 finally:
  if d:d.cleanup()
 if d:
  output=pathlib.Path(os.environ['RUNNER_TEMP'])/'tempo-ci-output';output.mkdir()
  for name in ('summary.json','synthetic-evidence.json'):
   p=d.root/name
   if p.is_file():(output/name).write_bytes(p.read_bytes())
  print(json.dumps({'completed':d.report['completed'],'syntheticWarmMetricProofVerified':d.report['syntheticWarmMetricProofVerified'],'actualCDPerformed':False}));return 0 if d.report['completed'] else 1
if __name__=='__main__':sys.exit(main())
