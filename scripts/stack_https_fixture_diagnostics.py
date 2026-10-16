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


def public_probe_failure(raw):
    if not isinstance(raw, bytes) or not 0 < len(raw) <= 16384:
        raise ValueError('SYNTHETIC_HTTPS_FAILURE_FRAME_REFUSED')
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError('SYNTHETIC_HTTPS_FAILURE_FRAME_REFUSED')
            result[key] = value
        return result
    value = json.loads(raw.decode('utf-8'), object_pairs_hook=pairs)
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
                or observation['endpointClass'] not in ENDPOINT_CLASSES):
            raise ValueError('SYNTHETIC_HTTPS_FAILURE_FRAME_REFUSED')
    return value
