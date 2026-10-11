"""Independent bounded reference grader; raw model text remains ephemeral."""
import hashlib
import json
import re
import unicodedata
from providers import strict_json

CANONICAL_ANSWER=re.compile(r'^\s*\{\s*"answer"\s*:\s*"(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"\s*\}\s*$',re.UNICODE)
TRIM_CHARS='\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'

def validate_case(value):
 if not isinstance(value,dict) or set(value)!={'input','expected','contentSha256'}:raise ValueError('Invalid reference case')
 for key,limit in [('input',192),('expected',128)]:
  item=value[key]
  if not isinstance(item,str) or not item.strip(TRIM_CHARS) or '\x00' in item or len(item.encode('utf-8'))>limit:raise ValueError('Invalid reference case')
 definition={'contract':'reference-answer-case-v1','input':value['input'],'expected':value['expected']}
 digest=hashlib.sha256(json.dumps(definition,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode('utf-8')).hexdigest()
 if value['contentSha256']!=digest:raise ValueError('Reference case fingerprint mismatch')
 return value

def grade(actual,expected):
 if not isinstance(actual,str) or len(actual.encode('utf-8'))>2048 or not isinstance(expected,str) or not expected.strip(TRIM_CHARS) or len(expected.encode('utf-8'))>128:raise ValueError('Invalid bounded reference sample')
 try:
  value=strict_json(actual)
  return bool(CANONICAL_ANSWER.fullmatch(actual)) and isinstance(value,dict) and set(value)=={'answer'} and isinstance(value['answer'],str) and unicodedata.normalize('NFC',value['answer']).strip(TRIM_CHARS)==unicodedata.normalize('NFC',expected).strip(TRIM_CHARS)
 except (ValueError,TypeError):return False

def agreement(actual,expected,proof,fingerprint,provider):
 if provider not in ['ollama','openai-compatible'] or not isinstance(proof,dict) or set(proof)!={'graded','pass','assertions','engine','version','validatorProfileSha256'}:raise ValueError('Verifier unavailable')
 if proof['graded'] is not True or type(proof['pass']) is not bool or type(proof['assertions']) is not int or proof['assertions']!=2 or proof['engine']!='promptfoo' or proof['version']!='0.124.1' or not re.fullmatch('[a-f0-9]{64}',fingerprint) or proof['validatorProfileSha256']!=fingerprint:raise ValueError('Verifier unavailable')
 own=grade(actual,expected)
 if own!=proof['pass']:raise ValueError('Independent graders disagree')
 return {'state':'succeeded','decision':'pass' if own else 'block','executionEngine':'python-'+provider,'rules':[
  {'id':'reference-answer','required':True,'status':'pass' if own else 'fail','reason':'Bounded JSON answer compared with the immutable reference; raw model output is not retained.'},
  {'id':'verifier-agreement','required':True,'status':'pass','reason':'Independent Python and Promptfoo 0.124.1 checks agree; verifier '+fingerprint+'.'},
  {'id':'output-sha256','required':False,'status':'pass','reason':hashlib.sha256(actual.encode('utf-8')).hexdigest()},
  {'id':'reference-sha256','required':False,'status':'pass','reason':hashlib.sha256(expected.encode('utf-8')).hexdigest()}]}
