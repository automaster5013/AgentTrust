"""Host-only tests: protocol, full mocked orchestration, evidence and cleanup gates."""
import warnings,urllib.error,contextlib,copy,hashlib,io,json,os,pathlib,tempfile,time,unittest,uuid,zipfile
from types import SimpleNamespace as NS
from unittest.mock import Mock,patch
import stack_tempo_ci_release as release
from stack_tempo_ci_release import load,extract
from stack_tempo_ci_verdict import verify_output
ROOT=pathlib.Path(__file__).resolve().parent.parent
h=load('hosted_rehearsal_test','stack-tempo-ci-rehearsal.py');helper=load('hosted_helper_test','stack-tempo-ci-helper.py')
class Fake(h.Driver):
 mode='normal'
 def __init__(self,*args):super().__init__(*args);self.models={};self.frames={};self.good=0;self.events=[]
 def call(self,args,data=None,cleanup=False):
  self.check();self.events.append(args)
  if args[:3]==['docker','context','inspect']:return json.dumps([{'Endpoints':{'docker':{'Host':'unix:///var/run/docker.sock'}}}]).encode()
  if args[:3]==['docker','image','inspect']:return json.dumps([{'Id':'sha256:'+'a'*64}]).encode()
  return b''
 def start(self,role,data):
  assert not self.models
  name=self.prefix+'-'+role;self.names.append(name);self.models[name]={'role':role,'data':data,'warm':False};self.events.append(['start',role]);return name
 def owned(self,name):return {'Id':name,'Config':{'Labels':{'agenttrust.fixture':self.id}}}
 def identity(self,name):
  changed=self.mode=='restart' and self.models[name]['role']=='candidate' and self.models[name]['warm'] and (self.models[name]['data']/'blocks/single-tenant'/helper.BAD[0]).exists()
  return [name,'sha256:'+'a'*64,'changed' if changed else 'started']
 def stop(self,name):self.events.append(['stop',self.models[name]['role']]);del self.models[name];self.names.remove(name)
 def wait(self,condition,seconds,container=None,identity=None):
  for _ in range(4):
   if container:h.need(self.identity(container)==identity)
   result=condition()
   if result:
    if container:h.need(self.identity(container)==identity)
    return result
  raise ValueError('Synthetic observation timeout')
 def helper(self,action,target=None,source=None,container=None,start=None,cleanup=False):
  self.events.append(['helper',action])
  if action=='push':
   def receive(port,path,payload=None):
    body=json.loads(payload);self.frames={format(i+1,'032x'):{'resourceSpans':[row]} for i,row in enumerate(body['resourceSpans'])};return 200,b'{}'
   with patch.object(helper,'http',receive):result=helper.main('push',{'start':start})
   data=self.models[container]['data'];block=data/'blocks/single-tenant/00000000-0000-0000-0000-000000000001';block.mkdir(parents=True);(block/'meta.json').write_text(json.dumps({'blockID':block.name,'totalObjects':20}));(block/'data.parquet').write_bytes(b'explicitly mocked parquet')
   return result
  if action in ('closed','clone','inject','out','inverse','bad-files','clean','metadata'):
   with patch.object(helper,'ROOT',target),patch.object(helper,'SOURCE',source):return helper.main(action,{})
  model=self.models[container];bad=(model['data']/'blocks/single-tenant'/helper.BAD[0]).exists();warm=model['warm']
  if action=='config':return {'status':200,'text':'storage:\n  trace:\n    blocklist_poll: 5m0s\n'}
  if action=='metrics':
   if not bad:self.good+=1
   errors=2+(2 if bad and warm and self.mode!='other' else 0)
   if bad and warm and self.mode=='reset':errors=1
   return {'status':200,'text':'tempodb_blocklist_tenant_index_errors_total{tenant="single-tenant"} '+str(errors)+'\ntempodb_blocklist_tenant_index_errors_total{tenant="other"} '+str(1 if bad and warm and self.mode=='other' else 0)+'\ntempodb_blocklist_poll_duration_seconds_count '+str(self.good)+'\n'}
  if action=='traces':
   if bad and not warm:return {'status':404}
   model['warm']=True;frames=copy.deepcopy(self.frames)
   if bad and warm and self.mode=='trace':frames[format(1,'032x')]['resourceSpans'][0]['scopeSpans'][0]['spans'][0]['name']='changed'
   return {'status':200,'traces':frames}
  raise AssertionError(action)
 def logs(self,name,since=None):return {'jsonErrors':2,'sha256':'b'*64,'capturedAt':h.stamp()}
 def cleanup(self):
  self.models.clear();self.names.clear();self.report['ownedFixtureCleaned']=self.mode!='cleanup'
  if self.mode=='cleanup':self.report.update(completed=False,syntheticWarmMetricProofVerified=False)
  self.save()
class HostedProof(unittest.TestCase):
 def scenario(self,mode='normal'):
  with tempfile.TemporaryDirectory(dir=ROOT) as tmp,contextlib.ExitStack() as stack:
   root=pathlib.Path(tmp);instances=[]
   def driver(*args):d=Fake(*args);d.mode=mode;instances.append(d);return d
   stack.enter_context(patch.object(h,'host_guard',return_value=(root,time.time()+3600)));stack.enter_context(patch.object(h,'Driver',driver));stack.enter_context(patch.object(h,'available_mib',return_value=8192));stack.enter_context(patch.object(h,'verify',return_value={'runtimeImageId':'sha256:'+'a'*64,'sourceSignaturesVerified':True,'publicationRunsVerified':True}));stack.enter_context(patch.dict(os.environ,{'RUNNER_TEMP':str(root),'GITHUB_SHA':'f'*40}));stack.enter_context(patch.object(h.sys,'argv',['hosted','--execute']));stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
   code=h.main();d=instances[0];self.assertEqual(code,0 if mode=='normal' else 1);self.assertTrue((root/'tempo-ci-output/summary.json').exists());self.assertFalse(d.models)
   summary=json.loads((root/'tempo-ci-output/summary.json').read_bytes());self.assertFalse(summary['actualCDPerformed']);self.assertFalse(summary['automaticDeploymentAllowed'])
   if mode=='normal':
    self.assertEqual(verify_output(root/'tempo-ci-output')['matchingSpans'],133);self.assertEqual([v for v in d.events if v[0]=='start'],[['start','writer'],['start','gold'],['start','candidate']]);self.assertEqual(sum(v==['stop','candidate'] for v in d.events),0)
    proof=json.loads((root/'tempo-ci-output/synthetic-evidence.json').read_bytes())
    altered=copy.deepcopy(proof);altered['inverseFrames'][format(1,'032x')]['resourceSpans'][0]['scopeSpans'][0]['spans'][0]['name']='tampered'
    raw=json.dumps(altered).encode();(root/'tempo-ci-output/synthetic-evidence.json').write_bytes(raw);summary['evidenceSha256']=hashlib.sha256(raw).hexdigest();(root/'tempo-ci-output/summary.json').write_text(json.dumps(summary))
    with self.assertRaises(ValueError):verify_output(root/'tempo-ci-output')
    proof['inverseSamples'][-1]['counters']['series']['tempodb_blocklist_tenant_index_errors_total']['"single-tenant"']=0
    raw=json.dumps(proof).encode();(root/'tempo-ci-output/synthetic-evidence.json').write_bytes(raw);summary['evidenceSha256']=hashlib.sha256(raw).hexdigest();(root/'tempo-ci-output/summary.json').write_text(json.dumps(summary))
    with self.assertRaises(ValueError):verify_output(root/'tempo-ci-output')
   else:
    with self.assertRaises((ValueError,KeyError)):verify_output(root/'tempo-ci-output')
 def test_full_success_and_independent_tamper_refusal(self):self.scenario()
 def test_unrelated_tenant_errors_do_not_promote(self):self.scenario('other')
 def test_counter_reset_does_not_promote(self):self.scenario('reset')
 def test_changed_trace_does_not_promote(self):self.scenario('trace')
 def test_restart_does_not_promote(self):self.scenario('restart')
 def test_cleanup_failure_revokes_success(self):self.scenario('cleanup')
 def test_local_execution_refused_before_docker(self):
  case=json.loads((ROOT/'ci/tempo-warm-case.json').read_text(encoding='utf-8-sig'))
  with patch.dict(os.environ,{'GITHUB_ACTIONS':'false'}),patch.object(h.subprocess,'run') as run:
   with self.assertRaises(ValueError):h.host_guard(case)
   run.assert_not_called()
 def test_backend_window_covers_ingestion_as_well_as_span_time(self):
  import urllib.parse
  now=int(time.time());paths=[]
  def read(port,path,payload=None):paths.append(path);return 200,b'{}'
  with patch.object(helper,'http',read):result=helper.main('traces',{'start':now-180})
  self.assertEqual(len(result['traces']),20)
  for path in paths:
   query=urllib.parse.parse_qs(urllib.parse.urlsplit(path).query);self.assertEqual(query['mode'],['blocks']);self.assertLessEqual(int(query['start'][0]),now-180);self.assertGreaterEqual(int(query['end'][0]),now);self.assertLessEqual(int(query['end'][0])-int(query['start'][0]),3602)
 def test_real_wait_deadline_does_not_retry(self):
  with tempfile.TemporaryDirectory(dir=ROOT) as tmp,patch.object(h,'available_mib',return_value=8192),patch.object(h.time,'sleep') as sleep:
   d=h.Driver(pathlib.Path(tmp),{'revision':'f'*40,'image':'synthetic-test'},time.time()+3600)
   with self.assertRaises(ValueError):d.wait(lambda:False,0)
   sleep.assert_not_called()
 def test_cleanup_refuses_foreign_container(self):
  with tempfile.TemporaryDirectory(dir=ROOT) as tmp:
   d=h.Driver(pathlib.Path(tmp),{'revision':'f'*40,'image':'synthetic-test'},time.time()+3600);d.names.append(d.prefix+'-foreign')
   with patch.object(h.subprocess,'run',return_value=NS(returncode=0,stdout=json.dumps([{'Config':{'Labels':{'agenttrust.fixture':'other'}}}]).encode())),patch.object(d,'call') as command:d.cleanup();command.assert_not_called()
   self.assertFalse(d.report['ownedFixtureCleaned'])
 def test_zip_slip_symlink_duplicate_and_size_refused(self):
  for name,mode,duplicate in (('../escape',0,False),('/absolute',0,False),('link',0o120777,False),('same',0,True)):
   with tempfile.TemporaryDirectory(dir=ROOT) as tmp:
    buf=io.BytesIO()
    with zipfile.ZipFile(buf,'w') as archive:
     item=zipfile.ZipInfo(name);item.external_attr=mode<<16;archive.writestr(item,b'x')
     if duplicate:
      with warnings.catch_warnings():warnings.simplefilter('ignore',UserWarning);archive.writestr(name,b'y')
    with self.assertRaises(ValueError):extract(buf.getvalue(),pathlib.Path(tmp)/'bundle')
    self.assertFalse((pathlib.Path(tmp)/'bundle').exists())
 def test_artifact_redirect_strips_github_token(self):
  response=Mock();response.__enter__=Mock(return_value=response);response.__exit__=Mock(return_value=False);response.status=200;response.read.return_value=b'zip bytes'
  error=urllib.error.HTTPError('https://api.github.com/artifact',302,'redirect',{'Location':'https://example.blob.core.windows.net/archive?sig=synthetic'},io.BytesIO())
  opener=Mock();opener.open.side_effect=[error,response]
  with patch.object(release.urllib.request,'build_opener',return_value=opener),patch.dict(os.environ,{'GITHUB_TOKEN':'synthetic-placeholder'}):
   self.assertEqual(release.get('https://api.github.com/artifact',True,True),b'zip bytes')
  self.assertEqual(opener.open.call_args_list[0].args[0].get_header('Authorization'),'Bearer synthetic-placeholder');self.assertIsNone(opener.open.call_args_list[1].args[0].get_header('Authorization'))
 def test_unknown_artifact_redirect_does_not_transmit(self):
  error=urllib.error.HTTPError('https://api.github.com/artifact',302,'redirect',{'Location':'https://untrusted.example/archive'},io.BytesIO());opener=Mock();opener.open.side_effect=error
  with patch.object(release.urllib.request,'build_opener',return_value=opener),patch.dict(os.environ,{'GITHUB_TOKEN':'synthetic-placeholder'}):
   with self.assertRaises(ValueError):release.get('https://api.github.com/artifact',True,True)
  self.assertEqual(opener.open.call_count,1)
 def test_expired_source_artifact_stops_before_archive_download(self):
  artifact,run,sha,digest,_=release.ARTIFACTS[0]
  with tempfile.TemporaryDirectory(dir=ROOT) as tmp,patch.object(release,'get',return_value=json.dumps({'id':artifact,'expired':True,'workflow_run':{'id':run,'head_sha':sha},'digest':'sha256:'+digest}).encode()) as request:
   with self.assertRaises(ValueError):release.verify({},pathlib.Path(tmp)/'release',lambda:None)
   self.assertEqual(request.call_count,1)
 def test_bad_block_collision_preserves_files(self):
  with tempfile.TemporaryDirectory(dir=ROOT) as tmp,patch.object(helper,'ROOT',pathlib.Path(tmp)):
   before=helper.main('inject',{});self.assertEqual(helper.main('out',{}),before);collision=pathlib.Path(tmp)/'blocks/single-tenant'/helper.BAD[0];collision.mkdir()
   with self.assertRaises(ValueError):helper.main('inverse',{})
   collision.rmdir();self.assertEqual(helper.main('inverse',{}),before)
if __name__=='__main__':unittest.main()
