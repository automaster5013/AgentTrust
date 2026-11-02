"""Stateless Console transaction policy. Never removes a container or touches DB schema."""
import copy,hashlib,json,re
NAME='agenttrust-stack-console-1'
def require(value):
 if not value:raise ValueError('Console transaction refused')
def digest(value):return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def endpoint(value):return {k:copy.deepcopy(value[k]) for k in ['IPAMConfig','Links','Aliases','DriverOpts','GwPriority'] if value.get(k) is not None}
def env_map(values):
 result={}
 for value in values:
  require(isinstance(value,str) and '=' in value);k,v=value.split('=',1);require(k not in result);result[k]=v
 return result
def runtime_policy(old,old_image,new_image,manifest,nonce):
 require(re.fullmatch('[a-f0-9]{12}',nonce) is not None)
 require(old['Name']=='/'+NAME and old['Config']['Labels']['com.docker.compose.project']=='agenttrust' and old['Config']['Labels']['com.docker.compose.service']=='stack-console')
 require(old['State']['Running'] and not old['State']['Paused'] and old['State'].get('Health',{}).get('Status')=='healthy')
 require(old['Image']==old_image['Id'] and new_image['Id']==manifest['imageId'] and manifest['image'] in new_image.get('RepoDigests',[]))
 require(manifest['scope']==['stack-console'] and manifest['databaseChanged'] is False)
 require(new_image['Os']=='linux' and new_image['Architecture']=='amd64' and new_image['Config']['Labels']['org.opencontainers.image.revision']==manifest['revision'])
 require(not old['Mounts'] and not old['HostConfig']['Privileged'] and old['HostConfig']['ReadonlyRootfs'])
 require(old['HostConfig']['RestartPolicy']=={'Name':'unless-stopped','MaximumRetryCount':0} and 0<old['HostConfig']['Memory']<=536870912)
 require(not old['HostConfig'].get('AutoRemove') and not old['HostConfig'].get('Devices') and not old['HostConfig'].get('DeviceRequests') and not old['HostConfig'].get('VolumesFrom'))
 ports=old['HostConfig']['PortBindings'];require(set(ports)=={'3000/tcp'} and len(ports['3000/tcp'])==1 and ports['3000/tcp'][0]['HostPort']=='4320')
 for k in ['Entrypoint','Cmd','User','WorkingDir','ExposedPorts','StopSignal','Volumes']:
  require(old_image['Config'].get(k)==new_image['Config'].get(k))
 require(all(old['Config'].get(k)==old_image['Config'].get(k) for k in ['Entrypoint','Cmd','User','WorkingDir','ExposedPorts','StopSignal','Volumes']))
 require(old['HostConfig'].get('CapDrop')==['ALL'] and not old['HostConfig'].get('CapAdd') and 'no-new-privileges:true' in old['HostConfig'].get('SecurityOpt',[]))
 require(old['Config']['Healthcheck']==new_image['Config']['Healthcheck'] and new_image['Config']['User'] in ['node','1000','1000:1000'])
 prior=env_map(old_image['Config']['Env']);next_env=env_map(new_image['Config']['Env']);actual=env_map(old['Config']['Env'])
 changed={k for k in set(prior)|set(actual) if prior.get(k)!=actual.get(k)}
 require(changed<={'CORE_API_URL','HOSTNAME','PORT','NODE_ENV','NEXT_TELEMETRY_DISABLED','NEXT_PUBLIC_STACK_OIDC_PROFILE','NEXT_PUBLIC_STACK_APPLICATION_ORIGIN','NEXT_PUBLIC_STACK_PUBLIC_ISSUER'})
 require(all(k in actual for k in changed))
 for k in changed:next_env[k]=actual[k]
 require(actual.get('CORE_API_URL')==next_env.get('CORE_API_URL') and actual.get('PORT')=='3000' and actual.get('HOSTNAME')=='0.0.0.0')
 labels=new_image['Config']['Labels']
 require(all(labels.get(k)==v for k,v in {'dev.agenttrust.oidc.profile':'local-review','dev.agenttrust.oidc.application-origin':'http://127.0.0.1:4320','dev.agenttrust.oidc.public-issuer':'http://127.0.0.1:4322/realms/agenttrust'}.items()))
 config=copy.deepcopy(old['Config']);config['Image']=manifest['image'];config['Env']=[k+'='+next_env[k] for k in sorted(next_env)];config['Labels'].update(labels);config['Labels']['com.docker.compose.image']=new_image['Id'];config['Labels']['dev.agenttrust.console-rollout-owner']=nonce
 networks=old['NetworkSettings']['Networks'];require(1<=len(networks)<=4 and old['HostConfig']['NetworkMode'] in networks)
 return {'config':config,'host':copy.deepcopy(old['HostConfig']),'endpoints':{n:endpoint(x) for n,x in networks.items()}}
def host_equal(actual,expected):
 a=copy.deepcopy(actual);b=copy.deepcopy(expected)
 require(a.get('OomKillDisable') in [None,False] and b.get('OomKillDisable') in [None,False]);a['OomKillDisable']=b['OomKillDisable']=False;return a==b
def apply_and_recover(engine,old,plan,nonce,checkpoint,accept,record):
 """Injected engine permits full failure-path tests; original is retained on every path."""
 old_id=old['Id'];candidate=None;started=False
 try:
  checkpoint(True);record({'phase':'before-original-stop'});started=True;engine.stop(old_id);record({'phase':'original-stopped'})
  engine.rename(old_id,NAME+'-retained-'+nonce)
  for network in plan['endpoints']:engine.disconnect(network,old_id)
  candidate=engine.create(NAME,plan);record({'phase':'candidate-created','candidateId':candidate});engine.verify_created(candidate,plan)
  engine.start(candidate);engine.healthy(candidate);checkpoint(False);accept(candidate);checkpoint(False)
  record({'phase':'accepted','candidateId':candidate});return {'completed':True,'candidateId':candidate,'originalId':old_id,'originalRetained':True,'databaseChanged':False}
 except Exception:
  if started:
   # Recover a create that succeeded remotely before the response/journal reached us.
   candidate=candidate or engine.find_owned_candidate(NAME,nonce,plan['config']['Image'])
   try:record({'phase':'recovery-started','candidateId':candidate})
   except Exception:pass
   if candidate:
    engine.stop(candidate)
    for network in engine.networks(candidate):engine.disconnect(network,candidate)
    engine.rename(candidate,NAME+'-failed-'+nonce)
   engine.rename(old_id,NAME)
   for network,ep in plan['endpoints'].items():
    if network not in engine.networks(old_id):engine.connect(network,old_id,ep)
   engine.start(old_id);engine.healthy(old_id);engine.verify_original(old_id,old)
   try:record({'phase':'original-restored','originalId':old_id})
   except Exception:pass
   checkpoint(False)
  raise
