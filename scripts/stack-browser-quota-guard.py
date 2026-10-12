"""Read only the owned Redis quota counters; wait for natural expiry before CI tests."""
import json,pathlib,re,subprocess,time
ROOT=pathlib.Path(__file__).resolve().parent.parent

def wait_seconds(count,ttl,limit,reserve):
 if any(type(v) is not int for v in [count,ttl,limit,reserve]) or not 1<=reserve<=limit or not 0<=count<=limit or ttl not in range(0,61) and ttl!=-2 or ttl==-2 and count!=0:raise ValueError('Invalid quota observation')
 return max(ttl+1,1) if count>limit-reserve else 0

def main():
 report={'completed':False,'quotaLimitsChanged':False,'redisEntriesDeleted':False,'credentialsPrinted':False,'readReserve':96,'writeReserve':16};started=time.monotonic();waited=0.0
 try:
  credentials=ROOT/'.local/stack/demo-credentials.json'
  with credentials.open('rb') as stream:raw=stream.read(65537)
  assert len(raw)<=65536;users=json.loads(raw);assert isinstance(users,list) and 1<=len(users)<=16
  scopes=set()
  for user in users:
   assert all(isinstance(user[k],str) and re.fullmatch('[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}',user[k]) for k in ['organizationId','projectId'])
   scopes.add(user['organizationId']+':'+user['projectId'])
  with (ROOT/'.local/stack/redis-token').open('rb') as stream:token=stream.read(65)
  assert re.fullmatch(b'[a-f0-9]{64}',token)
  state=subprocess.run(['docker','inspect','--format','{{index .Config.Labels "com.docker.compose.project"}} {{index .Config.Labels "com.docker.compose.service"}}','agenttrust-stack-redis-1'],cwd=ROOT,capture_output=True,text=True,encoding='utf-8',timeout=10,check=True)
  assert state.stdout.strip()=='agenttrust stack-redis'
  # Token travels only via stdin into a container-local environment, never argv or output.
  script='IFS= read -r REDISCLI_AUTH; export REDISCLI_AUTH; redis-cli --user stack-gateway --raw EVAL "$1" 2 "$2" "$3"'
  snapshot="return {redis.call('GET',KEYS[1]) or '0',redis.call('TTL',KEYS[1]),redis.call('GET',KEYS[2]) or '0',redis.call('TTL',KEYS[2])}"
  while True:
   wait=0
   for scope in sorted(scopes):
    keys=['stack:quota:'+scope+':'+kind for kind in ['read','write']]
    result=subprocess.run(['docker','exec','-i','agenttrust-stack-redis-1','sh','-c',script,'quota-guard',snapshot,*keys],cwd=ROOT,input=token+b'\n',capture_output=True,timeout=10,check=True)
    assert len(result.stdout)<=1024;values=result.stdout.decode('ascii').splitlines();assert len(values)==4
    for offset,limit,reserve in [(0,240,96),(2,60,16)]:wait=max(wait,wait_seconds(int(values[offset] or '0'),int(values[offset+1]),limit,reserve))
   if not wait:break
   if time.monotonic()-started+wait>70:raise ValueError('Quota budget did not recover naturally')
   waiting=time.monotonic();until=waiting+wait
   while time.monotonic()<until:time.sleep(max(0,min(1,until-time.monotonic())))
   waited+=time.monotonic()-waiting
  report.update(completed=True,scopeCount=len(scopes),elapsedSeconds=round(time.monotonic()-started,3),waitedForNaturalExpiry=waited>0,naturalWaitSeconds=round(waited,3))
 except Exception as error:report.update(errorType=type(error).__name__,code='BROWSER_QUOTA_BUDGET_UNVERIFIED')
 print(json.dumps(report));return 0 if report['completed'] else 1
if __name__=='__main__':raise SystemExit(main())
