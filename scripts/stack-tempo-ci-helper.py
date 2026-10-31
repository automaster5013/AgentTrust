"""CI-only helper: fixed synthetic OTLP/loopback reads and owned scratch files."""
import base64,hashlib,json,os,pathlib,re,shutil,stat,sys,time,urllib.error,urllib.request,uuid
ROOT=pathlib.Path('/data');SOURCE=pathlib.Path('/source')
BAD=('00000000-0000-0000-0000-00000000bad1','00000000-0000-0000-0000-00000000bad2')
FILES=('meta.json','data.parquet','bloom-0','index')
def need(value):
 if not value:raise ValueError('Synthetic fixture refused')
def inventory(root):
 out={};total=0
 for path in sorted(root.rglob('*')):
  need(not path.is_symlink())
  if path.is_dir():continue
  info=path.stat();need(stat.S_ISREG(info.st_mode) and info.st_nlink==1 and info.st_size<=50*1024*1024)
  total+=info.st_size;need(total<=100*1024*1024 and len(out)<1000)
  out[path.relative_to(root).as_posix()]={'bytes':info.st_size,'mode':stat.S_IMODE(info.st_mode),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
 return out
def closed(root):
 base=root/'blocks/single-tenant';result=[]
 if not base.exists():return result
 for path in sorted(base.iterdir()):
  if not path.is_dir() or path.is_symlink():continue
  try:
   need(str(uuid.UUID(path.name))==path.name);meta=path/'meta.json';need(meta.is_file() and not meta.is_symlink() and meta.stat().st_size<=1048576);data=json.loads(meta.read_bytes())
   need(data['blockID']==path.name and type(data['totalObjects']) is int and data['totalObjects']>0);inventory(path);result.append(path.name)
  except (ValueError,KeyError):continue
 need(len(result)<=10);return result
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*a,**k):raise ValueError('Redirect refused')
def http(port,path,payload=None):
 opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect());request=urllib.request.Request('http://127.0.0.1:'+str(port)+path,data=payload,headers={'Content-Type':'application/json','Accept':'application/json'})
 try:
  with opener.open(request,timeout=8) as response:
   raw=response.read(2097153);need(len(raw)<=2097152);return response.status,raw
 except urllib.error.URLError as error:
  if not isinstance(error,urllib.error.HTTPError):return 503,b''
  need(error.code in (400,404,503));raw=error.read(2097153);need(len(raw)<=2097152);return error.code,raw
def main(action,data):
 root=ROOT
 if action=='closed':return {'blocks':closed(root)}
 if action=='clone':
  source=SOURCE;blocks=closed(source);need(blocks and not (root/'blocks').exists())
  for name in blocks:shutil.copytree(source/'blocks/single-tenant'/name,root/'blocks/single-tenant'/name)
  return {'blocks':blocks,'files':inventory(root/'blocks'),'walCopied':False}
 if action in ('inject','out','inverse','bad-files'):
  if action=='inject':
   for name in BAD:
    path=root/'blocks/single-tenant'/name;need(not path.exists());path.mkdir(parents=True)
    for filename in FILES:(path/filename).write_bytes(b'')
  elif action in ('out','inverse'):
   for name in BAD:
    original=root/'blocks/single-tenant'/name;quarantine=root/'quarantine'/name;source,target=(original,quarantine) if action=='out' else (quarantine,original)
    need(source.is_dir() and not source.is_symlink() and not target.exists() and not target.is_symlink());rows=inventory(source)
    need(set(rows)==set(FILES) and all(row['bytes']==0 and row['sha256']==hashlib.sha256(b'').hexdigest() for row in rows.values()))
    target.parent.mkdir(parents=True,exist_ok=True);source.rename(target)
  files={}
  for name in BAD:
   path=root/('quarantine' if action=='out' else 'blocks/single-tenant')/name
   rows=inventory(path);need(set(rows)==set(FILES));files.update({name+'/'+k:v for k,v in rows.items()})
  need(len(files)==8 and all(row['bytes']==0 for row in files.values()));return files
 if action=='clean':
  for path in root.iterdir():
   need(not path.is_symlink())
   if path.is_dir():shutil.rmtree(path)
   else:path.unlink()
  return {'cleaned':True}
 if action=='push':
  start=data['start'];need(type(start) is int and time.time()-3600<start<time.time()-10);resources=[]
  for i in range(1,21):
   count=7 if i<=13 else 6;spans=[];trace=format(i,'032x');parent=format(i*100+1,'016x')
   for j in range(count):
    row={'traceId':trace,'spanId':format(i*100+j+1,'016x'),'name':'synthetic-'+str(i)+'-'+str(j),'kind':1,'startTimeUnixNano':str(start*10**9+i*10**6+j*1000),'endTimeUnixNano':str(start*10**9+i*10**6+j*1000+500),'attributes':[{'key':'synthetic','value':{'boolValue':True}}]}
    if j:row['parentSpanId']=parent
    spans.append(row)
   resources.append({'resource':{'attributes':[{'key':'service.name','value':{'stringValue':'agenttrust-synthetic-ci'}}]},'scopeSpans':[{'scope':{'name':'synthetic-ci'},'spans':spans}]})
  status,raw=http(4318,'/v1/traces',json.dumps({'resourceSpans':resources}).encode());need(status==200);reply=json.loads(raw or b'{}');need(int(reply.get('partialSuccess',{}).get('rejectedSpans',0))==0);return {'traces':20,'spans':133}
 if action in ('ready','metrics','config'):
  path={'ready':'/ready','metrics':'/metrics','config':'/status/config'}[action];status,raw=http(3200,path);return {'status':status,'text':raw.decode('utf-8')}
 if action=='traces':
  start=data['start'];need(type(start) is int and time.time()-86400<start<time.time()-10);traces={}
  for i in range(1,21):
   trace=format(i,'032x');status,raw=http(3200,'/querier/api/traces/'+trace+'?mode=blocks&start='+str(start-1)+'&end='+str(start+5))
   if status!=200:return {'status':status,'response':raw.decode('utf-8',errors='replace')[:4096]}
   frame=json.loads(raw);traces[trace]=frame.get('trace',frame)
  return {'status':200,'traces':traces}
 raise ValueError('Unknown fixture operation')
if __name__=='__main__':
 try:
  need(os.name=='posix' and os.environ.get('AGENTTRUST_SYNTHETIC_HELPER')=='1');raw=sys.stdin.buffer.read(65537);need(len(raw)<=65536);result=main(sys.argv[1],json.loads(raw or b'{}'));print(json.dumps(result))
 except Exception as error:print(json.dumps({'refused':True,'errorType':type(error).__name__}));sys.exit(1)
