"""Real Ed25519 observations; historical signatures never override current rejection."""
import base64,datetime,json,pathlib,subprocess,sys,time,traceback,uuid
from stack_test_client import StackClient
from stack_campaign_evidence import verify_parent,verify_child
root=pathlib.Path(__file__).resolve().parent.parent;directory=root/'.local'/('stack-campaign-receipt-'+str(uuid.uuid4()));directory.mkdir();inputs=directory/'inputs';inputs.mkdir();clients=[];stopped=False;storage_stopped=False;stage='login'
report={'completed':False,'checks':[],'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'credentialsRecorded':False,'privateKeyExported':False,'paidApiCalls':False,'actualDeploymentPerformed':False,'currentDeploymentAuthority':False}
def command(args,**kwargs):return subprocess.run(args,cwd=root,capture_output=True,text=True,timeout=90,**kwargs)
def write(name,value):
 with (inputs/name).open('x',encoding='utf-8') as file:file.write(json.dumps(value,ensure_ascii=False)+'\n')
def wait(client,record):
 until=time.monotonic()+30
 while record['state']=='queued' and time.monotonic()<until:time.sleep(.5);record=client.request('campaigns/'+record['id'])
 assert record['state']=='succeeded';return record
def evidence(client,id):
 until=time.monotonic()+45
 while time.monotonic()<until:
  try:return client.request('campaigns/'+id+'/evidence')
  except AssertionError:
   if report.get('unexpectedHttpStatus') not in [409,503]:raise
   time.sleep(.5)
 raise AssertionError('Archive deadline')
def observation(client,id,note,key=None,expected=200):return client.request('campaigns/'+id+'/receipts','POST',{'note':note},{'Idempotency-Key':key or str(uuid.uuid4())},expected=expected)
def restore_policy():
 assert command(['docker','start','agenttrust-stack-opa-1']).returncode==0;until=time.monotonic()+35
 while time.monotonic()<until:
  state=json.loads(command(['docker','inspect','agenttrust-stack-opa-1']).stdout)[0]
  if state['State'].get('Health',{}).get('Status')=='healthy':return
  time.sleep(.5)
 raise AssertionError('Policy recovery deadline')
def restore_storage():
 assert command(['docker','start','agenttrust-stack-object-store-1']).returncode==0;until=time.monotonic()+35
 while time.monotonic()<until:
  state=json.loads(command(['docker','inspect','agenttrust-stack-object-store-1']).stdout)[0]
  if state['State'].get('Health',{}).get('Status')=='healthy':return
  time.sleep(.5)
 raise AssertionError('Storage recovery deadline')
try:
 credentials=json.loads((root/'.local/stack/demo-credentials.json').read_text(encoding='utf-8'));admin=StackClient('http://127.0.0.1:4320',credentials,report,clients);owner=admin.login('demo-admin');assert admin.request('auth-info')['gateSigning']=='local-development';trust=admin.request('gate-trust');assert not trust['productionKey'];suffix=uuid.uuid4().hex[:12]
 stage='evaluation';agent=admin.request('versions/agents','POST',{'key':'receipt-agent-'+suffix,'version':1,'provider':'synthetic','description':'Signed historical development observation'});dataset=admin.request('versions/datasets','POST',{'key':'receipt-data-'+suffix,'version':1,'cases':[{'id':'required-pass','scenario':'pass','required':True},{'id':'optional-block','scenario':'block','required':False}]});record=wait(admin,admin.request('campaigns','POST',{'agentVersionId':agent['id'],'datasetVersionId':dataset['id'],'requiresApproval':True},{'Idempotency-Key':str(uuid.uuid4())}));proof=evidence(admin,record['id']);references=verify_parent(proof,owner,record);write('parent.json',proof);write('campaign.json',record)
 for case,reference in zip(record['cases'],references):
  child=admin.request('runs/'+case['runId']);child_proof=admin.request('runs/'+case['runId']+'/evidence');verify_child(child_proof,owner,child,reference);write(case['runId']+'.json',child_proof)
 stage='held-observation';held=observation(admin,record['id'],'Before required review');payload=json.loads(base64.b64decode(held['payloadBase64'],validate=True));assert held['signatureVerified'] and not held['currentDeploymentAuthority'] and not payload['observedGate']['deploymentAllowed'];report['checks'].append('actual development key signs held observation bound to exact campaign and child archive versions')
 stage='approved-observation';admin.request('campaigns/'+record['id']+'/reviews','POST',{'decision':'approved','reason':'Synthetic historical observation fixture'});key=str(uuid.uuid4());approved=observation(admin,record['id'],'Approved historical observation',key);payload=json.loads(base64.b64decode(approved['payloadBase64'],validate=True));assert payload['observedGate']['deploymentAllowed'] and not payload['currentDeploymentAuthority'];write('receipt.json',approved)
 stage='current-rejection';admin.request('campaigns/'+record['id']+'/reviews','POST',{'decision':'rejected','reason':'Historical approval must not override current rejection'});assert not admin.request('campaigns/'+record['id']+'/gate')['deploymentAllowed'];assert admin.request('campaigns/'+record['id']+'/receipts/'+approved['receiptId'])==approved;assert observation(admin,record['id'],'Approved historical observation',key)==approved;observation(admin,record['id'],'Changed note',key,expected=409);rejected=observation(admin,record['id'],'Latest review rejects');assert not json.loads(base64.b64decode(rejected['payloadBase64']))['observedGate']['deploymentAllowed'];report['checks'].append('current rejection denies release; old approval signature and idempotent receipt remain unchanged without granting authority')
 stage='offline';args=['node','--experimental-strip-types','scripts/stack-verify-campaign-receipt.ts','--bundle',str(inputs),'--trusted-public-key',str(root/'.local/stack/gate-keys/public-key.pem'),'--organization',owner['organizationId'],'--project',owner['projectId'],'--campaign',record['id']];verified=command(args);assert verified.returncode==0;offline=json.loads(verified.stdout);assert offline['signatureVerified'] and not offline['currentDeploymentAuthority'] and not offline['networkUsed'];report['offlineSignatureVerification']=offline
 chain=command([sys.executable,'scripts/stack_campaign_evidence.py','--bundle',str(inputs),'--organization',owner['organizationId'],'--project',owner['projectId'],'--campaign',record['id'],'--expected-parent-sha256',proof['contentSha256']]);assert chain.returncode==0 and json.loads(chain.stdout)['childArchives']==2;report['checks'].append('offline Node verifies actual Ed25519 against independently supplied public PEM; Python verifies actual parent and both child byte chains')
 stage='bounded-export';bundle=admin.request('campaigns/'+record['id']+'/receipts/'+approved['receiptId']+'/bundle');assert bundle['kind']=='campaign-observation-bundle' and not bundle['currentDeploymentAuthority'] and bundle['receipt']==approved and len(bundle['children'])==2;write('bundle.json',bundle);export_args=args.copy();export_args[export_args.index('--bundle')+1]=str(inputs/'bundle.json');exported=command(export_args);assert exported.returncode==0;export_proof=json.loads(exported.stdout);assert export_proof['signatureVerified'] and export_proof['childBytesVerified'] and not export_proof['currentDeploymentAuthority'];report['offlineCompleteBundleVerification']=export_proof
 altered=json.loads(json.dumps(bundle));altered['children'][0]['archive']['contentBase64']=base64.b64encode(b'changed child bytes').decode();write('altered-bundle.json',altered);bad=export_args.copy();bad[bad.index('--bundle')+1]=str(inputs/'altered-bundle.json');assert command(bad).returncode==1;report['checks'].append('bounded scoped bundle verifies signature and all child bytes offline; altered child archive prevents export verification')

 # Negative bundles are new files only; preserve the original proof fixture.
 tampered=directory/'tampered';tampered.mkdir()
 for name,value in [('campaign.json',record),('parent.json',proof),('receipt.json',{**approved,'payloadBase64':base64.b64encode(base64.b64decode(approved['payloadBase64'])+b' ').decode()})]:
  with (tampered/name).open('x',encoding='utf-8') as file:file.write(json.dumps(value)+'\n')
 bad=args.copy();bad[bad.index('--bundle')+1]=str(tampered);assert command(bad).returncode==1
 wrong=directory/'wrong-public.pem';created=command(['node','--input-type=module','-e',"import {generateKeyPairSync} from 'node:crypto';import {writeFileSync} from 'node:fs';writeFileSync(process.argv[1],generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'}),{flag:'wx'});",str(wrong)]);assert created.returncode==0;bad=args.copy();bad[bad.index('--trusted-public-key')+1]=str(wrong);assert command(bad).returncode==1;report['checks'].append('altered signed payload and unrelated independently supplied public key are refused offline')
 stage='scope-and-role';viewer=StackClient('http://127.0.0.1:4320',credentials,report,clients);viewer.login('demo-viewer');assert viewer.request('campaigns/'+record['id']+'/receipts/'+approved['receiptId'])==approved;assert viewer.request('campaigns/'+record['id']+'/receipts/'+approved['receiptId']+'/bundle')==bundle;observation(viewer,record['id'],'Viewer cannot issue',expected=403);foreign=StackClient('http://127.0.0.1:4320',credentials,report,clients);foreign.login('other-admin');foreign.request('campaigns/'+record['id']+'/receipts/'+approved['receiptId'],expected=404);foreign.request('campaigns/'+record['id']+'/receipts/'+approved['receiptId']+'/bundle',expected=404);observation(foreign,record['id'],'Foreign cannot issue',expected=404);report['checks'].append('viewer reads own historical proof but cannot issue; foreign scope receives 404')
 stage='policy-outage';state=json.loads(command(['docker','inspect','agenttrust-stack-opa-1']).stdout)[0];assert state['State']['Running'] and state['Config']['Labels']['com.docker.compose.project']=='agenttrust' and state['Config']['Labels']['com.docker.compose.service']=='stack-opa';stopped=True;assert command(['docker','stop','--time','15','agenttrust-stack-opa-1']).returncode==0;observation(admin,record['id'],'Cannot issue without current policy',expected=503);assert admin.request('campaigns/'+record['id']+'/receipts/'+approved['receiptId'])==approved;restore_policy();stopped=False;assert not admin.request('campaigns/'+record['id']+'/gate')['deploymentAllowed'];report['checks'].append('policy outage refuses new signed observation; existing historical signature stays readable; restored current rejection still denies')
 stage='storage-export-outage';storage_stopped=True;assert command(['docker','stop','--time','15','agenttrust-stack-object-store-1']).returncode==0;admin.request('campaigns/'+record['id']+'/receipts/'+approved['receiptId']+'/bundle',expected=503);foreign.request('campaigns/'+record['id']+'/receipts/'+approved['receiptId']+'/bundle',expected=404);assert admin.request('campaigns/'+record['id']+'/receipts/'+approved['receiptId'])==approved;restore_storage();storage_stopped=False;assert admin.request('campaigns/'+record['id']+'/receipts/'+approved['receiptId']+'/bundle')==bundle;report['checks'].append('storage outage refuses a complete bundle while historical signature remains valid; foreign bundle stays hidden and exact bytes survive restart')
 stage='core-restart'
 for client in clients:client.logout()
 assert command(['docker','restart','--time','15','agenttrust-stack-core-api-1']).returncode==0;until=time.monotonic()+45
 while time.monotonic()<until:
  state=json.loads(command(['docker','inspect','agenttrust-stack-core-api-1']).stdout)[0]
  if state['State'].get('Health',{}).get('Status')=='healthy':break
  time.sleep(.5)
 assert state['State'].get('Health',{}).get('Status')=='healthy';fresh=StackClient('http://127.0.0.1:4320',credentials,report,clients);fresh.login('demo-admin');assert fresh.request('gate-trust')['keyId']==trust['keyId'];assert fresh.request('campaigns/'+record['id']+'/receipts/'+approved['receiptId'])==approved;assert not fresh.request('campaigns/'+record['id']+'/gate')['deploymentAllowed'];report['checks'].append('Core restart retains the exact development trust key and signed receipt; fresh session still observes current rejection')
 stage='database-immutability';sql="BEGIN;SET LOCAL ROLE agenttrust_stack_api;DO $$ BEGIN IF has_table_privilege(current_user,'stack_campaign_receipts','UPDATE') OR has_table_privilege(current_user,'stack_campaign_receipts','DELETE') THEN RAISE EXCEPTION 'mutable receipts';END IF;IF (SELECT count(*) FROM stack_campaign_receipts)<>0 THEN RAISE EXCEPTION 'unscoped receipts visible';END IF;END $$;ROLLBACK;";assert command(['docker','exec','-i','agenttrust-stack-db-1','psql','-U','agenttrust_stack','-d','agenttrust_stack','-v','ON_ERROR_STOP=1'],input=sql).returncode==0;report['checks'].append('RLS hides unscoped receipts and API role cannot update or delete signed observations');report.update(completed=True,campaignId=record['id'],receiptId=approved['receiptId'],keyId=trust['keyId'])
except Exception as error:report.update(code='STACK_CAMPAIGN_RECEIPT_UNVERIFIED',failedStage=stage,errorType=type(error).__name__,failureLocations=[{'file':pathlib.Path(t.filename).name,'line':t.lineno} for t in traceback.extract_tb(error.__traceback__)])
finally:
 restored=True
 if stopped:
  try:restore_policy()
  except Exception:restored=False
 if storage_stopped:
  try:restore_storage()
  except Exception:restored=False
 closed=True
 for client in reversed(clients):
  try:client.logout()
  except Exception:closed=False
 report.update(policyRestored=restored,storageRestored=not storage_stopped or restored,ownSessionsLoggedOut=closed,finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat());path=directory/'summary.json';path.open('x',encoding='utf-8').write(json.dumps(report,indent=2)+'\n');print(json.dumps({'completed':report['completed'],'checks':len(report['checks']),'policyRestored':restored,'ownSessionsLoggedOut':closed,'failedStage':report.get('failedStage'),'reportPath':str(path)}))
 if not report['completed'] or not restored or not closed:raise SystemExit(1)
