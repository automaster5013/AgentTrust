"""Separate one-image Console delivery contract; never authorizes DB/Core deployment."""
import base64,hashlib,json,re
REPOSITORY='automaster5013/AgentTrust'
REF='refs/heads/codex/commercial-workspace-ux-20261026'
WORKFLOW='.github/workflows/original-stack.yml'
IDENTITY='https://github.com/'+REPOSITORY+'/'+WORKFLOW+'@'+REF
FILES={'manifest.json','console.cdx.json','console.trivy.json','console.signature.bundle.json','console.sbom.bundle.json'}
def require(value):
 if not value:raise ValueError('Console release contract refused')
def unique(pairs):
 value={}
 for k,v in pairs:
  require(k not in value);value[k]=v
 return value
def parse(raw):return json.loads(raw.decode('utf-8'),object_pairs_hook=unique)
def context(env,root,uid,publication=True):
 require(uid>0 and env.get('GITHUB_ACTIONS')=='true' and env.get('RUNNER_ENVIRONMENT')=='github-hosted')
 require(env.get('GITHUB_REPOSITORY')==REPOSITORY and env.get('GITHUB_REF')==REF and env.get('GITHUB_EVENT_NAME')=='workflow_dispatch')
 require(type(publication) is bool and env.get('STACK_CONSOLE_RELEASE_APPROVED')=='true' and str(root)==env.get('GITHUB_WORKSPACE'))
 if publication:require(env.get('STACK_SOURCE_INTEGRATION_PASSED')=='true')
 require(re.fullmatch('[a-f0-9]{40}',env.get('GITHUB_SHA','')) is not None)
 for k in ['GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT']:require(re.fullmatch('[1-9][0-9]*',env.get(k,'')) is not None)
 return env['GITHUB_SHA']
def validate(directory,revision,checksums_hash):
 require(re.fullmatch('[a-f0-9]{40}',revision) is not None and re.fullmatch('[a-f0-9]{64}',checksums_hash) is not None)
 require(directory.is_dir() and not directory.is_symlink() and {p.name for p in directory.iterdir()}==FILES|{'checksums.json'})
 raw={};total=0
 for name in FILES|{'checksums.json'}:
  p=directory/name;require(p.is_file() and not p.is_symlink() and p.resolve().parent==directory.resolve())
  size=p.stat().st_size;require(0<size<=8388608);total+=size;require(total<=33554432);raw[name]=p.read_bytes();require(len(raw[name])==size)
 require(hashlib.sha256(raw['checksums.json']).hexdigest()==checksums_hash)
 checks=parse(raw['checksums.json']);require(set(checks)==FILES and all(hashlib.sha256(raw[n]).hexdigest()==checks[n] for n in FILES))
 m=parse(raw['manifest.json']);require(set(m)=={'schemaVersion','kind','revision','repository','ref','workflow','runId','runAttempt','image','imageId','keylessIdentity','oidcIssuer','highCriticalFindings','runtimeHttpVerified','sourceIntegrationPassed','oidcProfile','scope','databaseChanged','actualDeploymentPerformed'})
 require(type(m['schemaVersion']) is int and m['schemaVersion']==1 and m['kind']=='single-console-delivery' and m['revision']==revision and m['repository']==REPOSITORY and m['ref']==REF and m['workflow']==WORKFLOW)
 require(type(m['runId']) is int and m['runId']>0 and type(m['runAttempt']) is int and m['runAttempt']>0)
 require(re.fullmatch(r'ghcr.io/automaster5013/agenttrust-console@sha256:[a-f0-9]{64}',m['image']) is not None and re.fullmatch('sha256:[a-f0-9]{64}',m['imageId']) is not None)
 require(m['keylessIdentity']==IDENTITY and m['oidcIssuer']=='https://token.actions.githubusercontent.com')
 require(type(m['highCriticalFindings']) is int and m['highCriticalFindings']==0 and m['runtimeHttpVerified'] is True and m['sourceIntegrationPassed'] is True)
 require(m['oidcProfile']=={'profile':'local-review','applicationOrigin':'http://127.0.0.1:4320','publicIssuer':'http://127.0.0.1:4322/realms/agenttrust'})
 require(m['scope']==['stack-console'] and m['databaseChanged'] is False and m['actualDeploymentPerformed'] is False)
 scan=parse(raw['console.trivy.json']);require(scan.get('SchemaVersion')==2 and isinstance(scan.get('Results'),list) and 1<=len(scan['Results'])<=32 and all(not r.get('Vulnerabilities') for r in scan['Results']))
 sbom=parse(raw['console.cdx.json']);require(sbom.get('bomFormat')=='CycloneDX' and len(sbom.get('components',[]))>0)
 digest=m['image'].split('@sha256:')[1]
 for suffix,kind in [('signature','https://sigstore.dev/cosign/sign/v1'),('sbom','https://cyclonedx.org/bom')]:
  frame=parse(raw['console.'+suffix+'.bundle.json']);envelope=frame['dsseEnvelope'];require(envelope['payloadType']=='application/vnd.in-toto+json')
  encoded=envelope['payload'];require(isinstance(encoded,str) and len(encoded)<=8388608);decoded=base64.b64decode(encoded,validate=True);require(base64.b64encode(decoded).decode()==encoded)
  signed=parse(decoded);require(signed['_type'] in ['https://in-toto.io/Statement/v1','https://in-toto.io/Statement/v0.1'] and signed['predicateType']==kind)
  require(len(signed['subject'])==1 and signed['subject'][0]['digest']=={'sha256':digest})
  if suffix=='signature':require(signed['predicate']=={} and signed['subject'][0]['annotations']['org.opencontainers.image.revision']==revision)
  else:require(signed['predicate']==sbom)
 return m
