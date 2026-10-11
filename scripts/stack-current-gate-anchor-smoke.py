"""Real read-only current gate signatures with independently supplied public anchors."""
import base64,datetime,json,pathlib,secrets,subprocess,sys,tempfile,uuid
from stack_campaign_evidence import bounded_json,identifier
from stack_business_fingerprint import fingerprint
ROOT=pathlib.Path(__file__).resolve().parent.parent
report={'completed':False,'checks':[],'businessDataWrites':False,'paidApiCalls':False,'credentialsRecorded':False,'deploymentAuthority':False}

def cli(arguments,expected=0):
 result=subprocess.run([sys.executable,'scripts/stack-review-preflight.py',*arguments],cwd=ROOT,capture_output=True,text=True,encoding='utf-8',timeout=90)
 value=json.loads(result.stdout)
 assert result.returncode==expected and value['completed']==(expected==0) and value['ownSessionLoggedOut'] is True
 assert value['businessDataWrites'] is False and value['deploymentAuthority'] is False and value['productionReady'] is False
 return value

try:
 before=fingerprint()
 candidates=sorted((ROOT/'.local').glob('stack-quality-campaign-*/summary.json'),key=lambda p:p.stat().st_mtime,reverse=True)
 reference=next(v for p in candidates if (v:=bounded_json(p,65536)).get('completed') and v.get('realLocalInference') and len(v.get('campaignIds',[]))==2)
 campaign=identifier(reference['campaignIds'][0]);key=ROOT/'.local/stack/gate-keys/public-key.pem'
 for name in ['demo-viewer','demo-admin']:
  value=cli(['--username',name,'--campaign',campaign,'--trusted-public-key',str(key)])
  assert value['signatureVerified'] is True and len(value['checks'])==5 and value['currentGateExpiresAtEpochMillis']>value['currentGateCheckedAtEpochMillis']
  assert value['currentGateExpiresAtEpochMillis']-value['currentGateCheckedAtEpochMillis']<=30000
 report['checks'].append('viewer and admin verify actual fresh Java signature with independent public PEM and expiry')
 foreign=cli(['--username','other-admin','--campaign',campaign,'--trusted-public-key',str(key)],1)
 assert foreign['failedStage']=='existing-campaign' and foreign.get('unexpectedHttpStatus')==404
 report['checks'].append('foreign organization cannot obtain the existing campaign observation')
 with tempfile.TemporaryDirectory(prefix='current-gate-anchor-owned-',dir=ROOT/'.local') as work:
  assert pathlib.Path(work).resolve().parent==(ROOT/'.local').resolve()
  wrong=pathlib.Path(work)/'wrong-public.pem';der=bytes.fromhex('302a300506032b6570032100')+secrets.token_bytes(32)
  wrong.write_text('-----BEGIN PUBLIC KEY-----\n'+base64.b64encode(der).decode()+'\n-----END PUBLIC KEY-----\n',encoding='ascii')
  refused=cli(['--campaign',campaign,'--trusted-public-key',str(wrong)],1)
  assert refused['signatureVerified'] is False and refused['failedStage']=='signed-current-gate'
  report['checks'].append('different independently selected Ed25519 key refuses the actual Java signature')
  invalid=pathlib.Path(work)/'not-public.pem';invalid.write_text('-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n',encoding='ascii')
  for arguments in [['--trusted-public-key',str(key)],['--campaign',campaign,'--trusted-public-key',str(invalid)]]:
   refused=cli(arguments,1);assert refused['failedStage']=='configuration' and 'loginPhase' not in refused
 report['checks'].append('missing campaign and non-public key fail before authentication; owned controls reclaimed')
 assert fingerprint()==before
 report.update(completed=True,businessTablesUnchanged=len(before),ownedTemporaryControlsRemoved=True)
except Exception as error:report.update(errorType=type(error).__name__,code='CURRENT_GATE_ANCHOR_UNVERIFIED')
finally:
 report['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();path=ROOT/'.local'/('stack-current-gate-anchor-'+str(uuid.uuid4())+'.json')
 with path.open('x',encoding='utf-8') as stream:stream.write(json.dumps(report,indent=2)+'\n')
 print(json.dumps({'completed':report['completed'],'checks':len(report['checks']),'errorType':report.get('errorType'),'businessTablesUnchanged':report.get('businessTablesUnchanged'),'reportPath':str(path)}))
if not report['completed']:raise SystemExit(1)
