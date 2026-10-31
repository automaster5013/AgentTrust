"""Independent recalculation of public synthetic CI evidence; never a CD gate."""
import hashlib,json,pathlib,re
from stack_tempo_ci_release import load
from stack_tempo_poll_evidence import classify_inverse,counters,NAMES

def need(value):
 if not value:raise ValueError('Synthetic receipt refused')
def verify_output(directory):
 values={}
 for name in ('summary.json','synthetic-evidence.json'):
  path=pathlib.Path(directory)/name;need(path.is_file() and not path.is_symlink() and 0<path.stat().st_size<=4*1024*1024);values[name]=path.read_bytes()
 summary=json.loads(values['summary.json']);proof=json.loads(values['synthetic-evidence.json'])
 need(summary['kind']=='hosted-synthetic-tempo-warm-proof' and summary['completed'] is True and summary['syntheticWarmMetricProofVerified'] is True and summary['ownedFixtureCleaned'] is True)
 need(all(summary[k] is False for k in ('operatingTempoRecoveryVerified','operationalBackupVerified','fullStackRecoveryVerified','actualCDPerformed','automaticDeploymentAllowed')))
 need(hashlib.sha256(values['synthetic-evidence.json']).hexdigest()==summary['evidenceSha256'])
 harness=load('ci_receipt_identity','stack-tempo-ci-rehearsal.py')
 for source,expected in (('goldenFrames','before'),('recoveredFrames','after'),('inverseFrames','before')):need(harness.fingerprint(proof[source],proof['boundsStart'])==proof[expected])
 before=proof['before'];need(before==proof['after'] and set(before)=={format(i,'032x') for i in range(1,21)} and sum(row[1] for row in before.values())==133)
 need(all(re.fullmatch('[a-f0-9]{64}',row[0]) and type(row[1]) is int and row[1]>0 for row in before.values()));need(proof['coldLogs']['jsonErrors']>0 and proof['inverseLogs']['jsonErrors']>0)
 need(proof['identity']==proof['identityAfter'] and summary['candidateNeverRestarted'] is True and summary['effectivePollingSeconds']==300 and proof['coldTraceStatus']==404)
 samples=proof['recoverySamples']
 for item,raw in [(proof['negative'],proof['negativeRaw']),(proof['inverseBaseline'],proof['inverseBaselineRaw'])]+[(v['counters'],v['rawMetrics']) for v in samples+proof['inverseSamples']]:need(counters('\n'.join(raw['lines']))==item)
 classify_inverse(proof['negative'],samples[0]['counters'],True,'single-tenant')
 good=[s for s in samples if s['tracesMatched'] is True];need(len(good)>=2)
 for previous,current in zip(samples,samples[1:]):classify_inverse(previous['counters'],current['counters'],True,'single-tenant')
 need(good[0]['rawMetrics']['globalPollErrors']==good[-1]['rawMetrics']['globalPollErrors'])
 first,last=good[0]['counters'],good[-1]['counters'];need(first['totals'][NAMES[1]]>proof['negative']['totals'][NAMES[1]] and last['totals'][NAMES[1]]>first['totals'][NAMES[1]] and last['totals'][NAMES[0]]==first['totals'][NAMES[0]])
 rows=proof['inverseSamples'];need(rows and all(s['tracesMatched'] is True for s in rows))
 classify_inverse(last,proof['inverseBaseline'],True,'single-tenant');previous=proof['inverseBaseline']
 for row in rows:classify_inverse(previous,row['counters'],True,'single-tenant');previous=row['counters']
 result=classify_inverse(proof['inverseBaseline'],rows[-1]['counters'],True,'single-tenant');need(result['retainedGoodBlocklistObserved'] is True and result==proof['inverseResult'] and result['newPollErrors']==summary['newPollErrors'])
 bad=proof['badFiles'];need(len(bad)==8 and all(row['bytes']==0 and row['sha256']==hashlib.sha256(b'').hexdigest() for row in bad.values()) and summary['inverseFilesPreserved'] is True)
 return {'syntheticWarmMetricProofVerified':True,'matchingTraces':20,'matchingSpans':133,'newPollErrors':result['newPollErrors'],'actualCDPerformed':False}
