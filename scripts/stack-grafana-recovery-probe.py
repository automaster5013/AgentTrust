"""Authenticated reads only against the owned Grafana alias; no source network."""
import base64,json,pathlib,re,urllib.request

class RefuseRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):raise ValueError('Grafana redirect refused')

def main():
 report={'completed':False,'rawSecretsPrinted':False}
 try:
  expected=json.loads(pathlib.Path('/expected.json').read_bytes());password=pathlib.Path('/data/.admin-password').read_text();assert re.fullmatch('[a-f0-9]{64}',password)
  opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),RefuseRedirect())
  def get(path):
   assert path in ('/api/health','/api/search?type=dash-db&limit=1000','/api/datasources') or re.fullmatch('/api/dashboards/uid/[A-Za-z0-9_-]{1,64}',path)
   request=urllib.request.Request('http://stack-grafana:3000'+path,headers={'Authorization':'Basic '+base64.b64encode(('admin:'+password).encode()).decode()})
   with opener.open(request,timeout=5) as response:raw=response.read(2097153);assert response.status==200 and len(raw)<=2097152;return json.loads(raw)
  report['stage']='health';assert get('/api/health')['database']=='ok';report['stage']='dashboard-index';dashboards=get('/api/search?type=dash-db&limit=1000');report.update(actualDashboardCount=len(dashboards),expectedDashboardCount=len(expected['dashboards']));assert {v['uid'] for v in dashboards}=={v['uid'] for v in expected['dashboards']}
  for row in expected['dashboards']:
   view=get('/api/dashboards/uid/'+row['uid'])['dashboard'];assert view['uid']==row['uid'] and view['title']==row['title']
  report['stage']='datasources';sources=[{k:row[k] for k in ('uid','type','url')} for row in get('/api/datasources')];report.update(actualDataSourceCount=len(sources),expectedDataSourceCount=len(expected['dataSources']));assert sorted(sources,key=lambda r:r['uid'])==expected['dataSources']
  report.update(completed=True,dashboardsVerified=len(dashboards),dataSourcesVerified=len(sources),restoredMetadataQueryable=True)
 except Exception as error:report.update(completed=False,errorType=type(error).__name__)
 print(json.dumps(report));return 0 if report['completed'] else 1
if __name__=='__main__':raise SystemExit(main())
