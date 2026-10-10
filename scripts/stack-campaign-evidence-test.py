"""Meaningful offline contract checks; synthetic fixtures, no Docker/network/secrets."""
import base64,copy,hashlib,json,unittest,uuid
from stack_campaign_evidence import document,normalized,verify_parent,verify_child
def id():return str(uuid.uuid4())
def sha(value):return hashlib.sha256(json.dumps(value,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
def proof(value,**scope):
 content=json.dumps(value,ensure_ascii=False).encode();return {**scope,'integrityVerified':True,'storageEngine':'minio','contentBytes':len(content),'contentSha256':hashlib.sha256(content).hexdigest(),'storageVersion':'version-1','contentBase64':base64.b64encode(content).decode()}
def fixture():
 owner={'organizationId':id(),'projectId':id()};scope={'organization_id':owner['organizationId'],'project_id':owner['projectId']};agent_def={'contract':'fixed-scenarios-v1','description':'고정 평가','provider':'synthetic'};data_def={'contract':'fixed-scenarios-v1','cases':[{'id':'required-pass','scenario':'pass','required':True}]};agent={**scope,'id':id(),'definition':agent_def,'content_sha256':sha(agent_def)};data={**scope,'id':id(),'definition':data_def,'content_sha256':sha(data_def)};run_id=id();result={'state':'succeeded','decision':'pass','executionEngine':'python-synthetic','rules':[{'id':'required-output','required':True,'status':'pass','reason':'Synthetic'}]};child={'id':run_id,'provider':'synthetic','scenario':'pass','result':result};child_doc={'schemaVersion':1,'runId':run_id,**owner,'provider':'synthetic','scenario':'pass','result':result};child_proof=proof(child_doc,runId=run_id,**owner);reference={key:child_proof[key] for key in ['runId','contentSha256','contentBytes','storageVersion']};record={**scope,'id':id(),'agent_version_id':agent['id'],'dataset_version_id':data['id'],'agent_content_sha256':agent['content_sha256'],'dataset_content_sha256':data['content_sha256'],'agentVersion':agent,'datasetVersion':data,'state':'succeeded','cases':[{'runId':run_id}]};parent={'schemaVersion':2,'kind':'campaign-evidence','deploymentAuthority':False,'campaign':record,'childArchives':[reference]};parent_proof=proof(parent,campaignId=record['id'],**owner);return owner,record,parent,parent_proof,child,child_proof,reference
class EvidenceContracts(unittest.TestCase):
 def test_matching_bytes_and_scoped_parent_child_chain(self):
  owner,record,parent,parent_proof,child,child_proof,reference=fixture();self.assertEqual(verify_parent(parent_proof,owner,record),[reference]);self.assertEqual(verify_child(child_proof,owner,child,reference)['result'],child['result'])
 def test_substituted_parent_bytes_scope_versions_and_children_are_refused(self):
  owner,record,parent,parent_proof,child,child_proof,reference=fixture()
  with self.assertRaises(ValueError):document({**parent_proof,'contentSha256':'0'*64})
  with self.assertRaises(ValueError):verify_parent({**parent_proof,'projectId':id()},owner,record)
  changed=copy.deepcopy(parent);changed['childArchives'][0]['runId']=id()
  with self.assertRaises(ValueError):verify_parent(proof(changed,campaignId=record['id'],**owner),owner,record)
  changed=copy.deepcopy(record);changed['agentVersion']['definition']['description']='substituted';modified={**parent,'campaign':changed}
  with self.assertRaises(ValueError):verify_parent(proof(modified,campaignId=record['id'],**owner),owner,changed)
 def test_parent_does_not_issue_authority_and_child_version_cannot_change(self):
  owner,record,parent,parent_proof,child,child_proof,reference=fixture()
  with self.assertRaises(ValueError):verify_parent(proof({**parent,'deploymentAuthority':True},campaignId=record['id'],**owner),owner,record)
  with self.assertRaises(ValueError):verify_child({**child_proof,'storageVersion':'version-2'},owner,child,reference)
  with self.assertRaises(ValueError):document({**child_proof,'contentBytes':True})
 def test_duplicate_json_and_ambiguous_timestamps_are_refused(self):
  content=b'{"schemaVersion":1,"schemaVersion":2}';p={'integrityVerified':True,'storageEngine':'minio','contentBytes':len(content),'contentSha256':hashlib.sha256(content).hexdigest(),'storageVersion':'version-1','contentBase64':base64.b64encode(content).decode()}
  with self.assertRaises(ValueError):document(p)
  self.assertEqual(normalized({'created_at':'2026-10-11T00:00:00.123456Z'}),normalized({'created_at':'2026-10-11T09:00:00.123+09:00'}))
  with self.assertRaises(ValueError):normalized({'created_at':'2026-10-11T00:00:00'})
if __name__=='__main__':unittest.main()
