"""Failure-safe old Core return ordering; proofs remain synthetic and bounded."""
from collections import Counter
from stack_v18_transition_probe import MANAGEMENT



def pinned_legacy_management_unavailable(status, body):
    """Exact missing-route behavior of the pinned baseline, never API support."""
    assert type(status) is int and status == 500, 'LEGACY_MISSING_ROUTE_STATUS_CHANGED'
    assert body == {'code': 'REQUEST_UNAVAILABLE'}, 'LEGACY_MISSING_ROUTE_BODY_CHANGED'



def non_core_status(expected, states):
    """Safe dimensions only: never publish container/image IDs or timestamps."""
    safe_names = {'stack-db', 'stack-redis', 'stack-policy', 'stack-ai-worker', 'stack-console',
                  'stack-nats', 'stack-identity', 'stack-gateway', 'stack-object-store', 'stack-otel',
                  'stack-tempo', 'stack-loki', 'stack-prometheus', 'stack-grafana', 'stack-quality-verifier'}
    identifiers = [state['Id'] for state in states]
    same_set = len(identifiers) == len(set(identifiers)) and set(identifiers) == set(expected)
    identities = same_set; running = same_set; healthy = same_set; issues = []
    for state in states:
        if state['Id'] not in expected: continue
        before = expected[state['Id']]
        image_same = state['Image'] == before[0]; start_same = state['State']['StartedAt'] == before[1]
        active = state['State']['Running'] is True
        health = state['State'].get('Health', {}).get('Status', 'missing')
        identities = identities and image_same and start_same; running = running and active; healthy = healthy and health == 'healthy'
        if not (image_same and start_same and active and health == 'healthy'):
            name = state.get('Config', {}).get('Labels', {}).get('com.docker.compose.service')
            issues.append({'service': name if name in safe_names else 'unidentified-synthetic-service',
                           'imageUnchanged': image_same, 'startedAtUnchanged': start_same, 'running': active,
                           'health': health if health in ('healthy', 'unhealthy', 'starting', 'missing') else 'unknown'})
    return {'sameContainerSet': same_set, 'allImagesAndStartedAtUnchanged': identities,
            'allRunning': running, 'allHealthy': healthy, 'issues': issues}


def preserved(before, after, *, unchanged_management=False):
    assert before['ledger'] == after['ledger'], 'SCHEMA_LEDGER_CHANGED'
    assert set(before['tables']) == set(after['tables']), 'TABLE_SET_CHANGED'
    for table, rows in before['tables'].items():
        assert not (Counter(rows) - Counter(after['tables'][table])), 'EXISTING_ROWS_CHANGED'
        if unchanged_management and table in MANAGEMENT:
            assert Counter(rows) == Counter(after['tables'][table]), 'MANAGEMENT_ROWS_CHANGED'


def verify(switch, api, browser, capture, *, recovery=None):
    before = capture()
    assert MANAGEMENT <= before['tables'].keys()
    attempted = False
    try:
        attempted = True
        switch('previous')
        api('previous')
        browser()
        preserved(before, capture(), unchanged_management=True)
    except Exception as error:
        if recovery is not None:
            recovery['previousAttemptFailureType'] = type(error).__name__
            recovery['previousAttemptFailureStage'] = recovery.get('stage', 'previous-attempt')
        raise
    finally:
        if attempted:
            switch('candidate')
            api('candidate')
            if recovery is not None: recovery['candidateHttpVerified'] = True
            preserved(before, capture())
            if recovery is not None: recovery['candidateRowsPreserved'] = True
    return {'completed': True, 'previousCoreHttpSuiteVerified': True,
            'previousCoreBrowserSuiteVerified': True, 'candidateRestoredAndHttpVerified': True,
            'previousManagementApiSupported': False, 'previousManagementApiCompatibilityVerified': False,
            'existingRowsAndRevocationsPreserved': True, 'schemaLedgerUnchanged': True,
            'allPossibleApiRoutesVerified': False, 'operatingRecoveryVerified': False,
            'actualDeploymentPerformed': False, 'automaticDeploymentAllowed': False,
            'healthyRollbackGuaranteed': False}
