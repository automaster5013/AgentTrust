import hashlib,json
import pytest
from quality_evaluator import validate_case,grade,agreement

def sample(input='Return READY',expected='READY'):
 definition={'contract':'reference-answer-case-v1','input':input,'expected':expected}
 return {'input':input,'expected':expected,'contentSha256':hashlib.sha256(json.dumps(definition,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()}

def proof(passed=True):return {'graded':True,'pass':passed,'assertions':2,'engine':'promptfoo','version':'0.124.1','validatorProfileSha256':'a'*64}

def test_case_binding_rejects_changed_input_and_reference():
 assert validate_case(sample())==sample()
 for value in [{**sample(),'input':'Changed'},{**sample(),'expected':'DENIED'},{**sample(),'url':'http://outside'},{**sample(),'contentSha256':'b'*64}]:
  with pytest.raises(ValueError):validate_case(value)

@pytest.mark.parametrize('input,expected',[('', 'READY'),('x'*193,'READY'),('a\x00b','READY'),('READY',''),('READY','é'*65)])
def test_utf8_bounds(input,expected):
 with pytest.raises(ValueError):validate_case(sample(input,expected))

@pytest.mark.parametrize('actual',['not JSON','{}','{"answer":null}','{"answer":"DENIED"}','{"answer":"DENIED","answer":"READY"}','{"answer":"READY","extra":1}','["READY"]'])
def test_invalid_or_wrong_output_fails(actual):assert grade(actual,'READY') is False

def test_unicode_and_literal_template_are_only_compared():
 assert grade('{"answer":"  READY  "}','READY')
 assert grade(json.dumps({'answer':'e\u0301'}),'é')
 assert grade(json.dumps({'answer':'{{env.PRIVATE}}'}),'{{env.PRIVATE}}')
 assert grade(json.dumps({'answer':'\ufeffREADY\u00a0'}),'READY')
 assert grade(json.dumps({'answer':'\u0085'}),'\u0085')
 assert not grade(json.dumps({'answer':'\u0085READY'}),'READY')
 with pytest.raises(ValueError):validate_case(sample('Return READY','\ufeff\u00a0'))

def test_agreement_produces_no_raw_answer_and_disagreement_is_unavailable():
 result=agreement('{"answer":"PRIVATE_CANARY"}','PRIVATE_CANARY',proof(),'a'*64,'ollama')
 assert result['decision']=='pass' and 'PRIVATE_CANARY' not in json.dumps(result)
 assert agreement('{"answer":"DENIED"}','READY',proof(False),'a'*64,'openai-compatible')['decision']=='block'
 with pytest.raises(ValueError):agreement('{"answer":"DENIED"}','READY',proof(),'a'*64,'ollama')

@pytest.mark.parametrize('change',[{'graded':False},{'pass':1},{'assertions':2.0},{'assertions':1},{'engine':'mock'},{'version':'unknown'},{'validatorProfileSha256':'b'*64},{'raw':'SECRET'}])
def test_untrusted_verifier_response_is_unavailable(change):
 with pytest.raises(ValueError):agreement('{"answer":"READY"}','READY',{**proof(),**change},'a'*64,'ollama')
