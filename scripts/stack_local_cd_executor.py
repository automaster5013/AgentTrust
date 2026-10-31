"""Exact-scope Compose application and bounded failure handling; no implicit authorization."""
import datetime,json,pathlib,re
STATEFUL={'stack-db','stack-identity','stack-nats','stack-object-store','stack-ollama','stack-tempo','stack-loki','stack-prometheus'}
ORDER=['stack-db','stack-nats','stack-object-store','stack-ollama','stack-opa','stack-quality-verifier','stack-otel','stack-tempo','stack-loki','stack-prometheus','stack-identity','stack-core-api','stack-ai-worker','stack-gateway','stack-console']

def require(value):
 if not value:raise ValueError('Deployment safety precondition refused')

def validate_approval(approval,plan_hash,services,now):
 require(approval['planSha256']==plan_hash and approval['allowServiceRecreation'] is True)
 require(approval['allowSameSchemaImageRollback'] is True and approval['localDevelopmentRecoveryScopeAccepted'] is True)
 require(approval['services']==services and set(services)<=set(ORDER) and len(services)==len(set(services))>0)
 issued=datetime.datetime.fromisoformat(approval['issuedAt'].replace('Z','+00:00'))
 expires=datetime.datetime.fromisoformat(approval['expiresAt'].replace('Z','+00:00'))
 require(issued.tzinfo is not None and expires.tzinfo is not None)
 require(0<=(now-issued).total_seconds()<=600 and now<expires and 0<(expires-issued).total_seconds()<=1800)
 if set(services)&STATEFUL:require(approval['statefulTransitionReviewed'] is True)
 if 'stack-core-api' in services:require(approval['allowSessionReauthentication'] is True)

def owned_path(root,value):
 path=pathlib.Path(value).resolve();require(path.is_relative_to(root) and path.is_file());return str(path)

def compose_apply_command(root,files,env_files,override,service):
 require(service in ORDER and files and env_files)
 command=['docker','compose','--project-name','agenttrust']
 for file in env_files:command+=['--env-file',owned_path(root,file)]
 for file in files:command+=['-f',owned_path(root,file)]
 command+=['-f',owned_path(root,override),'up','-d','--no-build','--pull','never','--no-deps','--wait','--wait-timeout','120',service]
 return command

def transition(services,apply,verify,checkpoint):
 require(set(services)<=set(ORDER) and len(services)==len(set(services))>0)
 touched=[];events=[]
 for service in [s for s in ORDER if s in services]:
  checkpoint(touched);touched.append(service)
  try:
   apply(service,False);verify(service,False,touched)
   events.append({'service':service,'action':'candidate','passed':True})
  except Exception:
   events.append({'service':service,'action':'candidate','passed':False})
   # Never assume a database/storage image downgrade is data-format safe.
   if set(touched)&STATEFUL:
    return {'completed':False,'manualRecoveryRequired':True,'rolledBack':False,'events':events}
   for previous in reversed(touched):
    try:
     checkpoint(touched);apply(previous,True);verify(previous,True,touched)
     events.append({'service':previous,'action':'rollback','passed':True})
    except Exception:
     events.append({'service':previous,'action':'rollback','passed':False})
     return {'completed':False,'manualRecoveryRequired':True,'rolledBack':False,'events':events}
   return {'completed':False,'manualRecoveryRequired':False,'rolledBack':True,'events':events}
 return {'completed':True,'manualRecoveryRequired':False,'rolledBack':False,'events':events}

def environment_matches(model,container):
 # Compare explicit resolved Compose environment only in memory; never log values.
 actual={}
 for item in container['Config'].get('Env',[]):
  key,value=item.split('=',1);require(key not in actual);actual[key]=value
 for key,value in model.get('environment',{}).items():
  require(value is not None and not isinstance(value,(dict,list)))
  require(key in actual and actual[key]==str(value))
 return True

def normalized_host_path(value):
 value=str(value)
 match=re.match(r'^/run/desktop/mnt/host/([a-z])/(.*)$',value)
 if match:value=match[1].upper()+':/'+match[2]
 return str(pathlib.Path(value).resolve())

def live_layout_matches(model,resources,container):
 environment_matches(model,container)
 host=container['HostConfig']
 require(not model.get('privileged',False) and not host.get('Privileged',False))
 require(not model.get('network_mode') and not model.get('devices') and not model.get('volumes_from'))
 require({resources['networks'][key]['name'] for key in model.get('networks',{})}==set(container['NetworkSettings']['Networks']))
 require(bool(model.get('read_only',False))==host['ReadonlyRootfs'])
 for field,actual in [('mem_limit','Memory'),('pids_limit','PidsLimit')]:
  if field in model:require(int(model[field])==host[actual])
 if 'cpus' in model:require(round(float(model['cpus'])*1000000000)==host['NanoCpus'])
 if 'user' in model:require(str(model['user'])==container['Config']['User'])
 require(sorted(model.get('cap_drop',[]))==sorted(host.get('CapDrop') or []))
 require(sorted(model.get('cap_add',[]))==sorted(host.get('CapAdd') or []))
 def security(values):return sorted(v.removesuffix(':true') for v in values)
 require(security(model.get('security_opt',[]))==security(host.get('SecurityOpt') or []))
 expected={};protected=[]
 for volume in model.get('volumes',[]):
  require(isinstance(volume,dict) and volume['target'] not in expected)
  kind=volume['type'];require(kind in ('bind','volume'))
  source=normalized_host_path(volume['source']) if kind=='bind' else resources['volumes'][volume['source']]['name']
  expected[volume['target']]=(kind,source,not volume.get('read_only',False))
  if kind=='bind':protected.append(source)
 for kind,default_prefix in [('secrets','/run/secrets/'),('configs','/')]:
  for mount in model.get(kind,[]):
   source=resources[kind][mount['source']];require('file' in source and not source.get('external'))
   target=mount.get('target',mount['source']);target=target if target.startswith('/') else default_prefix+target
   require(target not in expected)
   expected[target]=('bind',normalized_host_path(source['file']),False);protected.append(source['file'])
 actual={}
 for mount in container.get('Mounts',[]):
  require(mount['Destination'] not in actual)
  kind=mount['Type'];require(kind in ('bind','volume'))
  actual[mount['Destination']]=(kind,normalized_host_path(mount['Source']) if kind=='bind' else mount['Name'],mount['RW'])
 require(actual==expected)
 ports={}
 for port in model.get('ports',[]):
  require('published' in port and str(port['published']).isdigit())
  key=str(port['target'])+'/'+port.get('protocol','tcp')
  ports.setdefault(key,[]).append((port.get('host_ip',''),str(port['published'])))
 actual_ports={key:sorted((entry['HostIp'],entry['HostPort']) for entry in entries) for key,entries in (host.get('PortBindings') or {}).items()}
 require({k:sorted(v) for k,v in ports.items()}==actual_ports)
 return protected
