"""Private Redis ACL for the isolated reactive gateway; no old assets touched."""
import hashlib,json,os,pathlib,re,secrets,subprocess
root=pathlib.Path(__file__).resolve().parent.parent;directory=root/'.local/stack'
try:
 assert directory.is_dir();token=directory/'redis-token'
 if not token.exists():token.open('x',encoding='utf-8').write(secrets.token_hex(32))
 password=token.read_text(encoding='utf-8');assert re.fullmatch('[a-f0-9]{64}',password)
 gateway_acl='user stack-gateway on #'+hashlib.sha256(password.encode()).hexdigest()+' ~stack:quota:* +ping +get +incr +expire +ttl +eval +evalsha +script|load +select +hello +client|setinfo +client|setname\n'
 # The disabled default user still supplies ACLs to Redis 8.2 AOF transaction replay.
 # It cannot authenticate; narrowly allow only the already-persisted quota operations.
 default_acl='user default off ~stack:quota:* +incr +expireat +pexpireat +del +multi +exec +select\n'
 files={token:password,directory/'redis.acl':default_acl+gateway_acl,directory/'redis.conf':'bind 0.0.0.0\nprotected-mode yes\nport 6379\naclfile /run/secrets/stack-redis-acl\ndir /data\nappendonly yes\nappendfsync everysec\nsave ""\nmaxmemory 32mb\nmaxmemory-policy noeviction\nloglevel warning\n'}
 for path,expected in files.items():
  if not path.exists():path.open('x',encoding='utf-8').write(expected)
  if path.name=='redis.acl' and path.read_text(encoding='utf-8') in ['user default off\n'+gateway_acl,'user default off ~stack:quota:* +incr +expireat +pexpireat +multi +exec\n'+gateway_acl]:
   if os.name!='nt':path.chmod(0o600)
   path.write_text(expected,encoding='utf-8')
  assert path.read_text(encoding='utf-8')==expected
  if os.name=='nt':
   who=subprocess.run(['whoami'],capture_output=True,text=True,check=True).stdout.strip();subprocess.run(['icacls',str(path),'/inheritance:r','/grant:r',who+':F','SYSTEM:F'],capture_output=True,text=True,check=True)
  else:path.chmod(0o444)
 print(json.dumps({'prepared':True,'redisDefaultUserDisabled':True,'gatewayKeyPrefixRestricted':True,'rawSecretsPrinted':False}))
except Exception:
 print(json.dumps({'prepared':False,'code':'STACK_GATEWAY_SETUP_UNVERIFIED'}));raise SystemExit(1)
