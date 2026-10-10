"""Use the prepared identity overlay for isolated-stack operations only."""
import os,re
def stack_compose(root):
 command=['docker','compose','--env-file','.local/stack/stack.env']
 if (root/'.local/stack/identity.env').exists():command+=['--env-file','.local/stack/identity.env','-f','compose.stack.yaml','-f','compose.stack.identity.yaml']
 else:command+=['-f','compose.stack.yaml']
 if (root/'.local/stack/redis-token').exists():command+=['-f','compose.stack.gateway.yaml']
 names=['STACK_CORE_IMAGE','STACK_WORKER_IMAGE','STACK_CONSOLE_IMAGE','STACK_OPA_IMAGE','STACK_IDENTITY_IMAGE','STACK_GATEWAY_IMAGE']
 if any(name in os.environ for name in names):
  assert all(re.fullmatch(r'ghcr\.io/[a-z0-9-]+/agenttrust-[a-z-]+@sha256:[a-f0-9]{64}',os.environ.get(name,'')) for name in names)
  command+=['-f','compose.stack.image.yaml']
 return command
