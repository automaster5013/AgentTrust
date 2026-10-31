"""Failure-safe old Core return ordering; proofs remain synthetic and bounded."""
from collections import Counter
from stack_v18_transition_probe import MANAGEMENT


def preserved(before, after, *, unchanged_management=False):
    assert before['ledger'] == after['ledger'], 'SCHEMA_LEDGER_CHANGED'
    assert set(before['tables']) == set(after['tables']), 'TABLE_SET_CHANGED'
    for table, rows in before['tables'].items():
        assert not (Counter(rows) - Counter(after['tables'][table])), 'EXISTING_ROWS_CHANGED'
        if unchanged_management and table in MANAGEMENT:
            assert Counter(rows) == Counter(after['tables'][table]), 'MANAGEMENT_ROWS_CHANGED'


def verify(switch, api, browser, capture):
    before = capture()
    assert MANAGEMENT <= before['tables'].keys()
    attempted = False
    try:
        attempted = True
        switch('previous')
        api('previous')
        browser()
        preserved(before, capture(), unchanged_management=True)
    finally:
        if attempted:
            switch('candidate')
    api('candidate')
    preserved(before, capture())
    return {'completed': True, 'previousCoreHttpSuiteVerified': True,
            'previousCoreBrowserSuiteVerified': True, 'candidateRestoredAndHttpVerified': True,
            'existingRowsAndRevocationsPreserved': True, 'schemaLedgerUnchanged': True,
            'allPossibleApiRoutesVerified': False, 'operatingRecoveryVerified': False,
            'actualDeploymentPerformed': False, 'automaticDeploymentAllowed': False,
            'healthyRollbackGuaranteed': False}
