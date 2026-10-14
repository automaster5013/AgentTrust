"""Bounded synthetic recovery-cohort and empirical latency contracts."""
import math
import uuid
import datetime
import re

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


def version_ids(rows):
    if not isinstance(rows,list) or not 1<=len(rows)<=50:
        raise ValueError('Invalid bounded version catalog')
    ids=[]
    for row in rows:
        if not isinstance(row,dict) or set(row)!={'id','resource_key','version','content_sha256','created_at'}:
            raise ValueError('Invalid version summary projection')
        key=row['resource_key'];sha=row['content_sha256'];created=row['created_at']
        if (not isinstance(key,str) or not re.fullmatch('[a-z][a-z0-9-]{2,63}',key)
                or type(row['version']) is not int or not 1<=row['version']<=1000000
                or not isinstance(sha,str) or not re.fullmatch('[a-f0-9]{64}',sha)
                or not isinstance(created,str) or len(created)>50
                or datetime.datetime.fromisoformat(created).tzinfo is None):
            raise ValueError('Invalid version summary fields')
        ids.append(identifier(row['id']))
    if len(set(ids))!=len(ids):raise ValueError('Duplicate version summary')
    return ids


def catalog_baseline(rows,details,owner):
    ids=version_ids(rows)
    if not isinstance(details,dict) or set(details)!=set(ids):
        raise ValueError('Incomplete scoped catalog detail baseline')
    for row in rows:
        detail=details[row['id']]
        if (not isinstance(detail,dict) or detail.get('organization_id')!=owner['organizationId']
                or detail.get('project_id')!=owner['projectId']
                or any(detail.get(key)!=value for key,value in row.items() if key!='created_at')
                or not same_catalog_timestamp(row['created_at'],detail.get('created_at'))):
            raise ValueError('Catalog detail scope or immutable summary mismatch')
    return [dict(row) for row in rows]


def same_catalog_timestamp(summary,detail):
    # JDBC list timestamps serialize at milliseconds; immutable detail uses Instant
    # and retains microseconds. Bind the detail to that exact millisecond bucket,
    # never round into a neighbouring bucket or discard precision when both have it.
    try:
        if not isinstance(detail,str) or len(detail)>50:return False
        left=datetime.datetime.fromisoformat(summary);right=datetime.datetime.fromisoformat(detail)
        if left.tzinfo is None or right.tzinfo is None:return False
        delta=right-left
        return delta==datetime.timedelta(0) or left.microsecond%1000==0 and datetime.timedelta(0)<=delta<datetime.timedelta(milliseconds=1)
    except (TypeError,ValueError):return False
