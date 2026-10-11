"""Repeated independent signed read-only reviews; no evaluation or approval writes."""
import argparse,base64,datetime,hashlib,json,pathlib,shutil,subprocess,sys,time,uuid
from stack_campaign_evidence import bounded_json,identifier
from stack_business_fingerprint import fingerprint
ROOT=pathlib.Path(__file__).resolve().parent.parent
parser=argparse.ArgumentParser();parser.add_argument('--minutes',type=int,default=15);parser.add_argument('--campaign');parser.add_argument('--require-baseline',action='store_true');args=parser.parse_args()
if not 1<=args.minutes<=120:raise SystemExit('Unsupported bounded observation window')
if args.require_baseline and not args.campaign:raise SystemExit('Baseline observation requires an explicit campaign')
directory=ROOT/'.local'/('stack-signed-review-soak-'+str(uuid.uuid4()));directory.mkdir()
report={'completed':False,'requestedMinutes':args.minutes,'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'rounds':0,'signedReviews':0,'businessDataWrites':False,'paidApiCalls':False,'deploymentAuthority':False,'productionReady':False,'credentialsRecorded':False,'customerSlaVerified':False}
def save():
 temporary=directory/'summary.next.json';temporary.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');temporary.replace(directory/'summary.json')
try:
 before=fingerprint();key=ROOT/'.local/stack/gate-keys/public-key.pem'
 with key.open('rb') as stream:raw=stream.read(4097)
 assert len(raw)<=4096;lines=raw.decode('ascii').splitlines();assert lines[0]=='-----BEGIN PUBLIC KEY-----' and lines[-1]=='-----END PUBLIC KEY-----'
 der=base64.b64decode(''.join(lines[1:-1]),validate=True)
 assert len(der)==44 and der[:12]==bytes.fromhex('302a300506032b6570032100');key_id=hashlib.sha256(der).hexdigest()
 if args.campaign:campaign=identifier(args.campaign)
 else:
  sources=sorted((ROOT/'.local').glob('stack-quality-campaign-*/summary.json'),key=lambda p:p.stat().st_mtime,reverse=True)
  reference=next(v for p in sources if (v:=bounded_json(p,65536)).get('completed') and v.get('realLocalInference') and len(v.get('campaignIds',[]))==2)
  campaign=identifier(reference['campaignIds'][0])
 report['campaignSelectedExplicitly']=args.campaign is not None;report['campaignId']=campaign
 pins=None;started=time.monotonic();deadline=started+args.minutes*60
 while time.monotonic()<deadline:
  if shutil.disk_usage(ROOT).free<22*1073741824:raise ValueError('Insufficient development headroom')
  began=time.monotonic()
  for name,role in [('demo-viewer','viewer'),('demo-admin','admin')]:
   result=subprocess.run([sys.executable,'scripts/stack-review-preflight.py','--username',name,'--campaign',campaign,'--trusted-public-key',str(key)],cwd=ROOT,capture_output=True,text=True,encoding='utf-8',timeout=90)
   assert len(result.stdout)<=65536;value=json.loads(result.stdout)
   assert result.returncode==0 and value['completed'] and value['ownSessionLoggedOut'] and value['ownIdentityProviderSessionClosed'] and value['signatureVerified'] and value['role']==role
   assert value['businessDataWrites'] is False and value['paidApiCalls'] is False and value['deploymentAuthority'] is False and value['productionReady'] is False and value['imageSecurityVerified'] is False
   assert value['trustedGateKeyId']==key_id and len(value['checks'])==5
   if args.require_baseline:
    assert value.get('releaseRequirementsBound') is True and isinstance(value.get('releaseRequirementsSha256'),str) and len(value['releaseRequirementsSha256'])==64
   current=(value['scopeSha256'],value['parentContentSha256'],value['childArchivesVerified'],value.get('releaseRequirementsBound'),value.get('releaseRequirementsSha256'))
   if pins is None:pins=current
   assert current==pins
   report['releaseRequirementsBound']=value.get('releaseRequirementsBound',False)
   report['releaseRequirementsSha256']=value.get('releaseRequirementsSha256')
   report['signedReviews']+=1
  report['rounds']+=1;report['elapsedSeconds']=round(time.monotonic()-started,3);report['minimumCDriveFreeBytes']=min(report.get('minimumCDriveFreeBytes',shutil.disk_usage(ROOT).free),shutil.disk_usage(ROOT).free);save()
  while time.monotonic()<min(began+60,deadline):time.sleep(max(0,min(1,min(began+60,deadline)-time.monotonic())))
 assert fingerprint()==before
 report.update(completed=True,businessTablesUnchanged=len(before),observedSeconds=round(time.monotonic()-started,3),allOwnSessionsLoggedOut=True)
except Exception as error:report.update(errorType=type(error).__name__,code='SIGNED_REVIEW_SOAK_UNVERIFIED')
finally:
 report['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();save()
 print(json.dumps({'completed':report['completed'],'rounds':report['rounds'],'signedReviews':report['signedReviews'],'errorType':report.get('errorType'),'reportPath':str(directory/'summary.json')}))
if not report['completed']:raise SystemExit(1)
