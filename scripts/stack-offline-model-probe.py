"""Fixed loopback inference in an owned network-none model namespace only."""
import json,urllib.error,urllib.request
PAYLOAD={'model':'qwen3:0.6b','prompt':'Reply with the word ready. /no_think','think':False,'stream':False,'keep_alive':0,'options':{'num_predict':16,'num_ctx':512,'num_thread':2,'temperature':0,'seed':42}}
class RefuseRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):raise ValueError('Model redirect refused')

def main():
 report={'completed':False,'modelDownloadsPerformed':False,'paidProviderCallsPerformed':False,'rawGeneratedTextPrinted':False}
 try:
  opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),RefuseRedirect())
  request=urllib.request.Request('http://127.0.0.1:11434/api/generate',data=json.dumps(PAYLOAD).encode(),headers={'Content-Type':'application/json'})
  with opener.open(request,timeout=120) as response:raw=response.read(131073);assert response.status==200 and len(raw)<=131072;answer=json.loads(raw)
  assert answer['done'] is True and answer['model']==PAYLOAD['model'] and isinstance(answer['response'],str) and answer['response'].strip() and 0<answer['eval_count']<=16
  report.update(completed=True,offlineInferenceVerified=True,outputTokens=answer['eval_count'])
 except urllib.error.HTTPError as error:
  raw=error.read(4097);message=''
  try:message=json.loads(raw).get('error','').lower()
  except Exception:pass
  report.update(completed=False,errorType=type(error).__name__,statusCode=error.code,errorCategory='model-not-found' if 'not found' in message else 'memory' if 'memory' in message else 'runner' if 'runner' in message else 'other')
 except Exception as error:report.update(completed=False,errorType=type(error).__name__)
 print(json.dumps(report));return 0 if report['completed'] else 1
if __name__=='__main__':raise SystemExit(main())
