"""Run only inside the owned portless fixture; create synthetic records there."""
import json,pathlib,time,traceback,uuid
from stack_test_client import StackClient,FixedRedirects
from stack_recovery_transport import fixture_opener
from stack_campaign_evidence import document

def require(value):
 if not value:raise ValueError('Online restore acceptance refused')

def main():
 report={'completed':False,'paidProviderCallsPerformed':False};clients=[]
 credentials=json.loads(pathlib.Path('/credentials.json').read_bytes())
 try:
  def login(username):
   client=StackClient('http://127.0.0.1:4320',credentials,{},clients)
   client.opener=fixture_opener(client.jar,FixedRedirects());identity=client.login(username)
   require(client.report.get('oidcAuthorizationCodePkceVerified') is True);return client,identity
  report['stage']='restored-oidc-login'
  admin,identity=login('demo-admin');viewer,_=login('demo-viewer');foreign,_=login('other-admin')
  report['stage']='new-queued-evaluation'
  body={'scenario':'pass','requiresApproval':True};key=str(uuid.uuid4())
  record=admin.request('runs','POST',body,{'Idempotency-Key':key});until=time.monotonic()+60
  while record['state']=='queued' and time.monotonic()<until:
   time.sleep(.5);record=admin.request('runs/'+record['id'])
  require(record['state']=='succeeded' and record['decision']=='pass' and record['result']['executionEngine']=='python-synthetic')
  report['stage']='role-and-tenant-boundaries'
  require(admin.request('runs/'+record['id']+'/gate')['deploymentAllowed'] is False)
  viewer.request('runs','POST',body,{'Idempotency-Key':str(uuid.uuid4())},expected=403)
  foreign.request('runs/'+record['id'],expected=404)
  report['stage']='review-and-idempotency'
  admin.request('runs/'+record['id']+'/reviews','POST',{'decision':'approved','reason':'isolated online recovery acceptance','expectedReviewSequence':0})
  require(admin.request('runs/'+record['id']+'/gate')['deploymentAllowed'] is True)
  require(admin.request('runs','POST',body,{'Idempotency-Key':key})['id']==record['id'])
  report['stage']='new-object-archive'
  until=time.monotonic()+20
  while True:
   try:archived=admin.request('runs/'+record['id']+'/evidence');break
   except AssertionError:
    require(admin.report.get('unexpectedHttpStatus') in (409,503) and time.monotonic()<until);time.sleep(.5)
  document(archived)
  report.update(completed=True,restoredOidcPkceVerified=True,newQueueEvaluationVerified=True,newObjectArchiveVerified=True,tenantAndRoleBoundariesVerified=True)
 except Exception as error:
  report.update(completed=False,errorType=type(error).__name__,failureLocations=[{'file':pathlib.Path(x.filename).name,'line':x.lineno} for x in traceback.extract_tb(error.__traceback__)])
  report['httpFailures']=[{k:client.report[k] for k in ('unexpectedHttpStatus','expectedHttpStatus','responseCode') if k in client.report} for client in clients]
 finally:
  closed=True
  for client in reversed(clients):
   try:client.logout()
   except Exception:closed=False
  report['ownSessionsClosed']=closed and all(not client.logged for client in clients)
 print(json.dumps(report));return 0 if report['completed'] and report['ownSessionsClosed'] else 1
if __name__=='__main__':raise SystemExit(main())
