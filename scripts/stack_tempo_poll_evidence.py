"""Distinguish failed warm polling from a successful repair; no Docker operations."""
import math,re

NAMES=('tempodb_blocklist_poll_errors_total','tempodb_blocklist_poll_duration_seconds_count')

def counters(text):
 if not isinstance(text,str) or len(text)>2097152:raise ValueError('Bounded metrics required')
 result={};seen=set()
 for line in text.splitlines():
  if not line or line.startswith('#'):continue
  match=re.fullmatch(r'([a-zA-Z_:][a-zA-Z0-9_:]*)(\{[^\n]*\})?\s+([^\s]+)(?:\s+\d+)?',line)
  if not match or match[1] not in NAMES:continue
  key=(match[1],match[2]);value=float(match[3])
  if key in seen or not math.isfinite(value) or value<0 or not value.is_integer():raise ValueError('Invalid counter evidence')
  seen.add(key);result[match[1]]=result.get(match[1],0)+int(value)
 if set(result)!=set(NAMES):raise ValueError('Incomplete polling metrics')
 return result

def classify_inverse(before,after,traces_match):
 if type(traces_match) is not bool or set(before)!=set(NAMES) or set(after)!=set(NAMES):raise ValueError('Incomplete inverse evidence')
 for snapshot in (before,after):
  if not all(type(value) is int and value>=0 for value in snapshot.values()):raise ValueError('Invalid inverse counters')
 delta={name:after[name]-before[name] for name in NAMES}
 if min(delta.values())<0:raise ValueError('Counter reset is inconclusive')
 retained=traces_match and delta[NAMES[0]]>0
 return {'retainedGoodBlocklistObserved':retained,'newPollErrors':delta[NAMES[0]],'newSuccessfulPolls':delta[NAMES[1]],
         'inverseKnown404Reproduced':False,'healthyRollbackGuaranteed':False,'automaticDeploymentAllowed':False}
