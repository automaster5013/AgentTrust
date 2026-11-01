import base64,copy,hashlib,json,pathlib,tempfile,unittest
from stack_console_release_contract import context,validate,require,REPOSITORY,REF,WORKFLOW,IDENTITY
ROOT=pathlib.Path(__file__).resolve().parent.parent
SHA='a'*40
class ConsoleReleaseTest(unittest.TestCase):
 def env(self):return {'GITHUB_ACTIONS':'true','RUNNER_ENVIRONMENT':'github-hosted','GITHUB_REPOSITORY':REPOSITORY,'GITHUB_REF':REF,'GITHUB_EVENT_NAME':'workflow_dispatch','STACK_CONSOLE_RELEASE_APPROVED':'true','STACK_SOURCE_INTEGRATION_PASSED':'true','GITHUB_WORKSPACE':str(ROOT),'GITHUB_SHA':SHA,'GITHUB_RUN_ID':'1','GITHUB_RUN_ATTEMPT':'1'}
 def test_manual_context_refuses_local_fork_automatic_event_or_unverified_source(self):
  self.assertEqual(context(self.env(),ROOT,1001),SHA)
  for k,v in [('GITHUB_ACTIONS','false'),('RUNNER_ENVIRONMENT','self-hosted'),('GITHUB_REPOSITORY','other/repo'),('GITHUB_REF','refs/heads/main'),('GITHUB_EVENT_NAME','pull_request'),('STACK_CONSOLE_RELEASE_APPROVED','false'),('STACK_SOURCE_INTEGRATION_PASSED','false'),('GITHUB_WORKSPACE','/other'),('GITHUB_SHA','short'),('GITHUB_RUN_ID','0'),('GITHUB_RUN_ATTEMPT','01')]:
   env=self.env();env[k]=v
   with self.subTest(k=k),self.assertRaises(ValueError):context(env,ROOT,1001)
  with self.assertRaises(ValueError):context(self.env(),ROOT,0)
 def manifest(self):return {'schemaVersion':1,'kind':'single-console-delivery','revision':SHA,'repository':REPOSITORY,'ref':REF,'workflow':WORKFLOW,'runId':1,'runAttempt':1,'image':'ghcr.io/automaster5013/agenttrust-console@sha256:'+'b'*64,'imageId':'sha256:'+'c'*64,'keylessIdentity':IDENTITY,'oidcIssuer':'https://token.actions.githubusercontent.com','highCriticalFindings':0,'runtimeHttpVerified':True,'sourceIntegrationPassed':True,'oidcProfile':{'profile':'local-review','applicationOrigin':'http://127.0.0.1:4320','publicIssuer':'http://127.0.0.1:4322/realms/agenttrust'},'scope':['stack-console'],'databaseChanged':False,'actualDeploymentPerformed':False}
 def files(self):
  sbom={'bomFormat':'CycloneDX','components':[{'name':'synthetic-fixture'}]}
  def frame(kind,predicate):
   subject={'name':'synthetic-console','digest':{'sha256':'b'*64},'annotations':{'org.opencontainers.image.revision':SHA}}
   payload={'_type':'https://in-toto.io/Statement/v1','subject':[subject],'predicateType':kind,'predicate':predicate}
   return {'dsseEnvelope':{'payloadType':'application/vnd.in-toto+json','payload':base64.b64encode(json.dumps(payload).encode()).decode(),'signatures':[]}}
  return {'manifest.json':self.manifest(),'console.cdx.json':sbom,'console.trivy.json':{'SchemaVersion':2,'Results':[{'Vulnerabilities':[]}]},'console.signature.bundle.json':frame('https://sigstore.dev/cosign/sign/v1',{}),'console.sbom.bundle.json':frame('https://cyclonedx.org/bom',sbom)}
 def write(self,d,files):
  for n,v in files.items():(d/n).write_text(json.dumps(v),encoding='utf-8')
  raw=json.dumps({n:hashlib.sha256((d/n).read_bytes()).hexdigest() for n in files}).encode();(d/'checksums.json').write_bytes(raw);return hashlib.sha256(raw).hexdigest()
 def with_bundle(self,callback):
  with tempfile.TemporaryDirectory(prefix='console-contract-unit-',dir=ROOT/'.local') as t:callback(pathlib.Path(t))
 def test_metadata_contract_does_not_claim_mock_signatures_are_cryptographically_verified(self):
  def check(d):
   files=self.files();pin=self.write(d,files);m=validate(d,SHA,pin);self.assertEqual(m['scope'],['stack-console']);self.assertFalse(m['actualDeploymentPerformed']);self.assertNotIn('imageSignaturesCryptographicallyVerified',m)
  self.with_bundle(check)
 def test_manifest_cannot_expand_to_gateway_core_database_migration_or_main_signer(self):
  def check(d):
   for k,v in [('scope',['stack-console','stack-gateway']),('databaseChanged',True),('actualDeploymentPerformed',True),('sourceIntegrationPassed',False),('runtimeHttpVerified',False),('highCriticalFindings',True),('image','ghcr.io/automaster5013/agenttrust-core-api@sha256:'+'b'*64),('revision','d'*40),('ref','refs/heads/main'),('keylessIdentity',IDENTITY.replace(REF,'refs/heads/main')),('oidcProfile',{'profile':'https-review'})]:
    files=self.files();files['manifest.json'][k]=v;pin=self.write(d,files)
    with self.subTest(k=k),self.assertRaises((ValueError,KeyError)):validate(d,SHA,pin)
  self.with_bundle(check)
 def test_recomputed_checksums_cannot_replace_signed_subject_revision_or_sbom(self):
  def check(d):
   for name,mutation in [('console.signature.bundle.json','digest'),('console.signature.bundle.json','revision'),('console.sbom.bundle.json','predicate')]:
    files=self.files();envelope=files[name]['dsseEnvelope'];payload=json.loads(base64.b64decode(envelope['payload']))
    if mutation=='digest':payload['subject'][0]['digest']['sha256']='d'*64
    elif mutation=='revision':payload['subject'][0]['annotations']['org.opencontainers.image.revision']='d'*40
    else:payload['predicate']['components'][0]['name']='substituted'
    envelope['payload']=base64.b64encode(json.dumps(payload).encode()).decode();pin=self.write(d,files)
    with self.subTest(mutation=mutation),self.assertRaises(ValueError):validate(d,SHA,pin)
  self.with_bundle(check)
 def test_files_pin_unknown_files_symlinks_and_duplicate_json_are_refused(self):
  def check(d):
   pin=self.write(d,self.files())
   with self.assertRaises(ValueError):validate(d,SHA,'f'*64)
   extra=d/'unexpected';extra.write_text('x')
   with self.assertRaises(ValueError):validate(d,SHA,pin)
   extra.unlink();(d/'manifest.json').write_text('{"schemaVersion":1,"schemaVersion":1}')
   raw=json.loads((d/'checksums.json').read_bytes());raw['manifest.json']=hashlib.sha256((d/'manifest.json').read_bytes()).hexdigest();encoded=json.dumps(raw).encode();(d/'checksums.json').write_bytes(encoded)
   with self.assertRaises(ValueError):validate(d,SHA,hashlib.sha256(encoded).hexdigest())
  self.with_bundle(check)
 def test_empty_or_vulnerable_scan_is_not_accepted(self):
  def check(d):
   for results in [[],[{'Vulnerabilities':[{'Severity':'HIGH'}]}],None]:
    files=self.files();files['console.trivy.json']['Results']=results;pin=self.write(d,files)
    with self.assertRaises(ValueError):validate(d,SHA,pin)
  self.with_bundle(check)
if __name__=='__main__':unittest.main()
