"""Generate public client settings or check a bounded JSON document; never contact an IdP."""
import argparse,json,sys
from stack_oidc_client_contract import expected,verify
MAX_BYTES=1048576
def unique_pairs(pairs):
 result={}
 for key,value in pairs:
  if key in result:raise ValueError('Duplicate JSON key')
  result[key]=value
 return result
def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--mode',choices=['draft','check'],required=True);parser.add_argument('--profile',required=True);parser.add_argument('--application-origin',required=True);parser.add_argument('--public-issuer',required=True);args=parser.parse_args()
 report={'completed':False,'identityContacted':False,'configurationApplied':False,'productionIdentityVerified':False,'inputEchoed':False}
 try:
  contract=expected(args.profile,args.application_origin,args.public_issuer)
  if args.mode=='draft':report['publicClientSettings']=contract
  else:
   raw=sys.stdin.buffer.read(MAX_BYTES+1)
   if len(raw)>MAX_BYTES:raise ValueError('Input exceeds bound')
   client=json.loads(raw.decode('utf-8'),object_pairs_hook=unique_pairs,parse_constant=lambda _:(_ for _ in ()).throw(ValueError('Invalid JSON number')))
   if not isinstance(client,dict):raise ValueError('Expected client object')
   verify(client,args.profile,args.application_origin,args.public_issuer);report['clientContractMatches']=True
  report['completed']=True
 except Exception as error:report.update(code='OIDC_CLIENT_CONFIGURATION_UNVERIFIED',errorType=type(error).__name__)
 print(json.dumps(report));return 0 if report['completed'] else 1
if __name__=='__main__':raise SystemExit(main())
