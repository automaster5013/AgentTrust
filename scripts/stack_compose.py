"""Use the prepared identity overlay for isolated-stack operations only."""
import os,re
def stack_compose(root):
 command=['docker','compose','--env-file','.local/stack/stack.env']
 if (root/'.local/stack/identity.env').exists():command+=['--env-file','.local/stack/identity.env','-f','compose.stack.yaml','-f','compose.stack.identity.yaml']
 else:command+=['-f','compose.stack.yaml']
 if (root/'.local/stack/redis-token').exists():command+=['-f','compose.stack.gateway.yaml']
 if (root/'.local/stack/minio-password').exists():command+=['-f','compose.stack.object.yaml']
 if (root/'.local/stack/grafana-password').exists():command+=['-f','compose.stack.observability.yaml']
 if (root/'.local/stack/providers-enabled').exists():command+=['-f','compose.stack.providers.yaml']
 if (root/'.local/stack/signing-enabled').exists():
  assert (root/'.local/stack/signing-enabled').read_text(encoding='utf-8')=='local-development-v1' and (root/'.local/stack/gate-keys/key-pair.json').is_file()
  command+=['-f','compose.stack.signing.yaml']
 names=['STACK_CORE_IMAGE','STACK_WORKER_IMAGE','STACK_CONSOLE_IMAGE','STACK_OPA_IMAGE','STACK_IDENTITY_IMAGE','STACK_GATEWAY_IMAGE','STACK_OBJECT_IMAGE','STACK_DATABASE_IMAGE','STACK_MODEL_IMAGE','STACK_MESSAGING_IMAGE']
 if any(name in os.environ for name in names):
  assert all(re.fullmatch(r'ghcr\.io/[a-z0-9-]+/agenttrust-[a-z-]+@sha256:[a-f0-9]{64}',os.environ.get(name,'')) for name in names)
  command+=['-f','compose.stack.image.yaml']
 return command
