"""Use the prepared identity overlay for isolated-stack operations only."""
def stack_compose(root):
 command=['docker','compose','--env-file','.local/stack/stack.env']
 if (root/'.local/stack/identity.env').exists():command+=['--env-file','.local/stack/identity.env','-f','compose.stack.yaml','-f','compose.stack.identity.yaml']
 else:command+=['-f','compose.stack.yaml']
 return command
