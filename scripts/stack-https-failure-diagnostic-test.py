import importlib.util,json,pathlib,unittest

spec = importlib.util.spec_from_file_location('https_failure_diagnostic', pathlib.Path(__file__).with_name('stack-https-failure-diagnostic.py'))
diagnostic = importlib.util.module_from_spec(spec); spec.loader.exec_module(diagnostic)
SHA = 'a' * 40


class DiagnosticPrivacyTest(unittest.TestCase):
    def fixture(self):
        return {'sourceRevision': SHA, 'completed': False,
            'phase': 'actual-federated-evaluation-approval-and-revocation', 'privateInputsPrinted': False,
            'errorType': 'RuntimeError', 'failedProcessExitCode': 1, 'sourceRuntimeUnchanged': True,
            'sourceBusinessTablesUnchanged': True, 'ownedContainersNetworkAndPrivateFilesRemoved': True,
            'protocolFailure': {'completed': False, 'code': 'SYNTHETIC_HTTPS_PROTOCOL_UNVERIFIED',
                'errorType': 'FixtureHttpRefused', 'failureLocations': [{'file': 'stack_https_fixture_pilot.py', 'line': 70}],
                'httpObservation': {'observedStatus': 503, 'expectedStatus': 200, 'endpointClass': 'run-detail'}}}

    def test_retains_discriminating_http_status_and_source_location(self):
        result = diagnostic.sanitize_summary(self.fixture(), SHA)
        self.assertEqual(result['protocolFailure']['httpObservation']['observedStatus'], 503)
        self.assertEqual(result['protocolFailure']['failureLocations'][0]['line'], 70)

    def test_unrelated_private_summary_fields_never_escape(self):
        value = self.fixture(); value['account'] = {'token': 'PRIVATE-CANARY'}
        self.assertNotIn('PRIVATE-CANARY', json.dumps(diagnostic.sanitize_summary(value, SHA)))

    def test_private_protocol_values_are_refused(self):
        for mutation in [{'token': 'PRIVATE-CANARY'}, {'failureLocations': [{'file': '../private.json', 'line': 1}]},
                         {'httpObservation': {'observedStatus': 503, 'expectedStatus': 200, 'endpointClass': 'PRIVATE-CANARY'}}]:
            value = self.fixture(); value['protocolFailure'].update(mutation)
            with self.assertRaises((ValueError, AssertionError)): diagnostic.sanitize_summary(value, SHA)

    def test_wrong_revision_success_or_different_stage_are_refused(self):
        for changes in [{'sourceRevision': 'b' * 40}, {'completed': True}, {'phase': 'completed'},
                        {'privateInputsPrinted': True}, {'failedProcessExitCode': True}]:
            value = self.fixture(); value.update(changes)
            with self.assertRaises((ValueError, AssertionError)): diagnostic.sanitize_summary(value, SHA)

    def test_callback_category_retains_only_fixed_enum(self):
        value = self.fixture(); value['callbackFailureCategory'] = 'NONCE'
        self.assertEqual('NONCE', diagnostic.sanitize_summary(value, SHA)['callbackFailureCategory'])
        for private in ['PRIVATE-CANARY', 'NONCE PRIVATE-CANARY', 'NONCE\n', '']:
            value['callbackFailureCategory'] = private
            with self.assertRaises((ValueError, AssertionError)): diagnostic.sanitize_summary(value, SHA)


if __name__ == '__main__': unittest.main()
