"""Generate public client settings or check a bounded JSON document; never contact an IdP."""
import argparse,json,sys
from stack_oidc_client_contract import expected,verify
from stack_oidc_json import object_from_bytes
MAX_BYTES=1048576
def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--mode',choices=['draft','check'],required=True);parser.add_argument('--profile',required=True);parser.add_argument('--application-origin',required=True);parser.add_argument('--public-issuer',required=True);args=parser.parse_args()
 report={'completed':False,'identityContacted':False,'configurationApplied':False,'productionIdentityVerified':False,'inputEchoed':False}
 try:
  contract=expected(args.profile,args.application_origin,args.public_issuer)
  if args.mode=='draft':report['publicClientSettings']=contract
  else:
   raw=sys.stdin.buffer.read(MAX_BYTES+1)
   client=object_from_bytes(raw,MAX_BYTES)
   verify(client,args.profile,args.application_origin,args.public_issuer);report['clientContractMatches']=True
  report['completed']=True
 except Exception as error:report.update(code='OIDC_CLIENT_CONFIGURATION_UNVERIFIED',errorType=type(error).__name__)
 print(json.dumps(report));return 0 if report['completed'] else 1
if __name__=='__main__':raise SystemExit(main())
