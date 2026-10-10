"""Prepare ephemeral CI-only registry credentials without printing them."""
import base64,json,os,pathlib,re
assert os.environ.get('GITHUB_ACTIONS')=='true' and os.environ.get('GITHUB_REPOSITORY')=='automaster5013/AgentTrust'
actor=os.environ['GITHUB_ACTOR'];token=os.environ['STACK_REGISTRY_TOKEN'];assert re.fullmatch('[a-zA-Z0-9-]+',actor) and 20<len(token)<512
root=pathlib.Path(__file__).resolve().parent.parent;directory=root/'.local/stack-signing-credentials';directory.mkdir(parents=True)
directory.chmod(0o700);path=directory/'config.json'
path.open('x',encoding='utf-8').write(json.dumps({'auths':{'ghcr.io':{'auth':base64.b64encode((actor+':'+token).encode()).decode()}}}));path.chmod(0o600)
# The signer uses the unprivileged runner uid and sees only this ephemeral credential directory.
assert os.name!='nt' and os.getuid()>0
print(json.dumps({'completed':True,'rawSecretsPrinted':False}))
