"""Verify a separately pinned Console bundle; never deploys or expands the 16-image contract."""
import argparse,hashlib,importlib.util,json,pathlib,sys
from stack_console_release_contract import validate,require,IDENTITY,REF,REPOSITORY,identity,ALLOWED_REFS
ROOT=pathlib.Path(__file__).resolve().parent.parent

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--bundle',type=pathlib.Path,required=True);p.add_argument('--expected-revision',required=True);p.add_argument('--expected-checksums-sha256',required=True);p.add_argument('--docker-tools',action='store_true');p.add_argument('--trusted-root',type=pathlib.Path);p.add_argument('--expected-ref',default=REF,choices=sorted(ALLOWED_REFS));args=p.parse_args()
 m=validate(args.bundle,args.expected_revision,args.expected_checksums_sha256,expected_ref=args.expected_ref)
 spec=importlib.util.spec_from_file_location('full_delivery_verifier',ROOT/'scripts/stack-delivery-verify.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
 verifier=module.Verifier(args.bundle.resolve(),args.docker_tools,args.trusted_root)
 digest=m['image'].split('@sha256:')[1]
 for suffix,kind in [('signature','https://sigstore.dev/cosign/sign/v1'),('sbom','cyclonedx')]:
  name='console.'+suffix+'.bundle.json';path='/bundle/'+name if args.docker_tools else str((args.bundle/name).resolve())
  command=['verify-blob-attestation','--bundle',path,'--digest',digest,'--digestAlg','sha256','--type',kind,'--certificate-identity',identity(args.expected_ref),'--certificate-oidc-issuer','https://token.actions.githubusercontent.com','--certificate-github-workflow-repository',REPOSITORY,'--certificate-github-workflow-ref',args.expected_ref,'--certificate-github-workflow-sha',args.expected_revision]
  if args.trusted_root:command+=['--trusted-root','/trusted-root.json' if args.docker_tools else str(args.trusted_root.resolve())]
  require(verifier.run(command).returncode==0)
 require(validate(args.bundle,args.expected_revision,args.expected_checksums_sha256,expected_ref=args.expected_ref)==m)
 print(json.dumps({'completed':True,'revision':args.expected_revision,'scope':['stack-console'],'imageSignaturesCryptographicallyVerified':True,'sbomAttestationsCryptographicallyVerified':True,'highCriticalFindings':0,'actualDeploymentPerformed':False,'databaseChanged':False}));return 0
if __name__=='__main__':
 try:sys.exit(main())
 except Exception:print(json.dumps({'completed':False,'code':'CONSOLE_DELIVERY_UNVERIFIED','actualDeploymentPerformed':False}));sys.exit(1)
