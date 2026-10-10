"""Verify unsigned frozen campaign evidence and exact child bytes without network access.

The optional expected parent hash must come from a separately trusted source.
Integrity is not a current release decision or a digital signature.
"""
import argparse,base64,datetime,hashlib,json,pathlib,re,uuid

def identifier(value):
 if not isinstance(value,str) or str(uuid.UUID(value))!=value:raise ValueError('Invalid evidence identifier')
 return value
def digest(value):
 if not isinstance(value,str) or not re.fullmatch('[a-f0-9]{64}',value):raise ValueError('Invalid evidence digest')
 return value
def version(value):
 if not isinstance(value,str) or not re.fullmatch('[A-Za-z0-9._-]{1,128}',value) or value=='null':raise ValueError('Invalid storage version')
 return value
def unique_object(pairs):
 value={}
 for key,item in pairs:
  if key in value:raise ValueError('Duplicate evidence field')
  value[key]=item
 return value
def document(proof):
 if not isinstance(proof,dict) or proof.get('integrityVerified') is not True or proof.get('storageEngine')!='minio':raise ValueError('Invalid evidence descriptor')
 size=proof.get('contentBytes');encoded=proof.get('contentBase64')
 if type(size) is not int or not 1<=size<=16384 or not isinstance(encoded,str) or len(encoded)>22000:raise ValueError('Invalid evidence size')
 content=base64.b64decode(encoded,validate=True)
 if len(content)!=size or hashlib.sha256(content).hexdigest()!=digest(proof.get('contentSha256')):raise ValueError('Evidence bytes mismatch')
 version(proof.get('storageVersion'));value=json.loads(content.decode('utf-8'),object_pairs_hook=unique_object)
 if not isinstance(value,dict):raise ValueError('Invalid evidence document')
 return value
def timestamp(value):
 parsed=datetime.datetime.fromisoformat(value)
 if parsed.tzinfo is None:raise ValueError('Evidence timestamp needs an offset')
 # Java's HTTP timestamp serializer exposes milliseconds. The parent byte hash
 # still protects all original microseconds stored in the immutable snapshot.
 return parsed.astimezone(datetime.timezone.utc).isoformat(timespec='milliseconds')
def normalized(value):
 if isinstance(value,list):return [normalized(item) for item in value]
 if isinstance(value,dict):return {key:timestamp(item) if key=='created_at' and isinstance(item,str) else normalized(item) for key,item in value.items()}
 return value
def verify_parent(proof,owner,record):
 expected=(identifier(record['id']),identifier(owner['organizationId']),identifier(owner['projectId']))
 if tuple(proof.get(key) for key in ['campaignId','organizationId','projectId'])!=expected or record['organization_id']!=expected[1] or record['project_id']!=expected[2] or record['state']=='queued':raise ValueError('Campaign scope mismatch')
 value=document(proof)
 if set(value)!=set(['schemaVersion','kind','deploymentAuthority','campaign','childArchives']) or type(value['schemaVersion']) is not int or value['schemaVersion']!=2 or value['kind']!='campaign-evidence' or value['deploymentAuthority'] is not False or normalized(value['campaign'])!=normalized(record):raise ValueError('Campaign snapshot mismatch')
 for kind,binding in [('agentVersion','agent'),('datasetVersion','dataset')]:
  item=record[kind];definition=item['definition'];actual=hashlib.sha256(json.dumps(definition,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode('utf-8')).hexdigest()
  if identifier(item['id'])!=record[binding+'_version_id'] or actual!=digest(item['content_sha256']) or actual!=record[binding+'_content_sha256'] or item['organization_id']!=expected[1] or item['project_id']!=expected[2] or definition.get('contract')!='fixed-scenarios-v1':raise ValueError('Immutable version contents mismatch')
 references=value['childArchives'];cases=record['cases']
 if not isinstance(references,list) or not isinstance(cases,list) or not 1<=len(cases)<=8 or len(references)!=len(cases):raise ValueError('Invalid child evidence count')
 seen=set()
 for case,reference in zip(cases,references):
  run=identifier(reference['runId']);digest(reference['contentSha256']);version(reference['storageVersion'])
  if run!=case['runId'] or run in seen or type(reference['contentBytes']) is not int or not 1<=reference['contentBytes']<=16384:raise ValueError('Child evidence binding mismatch')
  seen.add(run)
 return references
def verify_child(proof,owner,record,reference):
 if tuple(proof.get(k) for k in ['runId','organizationId','projectId'])!=(identifier(record['id']),identifier(owner['organizationId']),identifier(owner['projectId'])):raise ValueError('Child scope mismatch')
 if any(proof.get(key)!=reference.get(key) for key in ['runId','contentSha256','contentBytes','storageVersion']):raise ValueError('Pinned child archive mismatch')
 value=document(proof)
 if type(value.get('schemaVersion')) is not int or value.get('schemaVersion')!=1 or value.get('runId')!=record['id'] or value.get('organizationId')!=owner['organizationId'] or value.get('projectId')!=owner['projectId'] or value.get('scenario')!=record['scenario'] or value.get('provider','synthetic')!=record['provider'] or value.get('result')!=record['result']:raise ValueError('Stored child evidence mismatch')
 return value
def bounded_json(path,limit=50000):
 with path.open('rb') as file:content=file.read(limit+1)
 if len(content)>limit:raise ValueError('Evidence file too large')
 return json.loads(content.decode('utf-8'),object_pairs_hook=unique_object)
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--bundle',type=pathlib.Path,required=True);parser.add_argument('--organization',required=True);parser.add_argument('--project',required=True);parser.add_argument('--campaign',required=True);parser.add_argument('--expected-parent-sha256');args=parser.parse_args()
 try:
  root=args.bundle.resolve(strict=True);parent_path=(root/'parent.json').resolve(strict=True)
  if not parent_path.is_relative_to(root):raise ValueError('Evidence path escaped bundle')
  parent=bounded_json(parent_path);owner={'organizationId':identifier(args.organization),'projectId':identifier(args.project)};record=document(parent)['campaign']
  if record['id']!=identifier(args.campaign):raise ValueError('Campaign identifier mismatch')
  if args.expected_parent_sha256 and parent['contentSha256']!=digest(args.expected_parent_sha256):raise ValueError('Trusted parent hash mismatch')
  references=verify_parent(parent,owner,record)
  for case,reference in zip(record['cases'],references):
   child_path=(root/(identifier(case['runId'])+'.json')).resolve(strict=True)
   if not child_path.is_relative_to(root):raise ValueError('Child path escaped bundle')
   child=bounded_json(child_path);stored=document(child);run={'id':case['runId'],'scenario':case['scenario'],'provider':case['provider'],'result':stored['result']}
   if stored['result']['state']!=case['state'] or stored['result']['decision']!=case['decision']:raise ValueError('Child result disagrees with parent')
   verify_child(child,owner,run,reference)
  print(json.dumps({'completed':True,'childArchives':len(references),'networkAccessed':False,'signatureVerified':False,'currentDeploymentAuthority':False,'separatelySuppliedParentHashMatched':args.expected_parent_sha256 is not None}))
 except Exception:
  print(json.dumps({'completed':False,'code':'CAMPAIGN_EVIDENCE_UNVERIFIED','networkAccessed':False,'signatureVerified':False,'currentDeploymentAuthority':False}));raise SystemExit(1)
if __name__=='__main__':main()
