"""Independent source fingerprints for bounded reference-answer execution."""
import hashlib,json,pathlib

def canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode('utf-8')
def source_hash(path):return hashlib.sha256(path.read_bytes().replace(b'\r\n',b'\n')).hexdigest()
def validator_hash(tool):
 source=(tool/'quality-policy.mjs').read_bytes().replace(b'\r\n',b'\n')
 transport=(tool/'quality-server.mjs').read_bytes().replace(b'\r\n',b'\n')
 lock=(tool/'package-lock.json').read_bytes().replace(b'\r\n',b'\n')
 return hashlib.sha256(b'reference-answer-verifier-v1\n'+source+b'\n'+transport+b'\n'+lock).hexdigest()

def execution_profile(provider,constants,validator_fingerprint,root=None):
 if provider not in ['ollama','openai-compatible']:raise ValueError('Unsupported reference provider')
 if not isinstance(validator_fingerprint,str) or len(validator_fingerprint)!=64 or any(c not in '0123456789abcdef' for c in validator_fingerprint):raise ValueError('Invalid verifier fingerprint')
 root=root or pathlib.Path(__file__).parent
 sources={name:source_hash(root/name) for name in ['quality_provider.py','quality_evaluator.py','quality_worker.py','quality_application.py','quality_profiles.py','providers.py']}
 definition={'schemaVersion':1,'contract':'reference-execution-profile-v1','provider':provider,'sourceSha256':sources,'validatorProfileSha256':validator_fingerprint,'model':constants['MODEL'],'modelSourceManifestDigest':constants['SOURCE_MANIFEST_DIGEST'],'modelRuntimeDigest':constants['MODEL_DIGEST'],'inputReservationTokens':256,'outputReservationTokens':128,'inputUtf8Bytes':192,'referenceUtf8Bytes':128,'outputUtf8Bytes':2048,'maxCases':2,'executionDeadlineSeconds':120,'providerTimeoutSeconds':60,'verifierTimeoutSeconds':17,'maxAttempts':1,'arbitraryCodeAllowed':False,'callerSelectedUrlAllowed':False,'answerComparison':'Unicode-NFC-trim-exact','rawModelOutputRetained':False}
 return {'definition':definition,'contentSha256':hashlib.sha256(canonical(definition)).hexdigest()}
