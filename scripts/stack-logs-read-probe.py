"""Fixed bounded historical service_name log read via loopback only."""
import json,sys,time,urllib.parse,urllib.request
class RefuseRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):raise ValueError('Logs redirect refused')
def main():
 start,end=map(int,sys.argv[1:]);assert 0<start<end<time.time() and end-start<=7*86400
 query=urllib.parse.urlencode({'query':'{service_name=~".+"}','start':start*1000000000,'end':end*1000000000,'limit':100,'direction':'forward'})
 opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),RefuseRedirect())
 with opener.open('http://127.0.0.1:3100/loki/api/v1/query_range?'+query,timeout=10) as response:
  raw=response.read(2097153);assert response.status==200 and len(raw)<=2097152;frame=json.loads(raw)
 print(json.dumps(frame))
if __name__=='__main__':main()
