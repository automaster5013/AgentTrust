"""Fingerprint only fixed public execution settings and the exact installed evaluator source."""
import hashlib,json,pathlib
import providers
def canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode('utf-8')
def execution_profile(provider):
 if provider not in ['synthetic','ollama','openai-compatible']:raise ValueError('Unsupported versioned provider')
 definition={'schemaVersion':1,'contract':'fixed-execution-profile-v1','provider':provider,'implementationSha256':hashlib.sha256(pathlib.Path(__file__).with_name('app.py' if provider=='synthetic' else 'providers.py').read_bytes().replace(b'\r\n',b'\n')).hexdigest(),'profileVerifierSha256':hashlib.sha256(pathlib.Path(__file__).read_bytes().replace(b'\r\n',b'\n')).hexdigest(),'executionDeadlineSeconds':120,'maxAttempts':1,'arbitraryCodeAllowed':False,'callerSelectedUrlAllowed':False}
 if provider!='synthetic':definition.update(model=providers.MODEL,modelSourceManifestDigest=providers.SOURCE_MANIFEST_DIGEST,modelRuntimeDigest=providers.MODEL_DIGEST,promptSetSha256=hashlib.sha256(canonical(providers.PROMPTS)).hexdigest(),inputReservationTokens=256,outputReservationTokens=providers.MAX_OUTPUT_TOKENS,providerTimeoutSeconds=providers.LOCAL_PROVIDER_TIMEOUT)
 return {'definition':definition,'contentSha256':hashlib.sha256(canonical(definition)).hexdigest()}
def matches_profile(provider,expected):return expected is None or execution_profile(provider)['contentSha256']==expected
