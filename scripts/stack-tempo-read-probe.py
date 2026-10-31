"""Fixed loopback read-only Tempo API requests; no proxies or redirects."""
import json,re,sys,time,urllib.error,urllib.parse,urllib.request
class RefuseRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):raise ValueError('Tempo redirect refused')
def main():
 path=sys.argv[1]
 assert path=='/metrics' or re.fullmatch(r'/api/search\?start=\d+&end=\d+&limit=20',path) or re.fullmatch(r'/api/traces/[a-f0-9]{32}\?start=\d+&end=\d+',path)
 if path=='/metrics':
  opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),RefuseRedirect())
  with opener.open('http://127.0.0.1:3200/metrics',timeout=8) as response:
   raw=response.read(2097153);assert response.status==200 and len(raw)<=2097152
  print(json.dumps({'metrics':raw.decode('utf-8')}));return
 bounds=urllib.parse.parse_qs(urllib.parse.urlsplit(path).query);start,end=int(bounds['start'][0]),int(bounds['end'][0]);assert 0<start<end<time.time() and end-start<=7*86400
 opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),RefuseRedirect())
 request=urllib.request.Request('http://127.0.0.1:3200'+path,headers={'Accept':'application/json'})
 with opener.open(request,timeout=8) as response:
  raw=response.read(2097153);assert response.status==200 and len(raw)<=2097152
  frame=json.loads(raw)
 print(json.dumps(frame))
if __name__=='__main__':
 try:main()
 except Exception as error:
  print(json.dumps({'readError':{'errorType':type(error).__name__,'statusCode':getattr(error,'code',None)}}));sys.exit(1)
