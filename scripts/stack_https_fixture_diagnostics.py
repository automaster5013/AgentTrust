"""Accept only the fixed, private-value-free failure frame from the owned probe."""
import json
import re


ENDPOINT_CLASSES = frozenset(('console-home', 'oidc-callback', 'idp-authorization',
    'idp-login', 'idp-logout', 'identity', 'csrf', 'logout', 'run-detail', 'run-list-or-write',
    'fixture-admin-auth', 'fixture-mapper', 'fixture-admin-config', 'other-fixed-fixture-path'))


class FixtureHttpRefused(ValueError):
    def __init__(self, observed, expected, endpoint_class):
        self.observation = {'observedStatus': observed, 'expectedStatus': expected,
                            'endpointClass': endpoint_class}
        super().__init__('SYNTHETIC_HTTPS_HTTP_REFUSED')


def bounded_frame(raw):
    if not isinstance(raw, bytes) or not 0 < len(raw) <= 16384:
        raise ValueError('SYNTHETIC_HTTPS_FAILURE_FRAME_REFUSED')
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError('SYNTHETIC_HTTPS_FAILURE_FRAME_REFUSED')
            result[key] = value
        return result
    return json.loads(raw.decode('utf-8'), object_pairs_hook=pairs)


def public_probe_failure(raw):
    value = bounded_frame(raw)
    if not isinstance(value, dict) or set(value) != {'completed', 'code', 'errorType', 'failureLocations', 'httpObservation'}:
        raise ValueError('SYNTHETIC_HTTPS_FAILURE_FRAME_REFUSED')
    if value['completed'] is not False or value['code'] != 'SYNTHETIC_HTTPS_PROTOCOL_UNVERIFIED':
        raise ValueError('SYNTHETIC_HTTPS_FAILURE_FRAME_REFUSED')
    if not isinstance(value['errorType'], str) or not re.fullmatch('[A-Za-z][A-Za-z0-9]{0,63}', value['errorType']):
        raise ValueError('SYNTHETIC_HTTPS_FAILURE_FRAME_REFUSED')
    if not isinstance(value['failureLocations'], list) or not 1 <= len(value['failureLocations']) <= 12:
        raise ValueError('SYNTHETIC_HTTPS_FAILURE_FRAME_REFUSED')
    for row in value['failureLocations']:
        if (not isinstance(row, dict) or set(row) != {'file', 'line'}
                or not isinstance(row['file'], str) or not re.fullmatch(r'[A-Za-z0-9_.-]{1,80}\.py', row['file'])
                or type(row['line']) is not int or not 1 <= row['line'] <= 20000):
            raise ValueError('SYNTHETIC_HTTPS_FAILURE_FRAME_REFUSED')
    observation = value['httpObservation']
    if observation is not None:
        if (not isinstance(observation, dict) or set(observation) != {'observedStatus', 'expectedStatus', 'endpointClass'}
                or any(type(observation[key]) is not int or not 100 <= observation[key] <= 599
                       for key in ('observedStatus', 'expectedStatus'))
                or not isinstance(observation['endpointClass'], str) or observation['endpointClass'] not in ENDPOINT_CLASSES):
            raise ValueError('SYNTHETIC_HTTPS_FAILURE_FRAME_REFUSED')
    return value


BROWSER_PHASES = frozenset(('execution-guard', 'untrusted-ca-negative-control',
    'trusted-browser-and-hostname-negative-control', 'actual-browser-native-login',
    'actual-browser-enterprise-login', 'actual-browser-scope-and-viewer-control',
    'actual-browser-logout', 'actual-browser-unlinked-enterprise-refusal',
    'unlinked-external-session-cleanup'))
BROWSER_SUCCESS = {'completed': True, 'actualChromiumTlsLoginVerified': True,
    'nativeAccountsVerified': 4, 'linkedEnterpriseBrowserLogins': 4,
    'unlinkedEnterpriseBrowserLoginRefused': True, 'certificateVerificationDisabled': False,
    'untrustedCaAndWrongHostRefused': True, 'outsideFixtureNavigationBlockedBeforeNetwork': True,
    'allEightApplicationSessionsLoggedOut': True, 'hostTrustStoreChanged': False,
    'enterpriseBrowserVerified': True, 'productionDeploymentPerformed': False}


def public_browser_result(raw):
    value = bounded_frame(raw)
    require_keys = {'completed', 'code', 'phase', 'caseIndex', 'errorType', 'failureLines'}
    if isinstance(value, dict) and value.get('completed') is True:
        if (set(value) != set(BROWSER_SUCCESS)
                or any(type(value[k]) is not type(expected) or value[k] != expected
                       for k, expected in BROWSER_SUCCESS.items())):
            raise ValueError('SYNTHETIC_HTTPS_BROWSER_FRAME_REFUSED')
        return value
    if (not isinstance(value, dict) or set(value) != require_keys
            or value['completed'] is not False or value['code'] != 'SYNTHETIC_HTTPS_BROWSER_UNVERIFIED'
            or not isinstance(value['phase'], str) or value['phase'] not in BROWSER_PHASES
            or value['errorType'] not in ('Error', 'TimeoutError')
            or type(value['caseIndex']) is not int or not 0 <= value['caseIndex'] <= 9
            or not isinstance(value['failureLines'], list) or len(value['failureLines']) > 8
            or any(type(line) is not int or not 1 <= line <= 20000 for line in value['failureLines'])):
        raise ValueError('SYNTHETIC_HTTPS_BROWSER_FRAME_REFUSED')
    return value
