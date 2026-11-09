"""Create only the isolated observability administrator secret, never print it."""
import pathlib,secrets,json,re
root=pathlib.Path(__file__).resolve().parent.parent
directory=root/'.local/stack'
if not directory.is_dir():
    raise SystemExit('Observability setup directory is missing')
path=directory/'grafana-password'
if not path.exists():
 with path.open('x',encoding='utf-8') as stream:stream.write(secrets.token_hex(32))
 path.chmod(0o600)
if not re.fullmatch('[a-f0-9]{64}',path.read_text(encoding='utf-8')):
    raise SystemExit('Observability setup file has an invalid format')
print(json.dumps({'completed':True,'secretPrinted':False,'legacyConfigurationChanged':False}))
