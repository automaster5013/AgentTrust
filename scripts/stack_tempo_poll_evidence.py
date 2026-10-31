"""Distinguish failed warm polling from a successful repair; no Docker operations."""
import json,math,re

NAMES=('tempodb_blocklist_tenant_index_errors_total','tempodb_blocklist_poll_duration_seconds_count')

def counters(text):
 if not isinstance(text,str) or len(text)>2097152:raise ValueError('Bounded metrics required')
 result={};series={name:{} for name in NAMES}
 for line in text.splitlines():
  if not line or line.startswith('#'):continue
  match=re.fullmatch(r'([a-zA-Z_:][a-zA-Z0-9_:]*)(\{[^\n]*\})?\s+([^\s]+)(?:\s+\d+)?',line)
  if not match or match[1] not in NAMES:continue
  labels=match[2];key='<unlabelled>'
  if labels is not None:
   label=re.fullmatch(r'\{tenant=("(?:[^"\\\n]|\\["\\n])*")\}',labels)
   if match[1]!=NAMES[0] or not label:raise ValueError('Unexpected counter labels')
   key=json.dumps(json.loads(label[1]),ensure_ascii=True)
  value=float(match[3])
  if key in series[match[1]] or not math.isfinite(value) or value<0 or not value.is_integer():raise ValueError('Invalid counter evidence')
  series[match[1]][key]=int(value);result[match[1]]=result.get(match[1],0)+int(value)
 if set(result)!=set(NAMES):raise ValueError('Incomplete polling metrics')
 return {'totals':result,'series':series}

def classify_inverse(before,after,traces_match,tenant):
 if not isinstance(tenant,str) or not re.fullmatch('[A-Za-z0-9_-]{1,128}',tenant):raise ValueError('Bound tenant required')
 if type(traces_match) is not bool:raise ValueError('Incomplete inverse evidence')
 for snapshot in (before,after):
  if not isinstance(snapshot,dict) or set(snapshot)!=set(('totals','series')) or set(snapshot['totals'])!=set(NAMES) or set(snapshot['series'])!=set(NAMES):raise ValueError('Incomplete inverse counters')
  for name in NAMES:
   rows=snapshot['series'][name]
   if not isinstance(rows,dict) or not rows or not all(isinstance(key,str) and type(value) is int and value>=0 for key,value in rows.items()):raise ValueError('Invalid counter series')
   if type(snapshot['totals'][name]) is not int or snapshot['totals'][name]!=sum(rows.values()):raise ValueError('Counter total differs')
 for name in NAMES:
  if set(before['series'][name])!=set(after['series'][name]):raise ValueError('Counter series changed')
  if any(after['series'][name][key]<value for key,value in before['series'][name].items()):raise ValueError('Counter reset is inconclusive')
 delta={name:after['totals'][name]-before['totals'][name] for name in NAMES}
 key=json.dumps(tenant,ensure_ascii=True)
 if key not in before['series'][NAMES[0]] or key not in after['series'][NAMES[0]]:raise ValueError('Bound tenant counter missing')
 bound_delta=after['series'][NAMES[0]][key]-before['series'][NAMES[0]][key]
 retained=traces_match and bound_delta>0
 return {'retainedGoodBlocklistObserved':retained,'newPollErrors':bound_delta,'aggregateNewPollErrors':delta[NAMES[0]],'counterScopeBound':True,'errorMetric':NAMES[0],'newPollCycles':delta[NAMES[1]],
         'inverseKnown404Reproduced':False,'healthyRollbackGuaranteed':False,'automaticDeploymentAllowed':False}
