"""Synthetic public browser diagnostic frames; no real artifacts or network access."""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import unittest
import zipfile
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('browser_diagnostic',
    Path(__file__).with_name('stack-infrastructure-browser-diagnostic.py'))
diagnostic = importlib.util.module_from_spec(spec)
spec.loader.exec_module(diagnostic)
FLAGS = ('jsonParse', 'responseBodyUnavailable', 'responseWaitTimeout', 'actionTimeout',
         'closedContext', 'abortedRequest', 'disabledElement', 'detachedElement', 'testTimeout', 'strictLocator')


class BrowserDiagnosticPrivacyTest(unittest.TestCase):
    def fixture(self):
        return {'completed': False, 'credentialsRecorded': False, 'headlessFunctionalTests': True,
            'tests': [{'status': 'failed', 'failureCategory': 'test-timeout', 'sourceLine': '12',
                'phases': ['synthetic-step'],
                'failureDetails': [{'errorKind': 'TimeoutError', **{k: False for k in FLAGS}}],
                'networkDetails': [{'kind': 'identity-bootstrap', 'event': 'response', 'status': 503,
                    'failure': 'timeout', 'timing': {'requestStart': 1.5, 'responseEnd': 2.5}}]}]}

    def test_fixed_classifications_and_numeric_timing_are_preserved(self):
        result = diagnostic.sanitize_reports([self.fixture()])[0]
        self.assertIs(result['completed'], False)
        self.assertEqual(result['testCount'], 1)
        self.assertEqual(result['failedTests'][0]['sourceLine'], 12)
        self.assertEqual(result['failedTests'][0]['networkDetails'][0]['status'], 503)

    def test_completed_is_an_exact_boolean_not_a_private_payload_channel(self):
        for value in ({'private': 'PUBLIC-CANARY'}, 'PUBLIC-CANARY', 1, None):
            frame = self.fixture(); frame['completed'] = value
            with self.subTest(kind=type(value).__name__), self.assertRaises(ValueError):
                diagnostic.sanitize_reports([frame])

    def test_unrelated_private_fields_and_unknown_timings_are_not_exported(self):
        frame = self.fixture(); frame['account'] = 'PUBLIC-CANARY'
        test = frame['tests'][0]; test['title'] = 'PUBLIC-CANARY'
        test['failureDetails'][0]['rawMessage'] = 'PUBLIC-CANARY'
        test['networkDetails'][0]['url'] = 'PUBLIC-CANARY'
        test['networkDetails'][0]['timing'].update(private='PUBLIC-CANARY', requestStart='PUBLIC-CANARY')
        self.assertNotIn('PUBLIC-CANARY', json.dumps(diagnostic.sanitize_reports([frame])))

    def test_test_status_category_line_and_failure_flags_are_strict(self):
        mutations = [lambda f: f['tests'][0].update(status='PUBLIC-CANARY'),
            lambda f: f['tests'][0].update(failureCategory='PUBLIC-CANARY'),
            lambda f: f['tests'][0].update(sourceLine='PUBLIC-CANARY'),
            lambda f: f['tests'][0]['failureDetails'][0].update(errorKind='PUBLIC-CANARY'),
            lambda f: f['tests'][0]['failureDetails'][0].update(jsonParse=1)]
        for mutate in mutations:
            frame = self.fixture(); mutate(frame)
            with self.assertRaises(ValueError): diagnostic.sanitize_reports([frame])

    def test_network_enums_and_status_cannot_export_private_values(self):
        for key, value in (('kind', 'PUBLIC-CANARY'), ('event', 'PUBLIC-CANARY'),
                           ('failure', 'PUBLIC-CANARY'), ('status', True), ('status', 'PUBLIC-CANARY')):
            frame = self.fixture(); frame['tests'][0]['networkDetails'][0][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError): diagnostic.sanitize_reports([frame])

    def test_private_or_unbounded_report_frames_are_refused(self):
        for mutation in ({'credentialsRecorded': True}, {'headlessFunctionalTests': False},
                         {'tests': 'PUBLIC-CANARY'}, {'tests': [{}] * 129}):
            frame = self.fixture(); frame.update(mutation)
            with self.assertRaises(ValueError): diagnostic.sanitize_reports([frame])
        with self.assertRaises(ValueError): diagnostic.sanitize_reports([])

    def test_passed_test_raw_details_are_not_exported(self):
        frame = self.fixture(); frame['tests'][0].update(status='passed', rawError='PUBLIC-CANARY')
        result = diagnostic.sanitize_reports([frame])
        self.assertEqual(result[0]['failedTests'], [])
        self.assertNotIn('PUBLIC-CANARY', json.dumps(result))

    def test_foreign_run_refused_before_artifact_or_redirect_access(self):
        run = {'head_sha': 'a' * 40, 'head_branch': 'foreign', 'event': 'push',
            'path': '.github/workflows/original-stack.yml', 'status': 'completed'}
        with patch.object(diagnostic, 'admit'), patch.dict(os.environ,
                {'DIAGNOSTIC_REVISION': 'a' * 40, 'DIAGNOSTIC_RUN_ID': '123', 'GH_TOKEN': 'PUBLIC-CANARY'}), \
                patch.object(diagnostic.urllib.request, 'urlopen', return_value=io.BytesIO(json.dumps(run).encode())) as request, \
                patch.object(diagnostic.urllib.request, 'build_opener') as opener:
            with self.assertRaises(ValueError): diagnostic.main()
            self.assertEqual(request.call_count, 1)
            opener.assert_not_called()

    def test_complete_main_path_authenticates_mocked_zip_and_emits_only_sanitized_reports(self):
        revision = 'a' * 40
        data = io.BytesIO()
        frame = self.fixture(); frame['account'] = 'PUBLIC-CANARY'
        with zipfile.ZipFile(data, 'w') as archive:
            archive.writestr('stack-browser-11111111-1111-4111-8111-111111111111.json', json.dumps(frame))
        raw = data.getvalue()
        run = {'head_sha': revision, 'head_branch': 'main', 'event': 'push',
            'path': '.github/workflows/original-stack.yml', 'status': 'completed'}
        artifact = {'id': 1, 'name': 'original-stack-registry-diagnostics-' + revision,
            'expired': False, 'size_in_bytes': len(raw), 'digest': 'sha256:' + hashlib.sha256(raw).hexdigest()}
        def get(request, **kwargs):
            return io.BytesIO(json.dumps({'artifacts': [artifact]} if request.full_url.endswith('/artifacts') else run).encode())
        output = io.StringIO()
        with patch.object(diagnostic, 'admit'), patch.dict(os.environ,
                {'DIAGNOSTIC_REVISION': revision, 'DIAGNOSTIC_RUN_ID': '123', 'GH_TOKEN': 'PUBLIC-CANARY'}), \
                patch.object(diagnostic.urllib.request, 'urlopen', side_effect=get), \
                patch.object(diagnostic.urllib.request, 'build_opener') as factory, contextlib.redirect_stdout(output):
            factory.return_value.open.return_value = io.BytesIO(raw)
            diagnostic.main()
        result = json.loads(output.getvalue())
        self.assertTrue(result['archiveDigestVerified'])
        self.assertEqual(result['reports'], diagnostic.sanitize_reports([frame]))
        self.assertNotIn('PUBLIC-CANARY', output.getvalue())


if __name__ == '__main__':
    unittest.main()
