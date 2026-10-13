"""Read image-bound OIDC intent; no registry authentication or deployment."""
import argparse,json,pathlib,re,subprocess
ROOT=pathlib.Path(__file__).resolve().parent.parent
def validate(profile,origin,issuer):
 if profile=='local-review':
  if origin!='http://127.0.0.1:4320' or issuer!='http://127.0.0.1:4322/realms/agenttrust':raise ValueError('Invalid endpoint contract')
 elif profile=='https-review':
  host=r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+'
  for value,path in [(origin,''),(issuer,'/realms/agenttrust')]:
   match=re.fullmatch('https://('+host+')'+re.escape(path),value)
   if len(value)>300 or not match or re.fullmatch('[0-9.]+',match.group(1)) or match.group(1).endswith(('.local','.localhost','.internal')):raise ValueError('Invalid endpoint contract')
 else:raise ValueError('Invalid endpoint contract')
def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--image',required=True);parser.add_argument('--profile',required=True);parser.add_argument('--application-origin',required=True);parser.add_argument('--public-issuer',required=True);args=parser.parse_args()
 report={'completed':False,'imageBytesAuthenticatedHere':False,'productionDeploymentApproved':False,'deploymentPerformed':False,'registryCredentialsUsed':False}
 try:
  validate(args.profile,args.application_origin,args.public_issuer)
  if not (re.fullmatch(r'ghcr\.io/automaster5013/agenttrust-console@sha256:[a-f0-9]{64}',args.image) or re.fullmatch(r'agenttrust-stack-console:oidc-endpoint-(local|https)-candidate',args.image)):raise ValueError('Image outside verified console scope')
  result=subprocess.run(['docker','image','inspect','--format','{{json .Config.Labels}}',args.image],cwd=ROOT,capture_output=True,text=True,encoding='utf-8',timeout=30,check=True)
  if len(result.stdout)>16384:raise ValueError('Image metadata exceeds bound')
  labels=json.loads(result.stdout);expected={'profile':args.profile,'application-origin':args.application_origin,'public-issuer':args.public_issuer}
  if any(labels.get('dev.agenttrust.oidc.'+key)!=value for key,value in expected.items()):raise ValueError('Image intent mismatch')
  report.update(completed=True,profile=args.profile,endpointContractMatchesImage=True,imageReferencePinned='@sha256:' in args.image)
 except Exception as error:report.update(errorType=type(error).__name__,code='OIDC_IMAGE_CONFIGURATION_UNVERIFIED')
 print(json.dumps(report));return 0 if report['completed'] else 1
if __name__=='__main__':raise SystemExit(main())
