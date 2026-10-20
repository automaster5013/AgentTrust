"""Compare actual before/after console builds only on the disposable GitHub integration runner."""
import argparse,datetime,hashlib,io,json,os,pathlib,subprocess,sys,tarfile,uuid
from stack_compose import stack_compose
from stack_business_fingerprint import fingerprint
R=pathlib.Path.cwd();L=R/'.local';OUT=L/'ui-visual/comparison.json';BASE='56797c81fdae20666298f1e21691de17f0908d3e'
a=argparse.ArgumentParser();a.add_argument('--execute',action='store_true');args=a.parse_args();assert args.execute and os.environ.get('GITHUB_ACTIONS')=='true' and os.environ.get('GITHUB_REPOSITORY')=='automaster5013/AgentTrust' and not OUT.exists()
d={'completed':False,'baselineRevision':BASE,'candidateRevision':os.environ['GITHUB_SHA'],'productionDeploymentPerformed':False,'customerDataUsed':False,'rawToolOutputRecorded':False,'phase':'runner-contract'};OUT.parent.mkdir(parents=True,exist_ok=True)
def run(cmd,timeout=60,env=None):
 p=subprocess.run(cmd,cwd=R,capture_output=True,timeout=timeout,env=env)
 if p.returncode:raise RuntimeError('VISUAL_COMPARISON_COMMAND_FAILED')
 return p.stdout
def inspect(cid):return json.loads(run(['docker','inspect',cid]))[0]
def peers():
 ids=run(['docker','ps','-aq','--filter','label=com.docker.compose.project='+project]).decode().split();rows=json.loads(run(['docker','inspect',*ids]));return {x['Name']:{'id':x['Id'],'image':x['Image'],'startedAt':x['State']['StartedAt']} for x in rows if x['Config']['Labels'].get('com.docker.compose.service')!='stack-console'}
def replace(image):
 overlay=L/('ui-visual-overlay-'+uuid.uuid4().hex+'.json');overlay.write_text(json.dumps({'services':{'stack-console':{'image':image}}}));run(stack_compose(R)+['-f',str(overlay),'up','-d','--no-build','--no-deps','--pull','never','--force-recreate','--wait','--wait-timeout','180','stack-console'],240)
def capture(label):
 previous=set(L.glob('stack-browser-*.json'));env=dict(os.environ,STACK_E2E_VISUAL_CAPTURE='true',STACK_E2E_VISUAL_LABEL=label,STACK_E2E_READ_ONLY='true',STACK_E2E_QUOTA_GUARD='true')
 p=subprocess.run(['node','node_modules/@playwright/test/cli.js','test','--grep','workspace controlled visual capture uses actual viewer and stable evaluation data'],cwd=R/'apps/console',env=env,capture_output=True,timeout=240);
 if p.returncode:d['failedCaptureLabel']=label;d['captureExitCode']=p.returncode;d['captureNoTestsFound']=b'No tests found' in p.stdout+p.stderr
 assert p.returncode==0
 reports=set(L.glob('stack-browser-*.json'))-previous;assert len(reports)==1;proof=json.loads(reports.pop().read_text());assert proof['completed'] and len(proof['tests'])==1 and proof['tests'][0]['status']=='passed'
 phases=proof['tests'][0]['phases'];keys=[x.split()[-1] for x in phases if x.startswith('controlled-visual-cohort-sha256 ')];assert len(keys)==1;return keys[0]
restored=False;changed=False
try:
 cid=run(stack_compose(R)+['ps','-q','stack-console']).decode().strip();current=inspect(cid);project=current['Config']['Labels']['com.docker.compose.project'];assert project==os.environ.get('COMPOSE_PROJECT_NAME','agenttrust') and current['State']['Health']['Status']=='healthy';original=current['Image'];before=peers();business=fingerprint()
 run(['git','cat-file','-e',BASE+':apps/console/Dockerfile']);raw=run(['git','archive',BASE,'apps/console']);assert len(raw)<33554432;context=L/('ui-baseline-'+uuid.uuid4().hex);context.mkdir()
 with tarfile.open(fileobj=io.BytesIO(raw)) as archive:
  for member in archive.getmembers():assert (member.isfile() or member.isdir()) and not member.name.startswith('/') and '..' not in pathlib.PurePosixPath(member.name).parts
  archive.extractall(context,filter='data')
 tag='agenttrust-console:visual-baseline-'+BASE[:12];run(['docker','build','-t',tag,str(context/'apps/console')],1200);baseline=run(['docker','image','inspect',tag,'--format','{{.Id}}']).decode().strip();assert baseline.startswith('sha256:')
 changed=True;d['phase']='baseline-render';replace(baseline);d['beforeCohortSha256']=capture('before');assert peers()==before and fingerprint()==business
 d['phase']='candidate-render';replace(original);restored=True;d['afterCohortSha256']=capture('after');assert d['beforeCohortSha256']==d['afterCohortSha256'] and peers()==before and fingerprint()==business
 images={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in OUT.parent.glob('*.png')};assert set(images)=={'before-1440.png','after-1440.png','before-390.png','after-390.png'}
 d.update(completed=True,phase='comparison-captured-awaiting-human-review',sameViewerDataAndViewports=True,business18Unchanged=True,otherServiceInstancesUnchanged=True,candidateConsoleImageRestored=True,screenshots=images,humanVisualReviewPerformed=False)
except Exception as error:d['failureClass']=type(error).__name__
finally:
 if changed and not restored:
  try:replace(original);restored=True
  except Exception as error:d['restorationFailureClass']=type(error).__name__
 d['candidateConsoleImageRestored']=restored;d['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();OUT.write_text(json.dumps(d,indent=2)+'\n');print(json.dumps({'completed':d['completed'],'candidateConsoleImageRestored':restored,'failureClass':d.get('failureClass'),'proof':str(OUT)}))
if not d['completed']:raise SystemExit(1)
