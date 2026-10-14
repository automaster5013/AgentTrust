"""Bounded synthetic recovery-cohort and empirical latency contracts."""
import math
import uuid

COHORT_SIZE=20
CONCURRENCY=4
SAMPLES_PER_ROUTE=40
P95_TARGET_MILLIS=500


def identifier(value):
    if not isinstance(value,str) or str(uuid.UUID(value))!=value:
        raise ValueError('Invalid recovery load identifier')
    return value


def cohort(value):
    if not isinstance(value,dict) or set(value)!={'schemaVersion','cohortId','mode','records'}:
        raise ValueError('Invalid recovery load frame')
    if type(value['schemaVersion']) is not int or value['schemaVersion']!=1 or value['mode'] not in ('admit','verify'):
        raise ValueError('Invalid recovery load mode')
    identifier(value['cohortId'])
    if not isinstance(value['records'],list) or len(value['records'])!=(0 if value['mode']=='admit' else COHORT_SIZE):
        raise ValueError('Invalid recovery load cohort size')
    seen=set()
    for index,row in enumerate(value['records']):
        if not isinstance(row,dict) or set(row)!={'index','runId'} or type(row['index']) is not int or row['index']!=index:
            raise ValueError('Invalid recovery load ordering')
        run=identifier(row['runId'])
        if run in seen:raise ValueError('Duplicate recovery load run')
        seen.add(run)
    return value


def admission_key(cohort_id,index):
    identifier(cohort_id)
    if type(index) is not int or not 0<=index<COHORT_SIZE:
        raise ValueError('Invalid recovery load index')
    return 'recovery-load-'+cohort_id.replace('-','')+'-'+str(index)


def latency(values):
    if not isinstance(values,list) or len(values)!=SAMPLES_PER_ROUTE or any(type(v) not in (int,float) or not math.isfinite(v) or v<0 for v in values):
        raise ValueError('Invalid bounded latency samples')
    ordered=sorted(values)
    return {'samples':len(values),'p50Millis':ordered[math.ceil(len(values)*.50)-1],
            'p95Millis':ordered[math.ceil(len(values)*.95)-1],
            'maxMillis':ordered[-1],'samplesMillis':list(values)}
