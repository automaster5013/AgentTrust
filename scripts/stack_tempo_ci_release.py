"""Read-only pinned public release inputs for the hosted synthetic Tempo job."""
import hashlib,importlib.util,io,json,os,pathlib,stat,urllib.error,urllib.parse,urllib.request,zipfile
ROOT=pathlib.Path(__file__).resolve().parent.parent
ARTIFACTS=((12631309929,40266953272,'d40cdd063f7f711fdd513d231ec2da2473796619','14cb0e4da4a76d41fa6379a04b145a0633cbf8f3a9835ba5747fc52201a106f5','delivery'),(12968038833,41037195649,'6e6c5dbcec0ec1678709107df6c26802bdafb5b1','d02ac1216544671e6716f9e9ca5225e1cfa01060dae2cd8ae4938fdadd58492c','receipt'))
def need(value):
 if not value:raise ValueError('Pinned CI release refused')
def load(name,file):
 spec=importlib.util.spec_from_file_location(name,ROOT/'scripts'/file);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):return None
def get(url,token=False,archive=False,limit=16*1024*1024):
 parsed=urllib.parse.urlsplit(url);need(parsed.scheme=='https' and parsed.hostname=='api.github.com' and not parsed.username and not parsed.password)
 headers={'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}
 if token:headers['Authorization']='Bearer '+os.environ['GITHUB_TOKEN']
 opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
 try:response=opener.open(urllib.request.Request(url,headers=headers),timeout=25)
 except urllib.error.HTTPError as error:
  need(archive and error.code==302);target=error.headers['Location'];error.close();p=urllib.parse.urlsplit(target)
  need(p.scheme=='https' and not p.username and not p.password and (p.hostname.endswith('.blob.core.windows.net') or p.hostname.endswith('.actions.githubusercontent.com')))
  response=opener.open(urllib.request.Request(target),timeout=25)
 with response:
  need(response.status==200);raw=response.read(limit+1);need(0<len(raw)<=limit);return raw

def extract(raw,destination):
 need(not destination.exists());entries=[];total=0
 with zipfile.ZipFile(io.BytesIO(raw)) as archive:
  need(0<len(archive.infolist())<=100)
  for row in archive.infolist():
   path=pathlib.PurePosixPath(row.filename);need(not row.is_dir() and not path.is_absolute() and len(path.parts)==1 and path.name==row.filename and '\\' not in row.filename and row.filename not in ('.','..') and not stat.S_ISLNK(row.external_attr>>16))
   need(row.file_size<=16*1024*1024 and row.filename not in [v[0] for v in entries]);total+=row.file_size;need(total<=64*1024*1024)
   entries.append((row.filename,archive.read(row)))
 destination.mkdir()
 for name,value in entries:(destination/name).write_bytes(value)

def verify(case,directory,checkpoint):
 directory.mkdir()
 for artifact_id,run,sha,digest,role in ARTIFACTS:
  checkpoint();base='https://api.github.com/repos/automaster5013/AgentTrust/actions/artifacts/'+str(artifact_id);meta=json.loads(get(base,True))
  need(meta['id']==artifact_id and meta['expired'] is False and meta['workflow_run']['id']==run and meta['workflow_run']['head_sha']==sha and meta['digest']=='sha256:'+digest)
  raw=get(base+'/zip',True,True);need(hashlib.sha256(raw).hexdigest()==digest);extract(raw,directory/role)
 verifier=load('ci_release_delivery','stack-delivery-verify.py');bundle,identity,records=verifier.validate(directory/'delivery',case['revision'],case['checksumsSha256'],case['repository'])
 receipt_files=list((directory/'receipt').iterdir());need(len(receipt_files)==1);receipt_raw=receipt_files[0].read_bytes();need(hashlib.sha256(receipt_raw).hexdigest()==case['receiptSha256']);receipt=verifier.json_bytes(receipt_raw)
 need(receipt['revision']==case['revision'] and receipt['sourceChecksumsSha256']==case['checksumsSha256'] and all(receipt[k] is True for k in ('published','sourceSignaturesVerifiedHere','destinationDigestsVerified')) and receipt['serverDeployed'] is False)
 need({r['name']:r['source'] for r in receipt['images']}=={r['name']:r['reference'] for r in records})
 online=load('ci_release_online','stack_release_online.py');online.verify_release_runs(case,case['revision'],receipt)
 tempo=next(r for r in records if r['name']=='tempo');published=next(r for r in receipt['images'] if r['name']=='tempo');need(published['reference']==case['image'] and case['image'].endswith('@sha256:'+tempo['digest']))
 checkpoint();verifier.Verifier(bundle,False,None).verify([tempo],identity,case['repository'],case['revision'])
 runtime=verifier.json_bytes((bundle/'runtime-identity.json').read_bytes());return {'runtimeImageId':runtime['imageIds']['tempo'],'sourceSignaturesVerified':True,'verifiedImageNames':['tempo'],'allSixteenSignaturesReverified':False,'publicationRunsVerified':True,'sourceRevision':case['revision'],'tempoReference':case['image']}
