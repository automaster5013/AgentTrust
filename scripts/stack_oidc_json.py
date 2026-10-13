"""Bounded strict UTF-8 JSON objects for operator-supplied OIDC configuration."""
import json,math
def unique_pairs(pairs):
 result={}
 for key,value in pairs:
  if key in result:raise ValueError('Duplicate JSON key')
  result[key]=value
 return result
def invalid_constant(_):raise ValueError('Invalid JSON number')
def finite_float(text):
 value=float(text)
 if not math.isfinite(value):raise ValueError('Invalid JSON number')
 return value
def object_from_bytes(raw,maximum):
 if len(raw)>maximum:raise ValueError('Input exceeds bound')
 value=json.loads(raw.decode('utf-8'),object_pairs_hook=unique_pairs,parse_constant=invalid_constant,parse_float=finite_float)
 if not isinstance(value,dict):raise ValueError('Expected JSON object')
 return value
