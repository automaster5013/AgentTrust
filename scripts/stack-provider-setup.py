"""Enable only the pinned local provider profile; contains no credential or paid API enablement."""
import json,pathlib
root=pathlib.Path(__file__).resolve().parent.parent
path=root/'.local/stack/providers-enabled'
if not path.parent.is_dir():
    raise SystemExit('Local provider directory is missing')
value='ollama-local-v1\n'
if not path.exists():path.open('x',encoding='utf-8').write(value)
if path.read_text(encoding='utf-8') != value:
    raise SystemExit('Local provider marker is invalid')
print(json.dumps({'completed':True,'paidProvidersEnabled':False,'legacyConfigurationChanged':False}))
