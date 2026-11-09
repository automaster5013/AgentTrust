"""Prepare ephemeral CI-only registry credentials without printing them."""
import base64,json,os,pathlib,re
if os.environ.get('GITHUB_ACTIONS') != 'true' or os.environ.get('GITHUB_REPOSITORY') != 'automaster5013/AgentTrust':
    raise SystemExit('Registry credential setup requires the authorized CI repository')
actor = os.environ.get('GITHUB_ACTOR', '')
token = os.environ.get('STACK_REGISTRY_TOKEN', '')
if not re.fullmatch('[a-zA-Z0-9-]+', actor) or not 20 < len(token) < 512:
    raise SystemExit('Registry credential setup received invalid CI credentials')
# The signer uses the unprivileged runner uid and sees only this ephemeral credential directory.
if os.name == 'nt' or os.getuid() <= 0:
    raise SystemExit('Registry credential setup requires an unprivileged Unix runner')
root=pathlib.Path(__file__).resolve().parent.parent;directory=root/'.local/stack-signing-credentials';directory.mkdir(parents=True)
directory.chmod(0o700);path=directory/'config.json'
path.open('x',encoding='utf-8').write(json.dumps({'auths':{'ghcr.io':{'auth':base64.b64encode((actor+':'+token).encode()).decode()}}}));path.chmod(0o600)
print(json.dumps({'completed':True,'rawSecretsPrinted':False}))
