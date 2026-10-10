"""Keyless sign and verify exact CI image digests and CycloneDX attestations only after clean scans."""
import base64,hashlib,json,os,pathlib,re,subprocess,uuid
root=pathlib.Path(__file__).resolve().parent.parent
assert os.environ.get('GITHUB_ACTIONS')=='true' and os.environ.get('GITHUB_REPOSITORY')=='automaster5013/AgentTrust' and os.environ.get('GITHUB_REF')=='refs/heads/main'
sha=os.environ['GITHUB_SHA'];assert re.fullmatch('[a-f0-9]{40}',sha)
reports=list((root/'.local').glob('stack-security-images-*/summary.json'));matches=[(path,json.loads(path.read_text(encoding='utf-8'))) for path in reports if json.loads(path.read_text(encoding='utf-8')).get('revision')==sha and json.loads(path.read_text(encoding='utf-8')).get('completed')]
assert len(matches)==1;path,scans=matches[0];assert scans['registryImageReferences'] and len(scans['images'])==9 and all(row['highCriticalFindings']==0 for row in scans['images'].values())
source=path.parent/'reports';delivery=root/'stack-delivery';destination=root/'stack-security-delivery';destination.mkdir()
identity='https://github.com/automaster5013/AgentTrust/.github/workflows/original-stack.yml@refs/heads/main'
issuer='https://token.actions.githubusercontent.com'
verify=['--certificate-identity',identity,'--certificate-oidc-issuer',issuer,'--certificate-github-workflow-repository','automaster5013/AgentTrust','--certificate-github-workflow-ref','refs/heads/main','--certificate-github-workflow-sha',sha]
proof={'completed':False,'revision':sha,'keylessIdentity':identity,'oidcIssuer':issuer,'highCriticalFindings':0,'images':{},'serverDeployed':False}
def cosign(args):
 assert os.name!='nt' and os.getuid()>0
 command=['docker','run','--rm','--user',str(os.getuid())+':'+str(os.getgid()),'--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--tmpfs','/tmp:size=128m,mode=1777','--memory','512m','--pids-limit','128','-e','HOME=/tmp','-e','DOCKER_CONFIG=/credentials','-e','ACTIONS_ID_TOKEN_REQUEST_URL','-e','ACTIONS_ID_TOKEN_REQUEST_TOKEN','-e','GITHUB_ACTIONS=true','--mount','type=bind,source='+str(root/'.local/stack-signing-credentials')+',target=/credentials,readonly','--mount','type=bind,source='+str(source)+',target=/reports,readonly','--mount','type=bind,source='+str(destination)+',target=/proof','agenttrust-security:local','cosign']+args
 result=subprocess.run(command,cwd=root,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=120)
 if result.returncode:
  print(json.dumps({'completed':False,'operation':args[0],'exitCode':result.returncode,'rawSecretsPrinted':False}),flush=True);raise RuntimeError('COSIGN_OPERATION_FAILED')
 return result.stdout
for name,row in scans['images'].items():
 reference=(delivery/(name+'.txt')).read_text().strip();assert reference==row['reference'] and re.fullmatch(r'ghcr\.io/automaster5013/agenttrust-'+name+r'@sha256:[a-f0-9]{64}',reference)
 digest=reference.split('@sha256:')[1];sbom=source/(name+'.cdx.json');assert hashlib.sha256(sbom.read_bytes()).hexdigest()==row['sbomSha256']
 cosign(['sign','--yes','--bundle','/proof/'+name+'.signature.bundle.json','--annotations','org.opencontainers.image.revision='+sha,reference])
 signatures=json.loads(cosign(['verify',*verify,reference]));assert signatures and any(item['critical']['image']['docker-manifest-digest']=='sha256:'+digest and item['optional'].get('org.opencontainers.image.revision')==sha for item in signatures)
 cosign(['attest','--yes','--type','cyclonedx','--predicate','/reports/'+name+'.cdx.json','--bundle','/proof/'+name+'.sbom.bundle.json',reference])
 raw=cosign(['verify-attestation',*verify,'--type','cyclonedx',reference])
 try:
  attestations=json.loads(raw);attestations=attestations if isinstance(attestations,list) else [attestations]
 except json.JSONDecodeError:attestations=[json.loads(line) for line in raw.splitlines() if line.strip()]
 matched=False
 for entry in attestations:
  statement=json.loads(base64.b64decode(entry['payload'],validate=True));subjects=statement.get('subject',[])
  if any(item.get('digest',{}).get('sha256')==digest for item in subjects) and statement.get('predicateType')=='https://cyclonedx.org/bom' and statement.get('predicate')==json.loads(sbom.read_text(encoding='utf-8')):matched=True
 assert matched
 for suffix in ['cdx.json','trivy.json']:(destination/(name+'.'+suffix)).write_bytes((source/(name+'.'+suffix)).read_bytes())
 proof['images'][name]={'reference':reference,'imageId':row['imageId'],'components':row['components'],'sbomSha256':row['sbomSha256'],'vulnerabilityReportSha256':row['vulnerabilityReportSha256'],'keylessSignatureVerified':True,'sbomAttestationVerified':True}
 print(json.dumps({'image':name,'signatureVerified':True,'sbomAttestationVerified':True,'rawSecretsPrinted':False}),flush=True)
manifest=json.loads((delivery/'manifest.json').read_text(encoding='utf-8'));assert manifest['revision']==sha and manifest['images']=={name:row['reference'] for name,row in proof['images'].items()} and manifest['registryImagesRuntimeVerified']
proof['completed']=True;manifest.update({'schemaVersion':2,'imageSecurityVerified':True,'keylessSignaturesVerified':True,'sbomAttestationsVerified':True,'highCriticalFindings':0,'securityProof':'security-proof.json','deliveryStatus':'security-verified-signed'})
for name in ['runtime-identity.json','revision.txt']:(destination/name).write_bytes((delivery/name).read_bytes())
(destination/'security-proof.json').write_text(json.dumps(proof,indent=2)+'\n',encoding='utf-8');(destination/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
checksums={item.name:hashlib.sha256(item.read_bytes()).hexdigest() for item in destination.iterdir() if item.is_file()};(destination/'checksums.json').write_text(json.dumps(checksums,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'completed':True,'signedAndVerifiedImages':len(proof['images']),'serverDeployed':False,'rawSecretsPrinted':False}))
