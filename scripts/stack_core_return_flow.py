"""Failure-safe old Core return ordering; proofs remain synthetic and bounded."""
from collections import Counter
import json
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
    identities = same_set; running = same_set; unpaused = same_set; healthy = same_set; issues = []
    for state in states:
        if state['Id'] not in expected: continue
        before = expected[state['Id']]
        image_same = state['Image'] == before[0]; start_same = state['State']['StartedAt'] == before[1]
        active = state['State']['Running'] is True; not_paused = state['State'].get('Paused') is False
        health = state['State'].get('Health', {}).get('Status', 'missing')
        identities = identities and image_same and start_same; running = running and active; unpaused = unpaused and not_paused; healthy = healthy and health == 'healthy'
        if not (image_same and start_same and active and not_paused and health == 'healthy'):
            name = state.get('Config', {}).get('Labels', {}).get('com.docker.compose.service')
            issues.append({'service': name if name in safe_names else 'unidentified-synthetic-service',
                           'imageUnchanged': image_same, 'startedAtUnchanged': start_same, 'running': active, 'unpaused': not_paused,
                           'health': health if health in ('healthy', 'unhealthy', 'starting', 'missing') else 'unknown'})
    return {'sameContainerSet': same_set, 'allImagesAndStartedAtUnchanged': identities,
            'allRunning': running, 'allUnpaused': unpaused, 'allHealthy': healthy, 'issues': issues}


INITIALIZERS = frozenset(('stack-migrate', 'stack-object-init', 'stack-observability-init'))


def initializer_identity(state):
    runtime = state['State']
    return (state['Image'], runtime['StartedAt'], runtime.get('FinishedAt'), runtime.get('Status'),
            runtime.get('ExitCode'), runtime.get('Running'), runtime.get('Paused'))


def initializer_status(expected, states):
    identifiers = [state['Id'] for state in states]
    same_set = len(identifiers) == len(set(identifiers)) and set(identifiers) == set(expected)
    identities = same_set; successful = same_set; issues = []
    for state in states:
        runtime = state['State']; unchanged = state['Id'] in expected and initializer_identity(state) == expected[state['Id']]
        exited = (runtime.get('Status') == 'exited' and runtime.get('Running') is False
                  and runtime.get('Paused') is False and type(runtime.get('ExitCode')) is int and runtime['ExitCode'] == 0)
        identities = identities and unchanged; successful = successful and exited
        if not (unchanged and exited):
            service = state.get('Config', {}).get('Labels', {}).get('com.docker.compose.service')
            issues.append({'service': service if service in INITIALIZERS else 'unidentified-synthetic-initializer',
                           'identityAndExitStateUnchanged': unchanged, 'successfullyExited': exited})
    return {'sameContainerSet': same_set, 'allIdentitiesAndExitStatesUnchanged': identities,
            'allSuccessfullyExited': successful, 'issues': issues}


def capture_non_core(command, core_id):
    # Include stopped containers and completed one-shot initializers. Full IDs
    # bind the listed set to inspect output; repeat enumeration after restoration.
    identifiers = command(['docker', 'ps', '-aq', '--no-trunc', '--filter', 'label=com.docker.compose.project=agenttrust']).decode().split()
    assert identifiers and len(identifiers) == len(set(identifiers))
    states = json.loads(command(['docker', 'inspect', *identifiers]))
    assert len(states) == len(identifiers) and {state['Id'] for state in states} == set(identifiers)
    assert sum(state['Id'] == core_id for state in states) == 1
    others = [state for state in states if state['Id'] != core_id]
    initializers = [state for state in others if state.get('Config', {}).get('Labels', {}).get('com.docker.compose.service') in INITIALIZERS]
    runtime = [state for state in others if state not in initializers]
    assert len(runtime) >= 10
    expected = {state['Id']: (state['Image'], state['State']['StartedAt']) for state in runtime}
    completed = {state['Id']: initializer_identity(state) for state in initializers}
    return expected, completed, runtime, initializers



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
