"""Negative trust-boundary tests; fake metadata is never accepted as a signed delivery."""
import base64,hashlib,importlib.util,json,pathlib,subprocess,sys,unittest,uuid

spec=importlib.util.spec_from_file_location('delivery',pathlib.Path(__file__).with_name('stack-delivery-verify.py'))
delivery=importlib.util.module_from_spec(spec);spec.loader.exec_module(delivery)
root=pathlib.Path(__file__).resolve().parent.parent
directory=root/'.local'/('stack-delivery-verifier-test-'+str(uuid.uuid4()));directory.mkdir(parents=True)
revision='1'*40;repository='automaster5013/AgentTrust'

def raw(value):return json.dumps(value,separators=(',',':')).encode()

def fixture(label):
    folder=directory/label;folder.mkdir()
    images={name:'ghcr.io/automaster5013/agenttrust-'+name+'@sha256:'+'1'*64 for name in delivery.IMAGES}
    values={'revision.txt':revision.encode()+b'\n'}
    manifest={'schemaVersion':2,'revision':revision,'images':images,'sourceIntegrationPassed':True,
              'registryImagesRuntimeVerified':True,'imageSecurityVerified':True,'keylessSignaturesVerified':True,
              'sbomAttestationsVerified':True,'deliveryStatus':'security-verified-signed','serverDeployed':False,
              'productionSecurityVerified':False,'officialObservabilitySecurityVerified':False}
    runtime={'revision':revision,'images':images,'runtimeImageIdentityVerified':True}
    proof={'revision':revision,'images':{},'completed':True,'keylessIdentity':'https://github.com/'+repository+'/.github/workflows/original-stack.yml@refs/heads/main',
           'oidcIssuer':'https://token.actions.githubusercontent.com','highCriticalFindings':0,'serverDeployed':False}
    for name in delivery.IMAGES:
        sbom={'bomFormat':'CycloneDX','components':[]};scan={'SchemaVersion':2,'Results':[{}]}
        values[name+'.cdx.json']=raw(sbom);values[name+'.trivy.json']=raw(scan)
        for suffix,predicate_type,predicate in [('signature.bundle.json','https://sigstore.dev/cosign/sign/v1',{}),('sbom.bundle.json','https://cyclonedx.org/bom',sbom)]:
            subject={'digest':{'sha256':'1'*64}}
            if suffix.startswith('signature'):subject['annotations']={'org.opencontainers.image.revision':revision}
            statement={'_type':'https://in-toto.io/Statement/v1','subject':[subject],'predicateType':predicate_type,'predicate':predicate}
            # Intentionally unsigned: structural metadata alone is insufficient for the CLI.
            values[name+'.'+suffix]=raw({'dsseEnvelope':{'payloadType':'application/vnd.in-toto+json','payload':base64.b64encode(raw(statement)).decode()}})
        proof['images'][name]={'reference':images[name],'components':0,'sbomSha256':delivery.digest(values[name+'.cdx.json']),
                              'vulnerabilityReportSha256':delivery.digest(values[name+'.trivy.json']),
                              'keylessSignatureVerified':True,'sbomAttestationVerified':True}
    values.update({'manifest.json':raw(manifest),'runtime-identity.json':raw(runtime),'security-proof.json':raw(proof)})
    for name,value in values.items():
        with (folder/name).open('xb') as output:output.write(value)
    return folder,checksum(folder)

def checksum(folder):
    values={name:hashlib.sha256((folder/name).read_bytes()).hexdigest() for name in delivery.FILES-{'checksums.json'}}
    (folder/'checksums.json').write_bytes(raw(values))
    return delivery.digest((folder/'checksums.json').read_bytes())

class Boundaries(unittest.TestCase):
    def test_duplicate_nested_json_and_noncanonical_dsse_cannot_be_parsed(self):
        with self.assertRaises(ValueError):delivery.json_bytes(b'{"digest":{"sha256":"a","sha256":"b"}}')
        with self.assertRaises(Exception):delivery.statement({'dsseEnvelope':{'payloadType':'application/vnd.in-toto+json','payload':'invalid base64'}})

    def test_untrusted_checksum_map_cannot_repin_changed_bytes(self):
        folder,pinned=fixture('changed-byte-chain')
        self.assertEqual(10,len(delivery.validate(folder,revision,pinned,repository)[2]))
        (folder/'core-api.cdx.json').write_bytes(raw({'bomFormat':'CycloneDX','components':[{'name':'substituted'}]}))
        checksum(folder)
        with self.assertRaises(ValueError):delivery.validate(folder,revision,pinned,repository)

    def test_foreign_repository_and_revision_are_refused(self):
        folder,pinned=fixture('foreign-scope')
        for expected,repo in [('2'*40,repository),(revision,'someone/AgentTrust')]:
            with self.assertRaises(ValueError):delivery.validate(folder,expected,pinned,repo)

    def test_unexpected_file_is_never_mounted_to_verifier(self):
        folder,pinned=fixture('unexpected-file')
        with (folder/'unrelated.txt').open('x',encoding='utf-8') as output:output.write('Unrelated fixture, no credentials')
        with self.assertRaises(ValueError):delivery.validate(folder,revision,pinned,repository)

    def test_production_claims_and_high_findings_are_refused_even_with_recomputed_map(self):
        for label,filename,change in [('production','manifest.json',{'productionSecurityVerified':True}),('high','security-proof.json',{'highCriticalFindings':1})]:
            folder,_=fixture(label);value=json.loads((folder/filename).read_bytes());value.update(change);(folder/filename).write_bytes(raw(value));pinned=checksum(folder)
            with self.assertRaises(ValueError):delivery.validate(folder,revision,pinned,repository)

    def test_optimized_python_does_not_disable_input_verification(self):
        folder,_=fixture('optimized-python')
        result=subprocess.run([sys.executable,'-O',str(root/'scripts/stack-delivery-verify.py'),'--bundle',str(folder),
                '--expected-revision',revision,'--expected-checksums-sha256','0'*64,'--repository',repository,'--docker-tools'],
                capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=10)
        self.assertEqual(1,result.returncode);output=json.loads(result.stdout);self.assertFalse(output['completed']);self.assertEqual('artifact-metadata',output['failedStage'])

if __name__=='__main__':unittest.main()
