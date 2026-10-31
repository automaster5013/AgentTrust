"""Failure-safe old Core return ordering; proofs remain synthetic and bounded."""
from collections import Counter
from stack_v18_transition_probe import MANAGEMENT



def pinned_legacy_management_unavailable(status, body):
    """Exact missing-route behavior of the pinned baseline, never API support."""
    assert type(status) is int and status == 500, 'LEGACY_MISSING_ROUTE_STATUS_CHANGED'
    assert body == {'code': 'REQUEST_UNAVAILABLE'}, 'LEGACY_MISSING_ROUTE_BODY_CHANGED'


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
