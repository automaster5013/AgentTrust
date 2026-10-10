"""Start only isolated, pinned local model services and prepared worker profile."""
import json,pathlib,subprocess
from stack_compose import stack_compose
root=pathlib.Path(__file__).resolve().parent.parent
assert (root/'.local/stack/providers-enabled').read_text(encoding='utf-8')=='ollama-local-v1\n'
result=subprocess.run(stack_compose(root)+['up','-d','--no-build','--wait','stack-ollama','stack-ai-worker'],cwd=root,capture_output=True,timeout=720)
print(json.dumps({'completed':result.returncode==0,'paidApiCalls':False,'rawSecretsPrinted':False}))
if result.returncode:raise SystemExit(1)
