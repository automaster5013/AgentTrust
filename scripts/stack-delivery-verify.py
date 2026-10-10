"""Read-only supply-chain verification. Requires independently pinned revision and checksum-map hash."""
import argparse,base64,hashlib,json,pathlib,re,shutil,subprocess,sys

IMAGES=('core-api','ai-worker','console','opa','identity','gateway','object-store','database','local-model','messaging')
FILES={name+'.'+suffix for name in IMAGES for suffix in ['cdx.json','trivy.json','signature.bundle.json','sbom.bundle.json']}|{'revision.txt','manifest.json','runtime-identity.json','security-proof.json','checksums.json'}
MAX_FILE=8388608
MAX_TOTAL=67108864

def digest(raw):return hashlib.sha256(raw).hexdigest()

def require(condition):
    if not condition:raise ValueError('Delivery verification failed')

def unique(pairs):
    result={}
    for key,value in pairs:
        if key in result:raise ValueError('Ambiguous JSON')
        result[key]=value
    return result

def json_bytes(raw):return json.loads(raw.decode('utf-8'),object_pairs_hook=unique)

def statement(frame):
    envelope=frame['dsseEnvelope']
    require(envelope['payloadType']=='application/vnd.in-toto+json')
    encoded=envelope['payload']
    require(isinstance(encoded,str) and len(encoded)<=MAX_FILE)
    raw=base64.b64decode(encoded,validate=True)
    require(base64.b64encode(raw).decode()==encoded)
    value=json_bytes(raw)
    require(value['_type'] in ['https://in-toto.io/Statement/v1','https://in-toto.io/Statement/v0.1'])
    return value

def validate(directory,revision,checksums_hash,repository):
    require(re.fullmatch('[a-f0-9]{40}',revision) and re.fullmatch('[a-f0-9]{64}',checksums_hash))
    require(re.fullmatch('[A-Za-z0-9-]+/[A-Za-z0-9_.-]+',repository))
    directory=directory.resolve(strict=True)
    require(directory.is_dir() and {path.name for path in directory.iterdir()}==FILES)
    values={};total=0
    for name in sorted(FILES):
        path=directory/name
        require(path.is_file() and not path.is_symlink() and path.resolve().parent==directory)
        size=path.stat().st_size
        require(0<size<=MAX_FILE)
        total+=size
        require(total<=MAX_TOTAL)
        raw=path.read_bytes()
        require(len(raw)==size)
        values[name]=raw
    require(values['revision.txt'].decode('utf-8').strip()==revision)
    require(digest(values['checksums.json'])==checksums_hash)
    checksums=json_bytes(values['checksums.json'])
    require(set(checksums)==FILES-{'checksums.json'})
    require(all(isinstance(value,str) and re.fullmatch('[a-f0-9]{64}',value) and digest(values[name])==value for name,value in checksums.items()))
    manifest=json_bytes(values['manifest.json']);runtime=json_bytes(values['runtime-identity.json']);proof=json_bytes(values['security-proof.json'])
    require(manifest['schemaVersion']==2 and manifest['revision']==runtime['revision']==proof['revision']==revision)
    require(set(manifest['images'])==set(runtime['images'])==set(proof['images'])==set(IMAGES))
    require(manifest['images']==runtime['images'] and runtime['runtimeImageIdentityVerified'] is True)
    require(all(manifest[key] is True for key in ['sourceIntegrationPassed','registryImagesRuntimeVerified','imageSecurityVerified','keylessSignaturesVerified','sbomAttestationsVerified']))
    require(manifest['deliveryStatus']=='security-verified-signed')
    require(manifest['serverDeployed'] is False and proof['serverDeployed'] is False)
    require(manifest['productionSecurityVerified'] is False and manifest['officialObservabilitySecurityVerified'] is False)
    identity='https://github.com/'+repository+'/.github/workflows/original-stack.yml@refs/heads/main'
    require(proof['completed'] is True and proof['keylessIdentity']==identity)
    require(proof['oidcIssuer']=='https://token.actions.githubusercontent.com')
    require(type(proof['highCriticalFindings']) is int and proof['highCriticalFindings']==0)
    owner=repository.split('/')[0].lower()
    records=[]
    for name in IMAGES:
        reference=manifest['images'][name]
        require(re.fullmatch('ghcr\\.io/'+re.escape(owner)+'/agenttrust-'+name+'@sha256:[a-f0-9]{64}',reference))
        image_digest=reference.split('@sha256:')[1]
        sbom=json_bytes(values[name+'.cdx.json']);scan=json_bytes(values[name+'.trivy.json']);metadata=proof['images'][name]
        require(sbom['bomFormat']=='CycloneDX' and isinstance(sbom['components'],list))
        require(metadata['reference']==reference and metadata['components']==len(sbom['components']))
        require(metadata['sbomSha256']==digest(values[name+'.cdx.json']) and metadata['vulnerabilityReportSha256']==digest(values[name+'.trivy.json']))
        require(metadata['keylessSignatureVerified'] is True and metadata['sbomAttestationVerified'] is True)
        require(scan['SchemaVersion']==2 and isinstance(scan['Results'],list) and 1<=len(scan['Results'])<=32)
        for result in scan['Results']:
            vulnerabilities=result.get('Vulnerabilities') or []
            require(isinstance(vulnerabilities,list))
            require(all(row.get('Severity') not in ['HIGH','CRITICAL'] for row in vulnerabilities))
        signed=statement(json_bytes(values[name+'.signature.bundle.json']))
        require(signed['predicateType']=='https://sigstore.dev/cosign/sign/v1' and signed['predicate']=={})
        require(len(signed['subject'])==1 and signed['subject'][0]['digest']=={'sha256':image_digest})
        require(signed['subject'][0]['annotations']['org.opencontainers.image.revision']==revision)
        attested=statement(json_bytes(values[name+'.sbom.bundle.json']))
        require(attested['predicateType']=='https://cyclonedx.org/bom' and attested['predicate']==sbom)
        require(len(attested['subject'])==1 and attested['subject'][0]['digest']=={'sha256':image_digest})
        records.append({'name':name,'reference':reference,'digest':image_digest})
    return directory,identity,records

class Verifier:
    def __init__(self,directory,docker_tools,trusted_root):
        self.directory=directory;self.docker_tools=docker_tools;self.root=trusted_root
        if trusted_root:
            require(trusted_root.is_file() and not trusted_root.is_symlink() and 0<trusted_root.stat().st_size<=1048576)
            root_document=json_bytes(trusted_root.read_bytes())
            require(root_document.get('mediaType')=='application/vnd.dev.sigstore.trustedroot+json;version=0.1')
        if docker_tools:
            result=self.command(['docker','image','inspect','agenttrust-security:local'])
            require(result.returncode==0)
            self.image=json.loads(result.stdout)[0]['Id']
            require(re.fullmatch('sha256:[a-f0-9]{64}',self.image))
        else:
            self.executable=shutil.which('cosign')
            require(self.executable)
        result=self.run(['version','--json'])
        require(result.returncode==0 and json.loads(result.stdout)['gitVersion']=='v3.1.3')

    @staticmethod
    def command(args):
        return subprocess.run(args,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=90)

    def run(self,args):
        if not self.docker_tools:return self.command([self.executable]+args)
        base=['docker','run','--rm','--network','none' if self.root else 'bridge','--read-only','--cap-drop','ALL',
              '--security-opt','no-new-privileges:true','--tmpfs','/tmp:size=128m,mode=1777',
              '--memory','512m','--cpus','2','--pids-limit','128','-e','HOME=/tmp','-e','XDG_CACHE_HOME=/tmp/cache',
              '--mount','type=bind,source='+str(self.directory)+',target=/bundle,readonly']
        if self.root:base+=['--mount','type=bind,source='+str(self.root.resolve())+',target=/trusted-root.json,readonly']
        return self.command(base+[self.image,'cosign']+args)

    def verify(self,records,identity,repository,revision):
        for record in records:
            for suffix,kind in [('signature.bundle.json','https://sigstore.dev/cosign/sign/v1'),('sbom.bundle.json','cyclonedx')]:
                path='/bundle/'+record['name']+'.'+suffix if self.docker_tools else str(self.directory/(record['name']+'.'+suffix))
                args=['verify-blob-attestation','--bundle',path,'--digest',record['digest'],'--digestAlg','sha256','--type',kind,
                      '--certificate-identity',identity,'--certificate-oidc-issuer','https://token.actions.githubusercontent.com',
                      '--certificate-github-workflow-repository',repository,'--certificate-github-workflow-ref','refs/heads/main',
                      '--certificate-github-workflow-sha',revision]
                if self.root:args+=['--trusted-root','/trusted-root.json' if self.docker_tools else str(self.root.resolve())]
                result=self.run(args)
                require(result.returncode==0)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle',type=pathlib.Path,required=True)
    parser.add_argument('--expected-revision',required=True)
    parser.add_argument('--expected-checksums-sha256',required=True)
    parser.add_argument('--repository',required=True)
    parser.add_argument('--docker-tools',action='store_true')
    parser.add_argument('--trusted-root',type=pathlib.Path,help='Separately trusted Sigstore TrustedRoot JSON; Docker verification then uses no network')
    args=parser.parse_args()
    stage='artifact-metadata'
    try:
        directory,identity,records=validate(args.bundle,args.expected_revision,args.expected_checksums_sha256,args.repository)
        stage='verification-tools'
        verifier=Verifier(directory,args.docker_tools,args.trusted_root)
        stage='cryptographic-verification'
        verifier.verify(records,identity,args.repository,args.expected_revision)
        # Refuse concurrent changes during the external cryptographic checks.
        stage='artifact-recheck'
        require(validate(directory,args.expected_revision,args.expected_checksums_sha256,args.repository)==(directory,identity,records))
        print(json.dumps({'completed':True,'revision':args.expected_revision,'manifestPinned':True,'checksumsPinned':True,
                          'images':len(records),'imageSignaturesCryptographicallyVerified':True,
                          'sbomAttestationsCryptographicallyVerified':True,'highCriticalFindings':0,
                          'publicTrustRootNetworkAllowed':args.trusted_root is None,
                          'vulnerabilityReportIntegrityVerified':True,'newVulnerabilityScanPerformed':False,
                          'registryRuntimeExecutedHere':False,
                          'productionDeploymentApproved':False,'actualDeploymentPerformed':False,
                          'registryCredentialsMounted':False,'claimsBypassUsed':False}))
        return 0
    except Exception:
        print(json.dumps({'completed':False,'code':'STACK_DELIVERY_UNVERIFIED','failedStage':stage,'productionDeploymentApproved':False,'actualDeploymentPerformed':False}))
        return 1

if __name__=='__main__':sys.exit(main())
