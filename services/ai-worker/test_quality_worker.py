import json,uuid,pathlib
import pytest
from quality_worker import scoped_job,current_profile
from test_quality_evaluator import sample

def job():return {**{key:str(uuid.uuid4()) for key in ['runId','organizationId','projectId','campaignId','agentVersionId','datasetVersionId']},'caseId':'ready','scenario':'quality','provider':'ollama','qualityCase':sample(),'executionProfileSha256':'a'*64}

def test_installed_sources_match_exact_profiles_supplied_to_java_and_browser():
 root=pathlib.Path(__file__).parent
 expected=json.loads((root/'quality-execution-profiles.json').read_text(encoding='utf-8'))
 fingerprint=json.loads((root/'quality-validator-profile.json').read_text(encoding='utf-8'))['validatorProfileSha256']
 for provider in ['ollama','openai-compatible']:
  actual=current_profile(provider,fingerprint)
  assert actual==expected[provider]
  assert current_profile(provider,'b'*64)['contentSha256']!=actual['contentSha256']

def test_reference_job_requires_complete_bound_scope_and_case():
 value=job();assert scoped_job(json.dumps(value).encode()).model_dump()==value
 for key in ['campaignId','caseId','agentVersionId','datasetVersionId','executionProfileSha256','qualityCase']:
  invalid={k:v for k,v in value.items() if k!=key}
  with pytest.raises(ValueError):scoped_job(json.dumps(invalid).encode())

@pytest.mark.parametrize('change',[{'scenario':'pass'},{'provider':'synthetic'},{'provider':'openai'},{'runId':'invalid'},{'caseId':'../../escape'},{'url':'http://outside'},{'qualityCase':{**sample(),'expected':'Tampered'}}])
def test_untrusted_jobs_refused_before_reservation(change):
 with pytest.raises(ValueError):scoped_job(json.dumps({**job(),**change}).encode())

def test_duplicate_top_level_and_nested_fields_are_rejected():
 value=json.dumps(job())
 with pytest.raises(ValueError):scoped_job((value[:-1]+',"provider":"ollama"}').encode())
 with pytest.raises(ValueError):scoped_job(b'x'*4097)
