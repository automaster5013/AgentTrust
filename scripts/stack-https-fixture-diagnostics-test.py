import json
import unittest
from stack_https_fixture_diagnostics import public_probe_failure


class PublicFixtureFailureTest(unittest.TestCase):
    def frame(self):
        return {'completed': False, 'code': 'SYNTHETIC_HTTPS_PROTOCOL_UNVERIFIED', 'errorType': 'ValueError',
                'failureLocations': [{'file': 'stack_https_identity_client.py', 'line': 120}], 'httpObservation': None}

    def test_public_code_locations_are_retained(self):
        value = self.frame()
        self.assertEqual(public_probe_failure(json.dumps(value).encode()), value)
        value['httpObservation'] = {'observedStatus': 401, 'expectedStatus': 200, 'endpointClass': 'oidc-callback'}
        self.assertEqual(public_probe_failure(json.dumps(value).encode()), value)

    def test_private_or_ambiguous_fields_are_rejected(self):
        base = self.frame()
        variants = [dict(base, password='PUBLIC-CANARY'), dict(base, token='PUBLIC-CANARY'),
                    dict(base, message='PUBLIC-CANARY'), dict(base, errorType='Error:PUBLIC-CANARY'),
                    dict(base, failureLocations=[{'file': '../private.json', 'line': 2}]),
                    dict(base, failureLocations=[{'file': 'source.py', 'line': True}]),
                    dict(base, failureLocations=[]), dict(base, completed=True),
                    dict(base, httpObservation={'observedStatus': 401, 'expectedStatus': 200,
                                               'endpointClass': 'https://private.invalid/?token=PUBLIC-CANARY'})]
        for item in variants:
            with self.subTest(kind='unsafe-public-frame'), self.assertRaises(ValueError):
                public_probe_failure(json.dumps(item).encode())
        raw = json.dumps(base).encode()
        with self.assertRaises(ValueError):
            public_probe_failure(raw[:-1] + b',"errorType":"OtherError"}')
        with self.assertRaises(ValueError):
            public_probe_failure(b' ' * 16385)


if __name__ == '__main__':
    unittest.main()
