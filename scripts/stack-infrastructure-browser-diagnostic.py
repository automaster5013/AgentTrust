"""Read a bound existing CI browser artifact; emit fixed classifications only."""
import hashlib,io,json,os,pathlib,re,shutil,time,urllib.error,urllib.parse,urllib.request,zipfile

def admit():
 available=int(next(x.split()[1] for x in pathlib.Path('/proc/meminfo').read_text().splitlines() if x.startswith('MemAvailable:')))*1024
 assert available>=2*1073741824+256*1048576 and shutil.disk_usage('.').free>=22*1073741824+512*1048576

def main():
 admit();revision=os.environ['DIAGNOSTIC_REVISION'];run_id=os.environ['DIAGNOSTIC_RUN_ID'];assert re.fullmatch('[a-f0-9]{40}',revision) and re.fullmatch('[1-9][0-9]{0,14}',run_id)
 token=os.environ['GH_TOKEN'];base='https://api.github.com/repos/automaster5013/AgentTrust/'
 def get(path):
  with urllib.request.urlopen(urllib.request.Request(base+path,headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json'}),timeout=30) as response:raw=response.read(1048577)
  assert len(raw)<=1048576;return json.loads(raw)
 run=get('actions/runs/'+run_id);assert run['head_sha']==revision and run['head_branch']=='main' and run['event']=='push' and run['path']=='.github/workflows/original-stack.yml' and run['status']=='completed'
 rows=[a for a in get('actions/runs/'+run_id+'/artifacts')['artifacts'] if a['name']=='original-stack-registry-diagnostics-'+revision and not a['expired']];assert len(rows)==1;artifact=rows[0];assert artifact['size_in_bytes']<=4194304
 class NoRedirect(urllib.request.HTTPRedirectHandler):
  def redirect_request(self,*args):return None
 opener=urllib.request.build_opener(NoRedirect())
 try:response=opener.open(urllib.request.Request(base+'actions/artifacts/'+str(artifact['id'])+'/zip',headers={'Authorization':'Bearer '+token}),timeout=30)
 except urllib.error.HTTPError as error:
  assert error.code==302;location=error.headers['Location'];url=urllib.parse.urlsplit(location);assert url.scheme=='https' and url.hostname and (url.hostname.endswith('.blob.core.windows.net') or url.hostname.endswith('.actions.githubusercontent.com')) and not url.username and not url.password and url.port in [None,443];response=opener.open(location,timeout=30)
 with response:raw=response.read(4194305)
 admit();assert len(raw)<=4194304 and 'sha256:'+hashlib.sha256(raw).hexdigest()==artifact['digest'];reports=[]
 with zipfile.ZipFile(io.BytesIO(raw)) as archive:
  entries=archive.infolist();assert len(entries)<=256 and len(entries)==len(set(archive.namelist())) and sum(x.file_size for x in entries)<=16777216
  for entry in entries:
   assert not entry.flag_bits&1 and entry.external_attr>>16 & 0o170000 !=0o120000 and not pathlib.PurePosixPath(entry.filename).is_absolute() and '..' not in pathlib.PurePosixPath(entry.filename).parts
   if re.fullmatch(r'(?:\.local/)?stack-browser-[a-f0-9-]{36}\.json',entry.filename):
    assert entry.file_size<=1048576;reports.append(json.loads(archive.read(entry)))
 assert reports;result={'completed':True,'revision':revision,'sourceRunId':int(run_id),'artifactId':artifact['id'],'artifactDigest':artifact['digest'],'archiveDigestVerified':True,'priorFailedRunRelabeledPassed':False,'browserRerunPerformed':False,'reports':[]}
 categories=['none','browser-launch','missing-local-tool','quota-preflight-command','strict-locator','test-timeout','visibility-assertion','count-assertion','text-assertion','value-assertion','unclassified']
 flags=['jsonParse','responseBodyUnavailable','responseWaitTimeout','actionTimeout','closedContext','abortedRequest','disabledElement','detachedElement','testTimeout','strictLocator']
 timings=['domainLookupStart','domainLookupEnd','connectStart','secureConnectionStart','connectEnd','requestStart','responseStart','responseEnd']
 for report in reports:
  assert report['credentialsRecorded'] is False and report['headlessFunctionalTests'] is True and isinstance(report['tests'],list) and len(report['tests'])<=128;failed=[]
  for index,test in enumerate(report['tests']):
   assert test['status'] in ['passed','failed','timedOut','skipped','interrupted']
   if test['status']=='passed':continue
   assert test['failureCategory'] in categories;line=test['sourceLine'];assert line is None or re.fullmatch('[0-9]{1,6}',line)
   failure={'testIndex':index,'status':test['status'],'sourceLine':None if line is None else int(line),'failureCategory':test['failureCategory'],'completedPhaseCount':len(test['phases']),'failureDetails':[],'networkDetails':[]}
   for detail in test['failureDetails']:
    assert detail['errorKind'] in ['Error','TimeoutError','SyntaxError','AssertionError','TypeError','other','none'];assert all(type(detail[k]) is bool for k in flags);failure['failureDetails'].append({k:detail[k] for k in ['errorKind',*flags]})
   for detail in test['networkDetails']:
    assert detail['kind'] in ['identity-bootstrap','oidc-callback','campaign-admission','campaign-review'] and detail['event'] in ['response','finished','failed'] and detail['failure'] in ['none','aborted','failed','connection-reset','timeout','other'];status=detail['status'];assert status is None or type(status) is int and 100<=status<=599
    timing={k:v for k,v in detail['timing'].items() if k in timings and type(v) in [int,float] and -1<=v<=300000};failure['networkDetails'].append({'kind':detail['kind'],'event':detail['event'],'status':status,'failure':detail['failure'],'timing':timing})
   failed.append(failure)
  result['reports'].append({'testCount':len(report['tests']),'completed':report['completed'],'failedTests':failed})
 print(json.dumps(result,separators=(',',':')))

if __name__=='__main__':
 try:main()
 except Exception as error:print(json.dumps({'completed':False,'errorType':type(error).__name__,'rawBodyUrlOrErrorPrinted':False}));raise SystemExit(1)
