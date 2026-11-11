"""Bounded fixed historical up query via loopback, no mutations/proxies/redirects."""
import json,sys,time,urllib.parse,urllib.request
class RefuseRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):raise ValueError('Metrics redirect refused')
def main():
 start,end=map(int,sys.argv[1:])
 if not (0<start<end<time.time() and end-start<=3600):
  raise ValueError('Invalid historical metric range')
 query=urllib.parse.urlencode({'query':'up{job="agenttrust-otel"}','start':start,'end':end,'step':30})
 opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),RefuseRedirect())
 with opener.open('http://127.0.0.1:9090/api/v1/query_range?'+query,timeout=8) as response:
  raw=response.read(2097153)
  if response.status!=200 or len(raw)>2097152:
   raise ValueError('Invalid historical metric response')
  frame=json.loads(raw)
 print(json.dumps(frame))
if __name__=='__main__':main()
