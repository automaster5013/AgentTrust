"""Synthetic cohort and measured HTTP latency inside a disposable recovery network."""
import concurrent.futures
import json
import pathlib
import time
from stack_recovery_load_contract import (COHORT_SIZE,CONCURRENCY,SAMPLES_PER_ROUTE,
                                          P95_TARGET_MILLIS,admission_key,cohort,identifier,latency)
from stack_recovery_transport import fixture_opener
from stack_test_client import StackClient,FixedRedirects


def require(condition):
    if not condition:raise ValueError('RECOVERY_LOAD_ACCEPTANCE_REFUSED')


def main():
    value=cohort(json.loads(pathlib.Path('/load-probe-input.json').read_bytes()))
    credentials=json.loads(pathlib.Path('/credentials.json').read_bytes())
    report={'completed':False,'mode':value['mode'],'paidProviderCallsPerformed':False,
            'sourceNetworkAccessed':False,'productionDeploymentPerformed':False,
            'synthetic':True,'productionSloVerified':False,'checks':[]}
    client=StackClient('http://127.0.0.1:4320',credentials,{})
    client.opener=fixture_opener(client.jar,FixedRedirects())
    try:
        owner=client.login('demo-admin');body={'scenario':'pass','requiresApproval':False}
        if value['mode']=='admit':
            def admit(index):
                record=client.request('runs','POST',body,{'Idempotency-Key':admission_key(value['cohortId'],index)})
                require(record['state']=='queued' and record['provider']=='synthetic')
                return {'index':index,'runId':identifier(record['id'])}
            with concurrent.futures.ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
                records=list(pool.map(admit,range(COHORT_SIZE)))
            cohort({**value,'mode':'verify','records':records})
            report.update(records=records,admissions=COHORT_SIZE,admissionHttpConcurrency=CONCURRENCY)
            report['checks'].append('twenty distinct synthetic admissions queued while the owned restored worker is stopped')
        else:
            for row in value['records']:
                record=client.request('runs/'+row['runId'])
                require(record['organization_id']==owner['organizationId'] and record['project_id']==owner['projectId']
                        and record['provider']=='synthetic' and record['state']=='succeeded' and record['decision']=='pass'
                        and record['result']['executionEngine']=='python-synthetic')
                gate=client.request('runs/'+row['runId']+'/gate')
                require(gate['deploymentAllowed'] is True and gate['policyStatus']=='evaluated')
                replay=client.request('runs','POST',body,{'Idempotency-Key':admission_key(value['cohortId'],row['index'])})
                require(replay['id']==row['runId'])
            report['checks'].append('all twenty recovered Python completions pass OPA and original idempotency-key replay retains exactly the same run IDs')
            # Respect the real project quota; no Redis mutations or quota overrides.
            time.sleep(60);time.sleep(2)
            report['naturalQuotaWindowBeforeMetadata']=True
            routes=[('identity','me'),('run-detail','runs/'+value['records'][0]['runId']),('agent-versions','versions/agents'),('provider-usage','provider-usage')]
            def checked(label,path):
                started=time.perf_counter();response=client.request(path);elapsed=(time.perf_counter()-started)*1000
                if label in ('identity','provider-usage'):
                    require(response['organizationId']==owner['organizationId'] and response['projectId']==owner['projectId'])
                elif label=='run-detail':
                    require(response['id']==value['records'][0]['runId'] and response['organization_id']==owner['organizationId'] and response['project_id']==owner['projectId'])
                else:
                    require(isinstance(response,list) and all(row['organization_id']==owner['organizationId'] and row['project_id']==owner['projectId'] for row in response))
                return elapsed
            metrics=[]
            for label,path in routes:
                for _ in range(4):checked(label,path)
                with concurrent.futures.ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
                    values=list(pool.map(lambda _:checked(label,path),range(SAMPLES_PER_ROUTE)))
                metrics.append({'route':label,'httpConcurrency':CONCURRENCY,'httpSuccessResponses':SAMPLES_PER_ROUTE,**latency(values)})
            report.update(completedEvaluations=COHORT_SIZE,metadata=metrics,metadataP95TargetMillis=P95_TARGET_MILLIS,
                          metadataTargetPassed=all(row['p95Millis']<=P95_TARGET_MILLIS for row in metrics),
                          warmupRequestsExcludedFromLatency=16,measuredRequests=4*SAMPLES_PER_ROUTE,
                          latencyScope='separate post-recovery synthetic metadata phase; no model inference or production target')
            require(report['metadataTargetPassed'])
            report['checks'].append('all 160 measured metadata requests succeed at concurrency four, retain scope, and meet the empirical 500ms p95 target on each of four routes')
        report['completed']=True
    except Exception as error:report.update(errorType=type(error).__name__,code='RECOVERY_LOAD_UNVERIFIED')
    finally:
        closed=True
        try:client.logout()
        except Exception:closed=False
        report['ownSessionClosed']=closed and not client.logged
    print(json.dumps(report));return 0 if report['completed'] and report['ownSessionClosed'] else 1


if __name__=='__main__':raise SystemExit(main())
