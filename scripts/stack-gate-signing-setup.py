"""Prepare one stable development Ed25519 key; never print or overwrite private bytes."""
import argparse,base64,hashlib,json,os,pathlib,re,subprocess
root=pathlib.Path(__file__).resolve().parent.parent;parser=argparse.ArgumentParser();parser.add_argument('--image',default='agenttrust-gate-key-tool:local');args=parser.parse_args()
try:
 assert args.image=='agenttrust-gate-key-tool:local' or re.fullmatch(r'ghcr\.io/[a-z0-9-]+/agenttrust-core-api@sha256:[a-f0-9]{64}',args.image)
 directory=(root/'.local/stack/gate-keys').resolve();assert directory.is_relative_to(root.resolve()) and directory.parent.is_dir();directory.mkdir(mode=0o700,exist_ok=True);path=directory/'key-pair.json';assert not path.is_symlink()
 def protect(target,secret=False):
  if os.name=='nt':
   who=subprocess.run(['whoami'],capture_output=True,text=True,check=True).stdout.strip();subprocess.run(['icacls',str(target),'/inheritance:r','/grant:r',who+':F','SYSTEM:F'],capture_output=True,text=True,check=True)
  elif target.is_dir():target.chmod(0o700)
  else:target.chmod(0o444)
 protect(directory);mode='validate' if path.exists() else 'generate';user=str(os.getuid())+':'+str(os.getgid()) if os.name!='nt' else '10001:10001';classpath='/tool' if args.image=='agenttrust-gate-key-tool:local' else '/app/tools'
 command=['docker','run','--rm','--pull','never','--log-driver','none','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--user',user,'--memory','256m','--cpus','1','--pids-limit','64','--mount','type=bind,source='+str(directory)+',target=/output'+(',readonly' if mode=='validate' else ''),'--entrypoint','java',args.image,'-Xmx64m','-cp',classpath,'GateKeyTool',mode,'/output/key-pair.json']
 result=subprocess.run(command,cwd=root,capture_output=True,text=True,timeout=30);assert result.returncode==0 and len(result.stdout)<=1024;status=json.loads(result.stdout);assert status['prepared'] and status['privateKeyPrinted'] is False and path.stat().st_size<=4096
 protect(path,True);pair=json.loads(path.read_text(encoding='utf-8'));public=base64.b64decode(pair['publicKey'],validate=True);assert len(public)==44 and hashlib.sha256(public).hexdigest()==status['keyId'];public_path=directory/'public-key.pem';pem='-----BEGIN PUBLIC KEY-----\n'+pair['publicKey']+'\n-----END PUBLIC KEY-----\n'
 if not public_path.exists():public_path.open('x',encoding='utf-8').write(pem)
 assert public_path.read_text(encoding='utf-8')==pem;protect(public_path);marker=directory.parent/'signing-enabled'
 if not marker.exists():marker.open('x',encoding='utf-8').write('local-development-v1')
 assert marker.read_text(encoding='utf-8')=='local-development-v1';print(json.dumps({'prepared':True,'keyId':status['keyId'],'keyMode':'local-development','existingPrivateKeyOverwritten':False,'privateKeyPrinted':False}))
except Exception:
 print(json.dumps({'prepared':False,'code':'STACK_GATE_SIGNING_SETUP_UNVERIFIED','privateKeyPrinted':False}));raise SystemExit(1)
