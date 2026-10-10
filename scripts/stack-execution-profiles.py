"""Derive Java's public fixed-profile snapshots from installed Python evaluator source."""
import argparse,ast,hashlib,json,pathlib
root=pathlib.Path(__file__).resolve().parent.parent;parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true');args=parser.parse_args()
source=root/'services/ai-worker/providers.py';constants={}
for item in ast.parse(source.read_text(encoding='utf-8')).body:
 if isinstance(item,ast.Assign) and len(item.targets)==1 and isinstance(item.targets[0],ast.Name):
  if item.targets[0].id in ['MODEL','MODEL_DIGEST','SOURCE_MANIFEST_DIGEST','PROMPTS','MAX_OUTPUT_TOKENS','LOCAL_PROVIDER_TIMEOUT']:constants[item.targets[0].id]=ast.literal_eval(item.value)
def canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode('utf-8')
values={}
for provider in ['synthetic','ollama','openai-compatible']:
 definition={'schemaVersion':1,'contract':'fixed-execution-profile-v1','provider':provider,'implementationSha256':hashlib.sha256((root/'services/ai-worker'/('app.py' if provider=='synthetic' else 'providers.py')).read_bytes().replace(b'\r\n',b'\n')).hexdigest(),'profileVerifierSha256':hashlib.sha256((root/'services/ai-worker/execution_profiles.py').read_bytes().replace(b'\r\n',b'\n')).hexdigest(),'executionDeadlineSeconds':120,'maxAttempts':1,'arbitraryCodeAllowed':False,'callerSelectedUrlAllowed':False}
 if provider!='synthetic':definition.update(model=constants['MODEL'],modelSourceManifestDigest=constants['SOURCE_MANIFEST_DIGEST'],modelRuntimeDigest=constants['MODEL_DIGEST'],promptSetSha256=hashlib.sha256(canonical(constants['PROMPTS'])).hexdigest(),inputReservationTokens=256,outputReservationTokens=constants['MAX_OUTPUT_TOKENS'],providerTimeoutSeconds=constants['LOCAL_PROVIDER_TIMEOUT'])
 values[provider]={'definition':definition,'contentSha256':hashlib.sha256(canonical(definition)).hexdigest()}
target=root/'services/core-api/src/main/resources/execution-profiles.json';content=canonical(values)+b'\n'
if args.check:
 if not target.is_file() or target.read_bytes()!=content:print(json.dumps({'completed':False,'code':'EXECUTION_PROFILE_SOURCE_DRIFT'}));raise SystemExit(1)
else:target.write_bytes(content)
print(json.dumps({'completed':True,'profiles':3,'privateConfigurationRead':False,'sourceBindingsVerified':args.check}))
