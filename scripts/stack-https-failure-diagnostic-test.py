import importlib.util,io,json,os,pathlib,unittest
from types import SimpleNamespace
from unittest.mock import patch

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

    def test_untrusted_error_text_never_enters_public_result(self):
        for error in ('PUBLIC-CANARY PRIVATE-TEXT', '../PUBLIC-CANARY', 'Error\nPUBLIC-CANARY', ''):
            value = self.fixture(); value['errorType'] = error
            with self.subTest(kind='unsafe-error'), self.assertRaises(ValueError):
                diagnostic.sanitize_summary(value, SHA)

    def test_optional_public_flags_and_exit_codes_have_exact_types(self):
        for changes in ({'sourceRuntimeUnchanged': 1}, {'sourceBusinessTablesUnchanged': 'PUBLIC-CANARY'},
                        {'ownedContainersNetworkAndPrivateFilesRemoved': []},
                        {'failedProcessExitCode': True}, {'failedProcessExitCode': 256}):
            value = self.fixture(); value.update(changes)
            with self.subTest(fields=list(changes)), self.assertRaises(ValueError):
                diagnostic.sanitize_summary(value, SHA)

    def test_invalid_run_anchor_is_refused_before_any_api_request(self):
        env = {'DIAGNOSTIC_REVISION': SHA, 'DIAGNOSTIC_RUN_ID': '../foreign', 'GH_TOKEN': 'PUBLIC-CANARY'}
        with patch.dict(os.environ, env), patch.object(pathlib.Path, 'read_text', return_value='MemAvailable: 67108864 kB'), \
                patch.object(diagnostic.shutil, 'disk_usage', return_value=SimpleNamespace(free=100 * 1024 ** 3)), \
                patch.object(diagnostic.urllib.request, 'urlopen') as request:
            with self.assertRaises(ValueError):
                diagnostic.main()
            request.assert_not_called()

    def test_foreign_run_is_refused_before_jobs_artifacts_or_redirect(self):
        env = {'DIAGNOSTIC_REVISION': SHA, 'DIAGNOSTIC_RUN_ID': '123', 'GH_TOKEN': 'PUBLIC-CANARY'}
        run = {'head_sha': SHA, 'head_branch': 'foreign', 'event': 'push',
               'path': '.github/workflows/original-stack.yml', 'status': 'completed', 'conclusion': 'failure'}
        with patch.dict(os.environ, env), patch.object(pathlib.Path, 'read_text', return_value='MemAvailable: 67108864 kB'), \
                patch.object(diagnostic.shutil, 'disk_usage', return_value=SimpleNamespace(free=100 * 1024 ** 3)), \
                patch.object(diagnostic.urllib.request, 'urlopen', return_value=io.BytesIO(json.dumps(run).encode())) as request, \
                patch.object(diagnostic.urllib.request, 'build_opener') as opener:
            with self.assertRaises(ValueError):
                diagnostic.main()
            self.assertEqual(request.call_count, 1)
            opener.assert_not_called()


if __name__ == '__main__': unittest.main()
