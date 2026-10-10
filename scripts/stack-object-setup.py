"""Generate isolated MinIO secrets without changing any previous configuration."""
import json,os,pathlib,secrets,subprocess,re
root=pathlib.Path(__file__).resolve().parent.parent;directory=root/'.local/stack'
try:
 assert directory.is_dir()
 for name,value in [('minio-root-user','stack-root'),('minio-root-password',None),('minio-user','stack-evidence'),('minio-password',None)]:
  path=directory/name
  if not path.exists():path.open('x',encoding='utf-8').write(value or secrets.token_hex(32))
  stored=path.read_text(encoding='utf-8');assert stored==value if value else re.fullmatch('[a-f0-9]{64}',stored)
  if os.name=='nt':
   who=subprocess.run(['whoami'],capture_output=True,text=True,check=True).stdout.strip();subprocess.run(['icacls',str(path),'/inheritance:r','/grant:r',who+':F','SYSTEM:F'],capture_output=True,text=True,check=True)
  else:path.chmod(0o444)
 print(json.dumps({'prepared':True,'rootAndApplicationSecretsSeparated':True,'rawSecretsPrinted':False}))
except Exception:
 print(json.dumps({'prepared':False,'code':'STACK_OBJECT_SETUP_UNVERIFIED'}));raise SystemExit(1)
