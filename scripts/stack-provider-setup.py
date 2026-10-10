"""Enable only the pinned local provider profile; contains no credential or paid API enablement."""
import json,pathlib
root=pathlib.Path(__file__).resolve().parent.parent
path=root/'.local/stack/providers-enabled';assert path.parent.is_dir()
value='ollama-local-v1\n'
if not path.exists():path.open('x',encoding='utf-8').write(value)
assert path.read_text(encoding='utf-8')==value
print(json.dumps({'completed':True,'paidProvidersEnabled':False,'legacyConfigurationChanged':False}))
