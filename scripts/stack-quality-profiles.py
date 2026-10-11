"""Generate public reference profiles using source files, without runtime dependencies."""
import ast,importlib.util,json,pathlib,sys
root=pathlib.Path(__file__).resolve().parent.parent
worker=root/'services/ai-worker'
spec=importlib.util.spec_from_file_location('quality_profiles',worker/'quality_profiles.py');profiles=importlib.util.module_from_spec(spec);spec.loader.exec_module(profiles)
constants={}
for node in ast.parse((worker/'providers.py').read_text(encoding='utf-8')).body:
 if isinstance(node,ast.Assign):
  for target in node.targets:
   if isinstance(target,ast.Name) and target.id in ['MODEL','MODEL_DIGEST','SOURCE_MANIFEST_DIGEST']:constants[target.id]=ast.literal_eval(node.value)
fingerprint=profiles.validator_hash(root/'tools/promptfoo')
snapshots={root/'services/core-api/src/main/resources/quality-execution-profiles.json':{provider:profiles.execution_profile(provider,constants,fingerprint,worker) for provider in ['ollama','openai-compatible']},worker/'quality-validator-profile.json':{'validatorProfileSha256':fingerprint}}
snapshots[root/'apps/console/tests/fixtures/quality-execution-profiles.json']=snapshots[root/'services/core-api/src/main/resources/quality-execution-profiles.json']
snapshots[worker/'quality-execution-profiles.json']=snapshots[root/'services/core-api/src/main/resources/quality-execution-profiles.json']
for path,value in snapshots.items():
 content=json.dumps(value,sort_keys=True,indent=2,ensure_ascii=False)+'\n'
 if '--check' in sys.argv:
  if not path.exists() or path.read_text(encoding='utf-8')!=content:raise SystemExit('Reference execution profile differs')
 else:path.parent.mkdir(parents=True,exist_ok=True);path.write_text(content,encoding='utf-8',newline='\n')
print(json.dumps({'profiles':2,'snapshots':len(snapshots),'checked':'--check' in sys.argv,'rawSecretsPrinted':False}))
