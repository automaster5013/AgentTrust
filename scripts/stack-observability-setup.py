"""Create only the isolated observability administrator secret, never print it."""
import pathlib,secrets,json,re
root=pathlib.Path(__file__).resolve().parent.parent
directory=root/'.local/stack';assert directory.is_dir()
path=directory/'grafana-password'
if not path.exists():
 with path.open('x',encoding='utf-8') as stream:stream.write(secrets.token_hex(32))
 path.chmod(0o600)
assert re.fullmatch('[a-f0-9]{64}',path.read_text(encoding='utf-8'))
print(json.dumps({'completed':True,'secretPrinted':False,'legacyConfigurationChanged':False}))
