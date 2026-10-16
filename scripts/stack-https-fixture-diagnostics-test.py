import json
import pathlib
import subprocess
import unittest
from stack_https_fixture_diagnostics import public_probe_failure, public_browser_result, BROWSER_SUCCESS


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

    def test_browser_results_cannot_publish_private_fields_or_weaken_checks(self):
        self.assertEqual(public_browser_result(json.dumps(BROWSER_SUCCESS).encode()), BROWSER_SUCCESS)
        variants = [dict(BROWSER_SUCCESS, certificateVerificationDisabled=True),
                    dict(BROWSER_SUCCESS, nativeAccountsVerified=True),
                    dict(BROWSER_SUCCESS, enterpriseBrowserVerified=False),
                    dict(BROWSER_SUCCESS, cookies='PUBLIC-CANARY'),
                    dict(BROWSER_SUCCESS, hostTrustStoreChanged=True)]
        base = {'completed': False, 'code': 'SYNTHETIC_HTTPS_BROWSER_UNVERIFIED', 'phase': 'actual-browser-native-login',
                'caseIndex': 1, 'errorType': 'TimeoutError', 'failureLines': [14, 85]}
        self.assertEqual(public_browser_result(json.dumps(base).encode()), base)
        variants += [dict(base, message='PUBLIC-CANARY'), dict(base, failureLines=['PUBLIC-CANARY']),
                     dict(base, phase='https://private.invalid/?token=PUBLIC-CANARY'), dict(base, caseIndex=True)]
        for value in variants:
            with self.subTest(kind='unsafe-browser-frame'), self.assertRaises(ValueError):
                public_browser_result(json.dumps(value).encode())

    def test_real_browser_helper_refuses_before_any_fixture_input_without_arguments(self):
        script = pathlib.Path(__file__).parent / 'stack_https_fixture_browser.mjs'
        result = subprocess.run(['node', str(script)], capture_output=True, timeout=20)
        self.assertEqual(result.returncode, 1)
        frame = public_browser_result(result.stdout)
        self.assertEqual(frame['phase'], 'execution-guard')
        self.assertEqual(frame['caseIndex'], 0)


if __name__ == '__main__':
    unittest.main()
