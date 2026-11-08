import copy
import json
import importlib.util
import sqlite3
import pathlib
import types
import unittest
from unittest.mock import patch
import stack_ci_return_guard as guard
from stack_core_return_flow import INITIALIZERS, capture_non_core, initializer_status, non_core_status, pinned_legacy_management_unavailable, preserved, verify


class FlowTest(unittest.TestCase):
    def fixture(self, fail=None, recovery=None):
        state = {'ledger': 'ledger-v18', 'tables': {
            'stack_runs': ['historical-run'], 'stack_project_settings': ['settings'],
            'stack_access_keys': ['key'], 'stack_access_key_revocations': ['revoked']}}
        events = []
        def switch(mode):
            events.append('switch-' + mode)
            if fail == 'switch-' + mode: raise RuntimeError('SWITCH_FAILED')
        def api(mode):
            events.append('api-' + mode)
            state['tables']['stack_runs'].append('new-' + mode)
            if fail == 'api-' + mode: raise RuntimeError('API_FAILED')
        def browser():
            events.append('browser')
            if fail == 'browser': raise RuntimeError('BROWSER_FAILED')
            if fail == 'revocation-loss': state['tables']['stack_access_key_revocations'].clear()
            if fail == 'ledger-drift': state['ledger'] = 'changed'
        return events, lambda: verify(switch, api, browser, lambda: copy.deepcopy(state), recovery=recovery)

    def test_real_control_flow_requires_previous_http_browser_and_candidate_http(self):
        events, run = self.fixture(); result = run()
        self.assertEqual(events, ['switch-previous', 'api-previous', 'browser', 'switch-candidate', 'api-candidate'])
        self.assertTrue(result['completed'])
        for flag in ('allPossibleApiRoutesVerified', 'operatingRecoveryVerified', 'actualDeploymentPerformed',
                     'automaticDeploymentAllowed', 'healthyRollbackGuaranteed'):
            self.assertIs(result[flag], False)

    def test_failed_or_partial_previous_switch_still_restores_candidate(self):
        for fault in ('switch-previous', 'api-previous', 'browser'):
            events, run = self.fixture(fault)
            with self.subTest(fault=fault), self.assertRaises(RuntimeError): run()
            self.assertEqual(events[-2:], ['switch-candidate', 'api-candidate'])

    def test_schema_or_revocation_loss_is_not_healthy_return(self):
        for fault in ('ledger-drift', 'revocation-loss'):
            events, run = self.fixture(fault)
            with self.subTest(fault=fault), self.assertRaises(ValueError): run()
            self.assertEqual(events[-2:], ['switch-candidate', 'api-candidate'])

    def test_candidate_restore_failure_never_reports_success(self):
        events, run = self.fixture('switch-candidate')
        with self.assertRaises(RuntimeError): run()
        self.assertNotIn('api-candidate', events)

    def test_candidate_api_failure_after_restore_is_incomplete(self):
        events, run = self.fixture('api-candidate')
        with self.assertRaises(RuntimeError): run()
        self.assertEqual(events[-2:], ['switch-candidate', 'api-candidate'])

    def test_fingerprints_allow_new_business_rows_but_not_replaced_or_deleted_rows(self):
        before = {'ledger': 'same', 'tables': {'stack_runs': ['a', 'a']}}
        preserved(before, {'ledger': 'same', 'tables': {'stack_runs': ['a', 'a', 'b']}})
        with self.assertRaises(ValueError):
            preserved(before, {'ledger': 'same', 'tables': {'stack_runs': ['a', 'b']}})

    def test_previous_failure_stays_failed_after_verified_candidate_recovery(self):
        report = {'stage': 'previous-http'}
        events, run = self.fixture('api-previous', recovery=report)
        with self.assertRaises(RuntimeError): run()
        self.assertEqual(events[-2:], ['switch-candidate', 'api-candidate'])
        self.assertEqual(report['previousAttemptFailureType'], 'RuntimeError')
        self.assertEqual(report['previousAttemptFailureStage'], 'previous-http')
        self.assertTrue(report['candidateHttpVerified'])
        self.assertTrue(report['candidateRowsPreserved'])
        self.assertNotIn('completed', report)

    def test_recovery_never_reports_preservation_after_candidate_http_or_data_failure(self):
        for fault in ('api-candidate', 'revocation-loss', 'ledger-drift'):
            report = {}
            _, run = self.fixture(fault, recovery=report)
            with self.subTest(fault=fault), self.assertRaises((RuntimeError, ValueError)): run()
            self.assertNotIn('candidateRowsPreserved', report)
            if fault == 'api-candidate': self.assertNotIn('candidateHttpVerified', report)

    def test_pinned_missing_management_route_requires_exact_error_not_arbitrary_unavailability(self):
        pinned_legacy_management_unavailable(500, {'code': 'REQUEST_UNAVAILABLE'})
        for status, body in [(404, {'code': 'REQUEST_UNAVAILABLE'}),
                             (200, {'code': 'REQUEST_UNAVAILABLE'}),
                             (503, {'code': 'STORAGE_UNAVAILABLE'}),
                             (500, {'code': 'OTHER_FAILURE'}),
                             (500, {'code': 'REQUEST_UNAVAILABLE', 'deploymentAuthority': True})]:
            with self.subTest(status=status, body=body), self.assertRaises(ValueError):
                pinned_legacy_management_unavailable(status, body)

    def capture_fixture(self, stopped=False, initializers=False, extra=False):
        states = [{'Id': format(i, '064x'), 'Image': 'synthetic-image-' + str(i),
                   'State': {'StartedAt': 'synthetic-start', 'Running': not (stopped and i == 11),
                             'Paused': False, 'Health': {'Status': 'healthy'}},
                   'Config': {'Labels': {'com.docker.compose.service': 'stack-db'}}} for i in range(12)]
        if initializers:
            for i, service in enumerate(sorted(INITIALIZERS), start=100):
                states.append({'Id': format(i, '064x'), 'Image': 'synthetic-initializer-image',
                    'State': {'StartedAt': 'synthetic-start', 'FinishedAt': 'synthetic-finish', 'Status': 'exited',
                              'ExitCode': 0, 'Running': False, 'Paused': False},
                    'Config': {'Labels': {'com.docker.compose.service': service}}})
        if extra:
            state = copy.deepcopy(states[1]); state['Id'] = format(999, '064x'); states.append(state)
        def command(args):
            if args[:2] == ['docker', 'ps']:
                assert args[-2:] == ['--filter', 'label=com.docker.compose.project=agenttrust']
                selected = states if '-aq' in args else [state for state in states if state['State']['Running']]
                return ('\n'.join(state['Id'] if '--no-trunc' in args else state['Id'][:12] for state in selected)).encode()
            assert args[:2] == ['docker', 'inspect']
            return json.dumps([state for state in states if state['Id'] in args[2:]]).encode()
        return command

    def test_non_core_capture_preserves_complete_healthy_inventory(self):
        expected, _, states, _ = capture_non_core(self.capture_fixture(), format(0, '064x'))
        status = non_core_status(expected, states)
        self.assertEqual(len(expected), 11)
        self.assertTrue(all(status[key] is True for key in ('sameContainerSet', 'allImagesAndStartedAtUnchanged', 'allRunning', 'allUnpaused', 'allHealthy')))
        self.assertEqual(status['issues'], [])

    def test_non_core_capture_never_omits_an_already_stopped_project_container(self):
        expected, _, states, _ = capture_non_core(self.capture_fixture(stopped=True), format(0, '064x'))
        status = non_core_status(expected, states)
        self.assertIn(format(11, '064x'), expected)
        self.assertFalse(status['allRunning'])
        self.assertTrue(status['sameContainerSet'])
        self.assertEqual(len(status['issues']), 1)
        self.assertNotIn(format(11, '064x'), repr(status))

    def test_completed_initializers_are_tracked_without_becoming_running_services(self):
        expected, completed, states, initializers = capture_non_core(self.capture_fixture(initializers=True), format(0, '064x'))
        self.assertEqual(len(expected), 11); self.assertEqual(len(completed), 3)
        self.assertEqual({state['Config']['Labels']['com.docker.compose.service'] for state in initializers}, INITIALIZERS)
        self.assertTrue(non_core_status(expected, states)['allHealthy'])
        status = initializer_status(completed, initializers)
        self.assertTrue(all(status[key] is True for key in ('sameContainerSet', 'allIdentitiesAndExitStatesUnchanged', 'allSuccessfullyExited')))
        self.assertNotIn('synthetic-initializer-image', repr(status))

    def test_initializer_must_remain_successfully_exited_with_same_identity(self):
        _, completed, _, states = capture_non_core(self.capture_fixture(initializers=True), format(0, '064x'))
        for field, value in [('StartedAt', 'changed-start'), ('FinishedAt', 'changed-finish'), ('ExitCode', 1),
                             ('ExitCode', True), ('ExitCode', False), ('Running', True), ('Paused', True), ('Status', 'created')]:
            changed = copy.deepcopy(states); changed[0]['State'][field] = value
            with self.subTest(field=field, value=value):
                status = initializer_status(completed, changed)
                self.assertFalse(all(status[key] is True for key in ('sameContainerSet', 'allIdentitiesAndExitStatesUnchanged', 'allSuccessfullyExited')))

    def test_fresh_project_enumeration_detects_an_added_runtime_container(self):
        before, _, _, _ = capture_non_core(self.capture_fixture(initializers=True), format(0, '064x'))
        _, _, after, _ = capture_non_core(self.capture_fixture(initializers=True, extra=True), format(0, '064x'))
        self.assertFalse(non_core_status(before, after)['sameContainerSet'])

    def test_initializer_missing_extra_or_duplicate_is_not_preserved(self):
        _, completed, _, states = capture_non_core(self.capture_fixture(initializers=True), format(0, '064x'))
        extra = copy.deepcopy(states[0]); extra['Id'] = format(999, '064x')
        for changed in (states[:-1], states + [extra], states + [states[0]]):
            self.assertFalse(initializer_status(completed, changed)['sameContainerSet'])

    def test_non_core_diagnostics_distinguish_health_from_identity_without_disclosing_values(self):
        expected = {'private-container': ('private-image', 'private-start')}
        state = {'Id': 'private-container', 'Image': 'private-image',
                 'State': {'StartedAt': 'private-start', 'Running': True, 'Paused': False, 'Health': {'Status': 'healthy'}},
                 'Config': {'Labels': {'com.docker.compose.service': 'stack-gateway'}}}
        self.assertTrue(non_core_status(expected, [state])['allHealthy'])
        unhealthy = copy.deepcopy(state); unhealthy['State']['Health']['Status'] = 'unhealthy'
        status = non_core_status(expected, [unhealthy])
        self.assertTrue(status['allImagesAndStartedAtUnchanged']); self.assertFalse(status['allHealthy'])
        self.assertEqual(status['issues'][0]['service'], 'stack-gateway')
        for secret in ('private-container', 'private-image', 'private-start'): self.assertNotIn(secret, repr(status))
        paused = copy.deepcopy(state); paused['State']['Paused'] = True
        self.assertFalse(non_core_status(expected, [paused])['allUnpaused'])
        self.assertTrue(non_core_status(expected, [state])['allUnpaused'])
        changed = copy.deepcopy(state); changed['State']['StartedAt'] = 'different'
        status = non_core_status(expected, [changed])
        self.assertFalse(status['allImagesAndStartedAtUnchanged']); self.assertTrue(status['allHealthy'])

    def test_non_core_diagnostics_refuse_missing_extra_and_duplicate_container_sets(self):
        expected = {'private-container': ('private-image', 'private-start')}
        state = {'Id': 'private-container', 'Image': 'private-image',
                 'State': {'StartedAt': 'private-start', 'Running': True, 'Paused': False, 'Health': {'Status': 'healthy'}}}
        for states in ([], [state, state], [dict(state, Id='different-container')]):
            with self.subTest(count=len(states)):
                self.assertFalse(non_core_status(expected, states)['sameContainerSet'])

    def test_quiet_query_counts_standalone_and_campaign_case_runs_without_campaign_state(self):
        spec = importlib.util.spec_from_file_location('core_return_smoke', pathlib.Path(__file__).with_name('stack-core-return-smoke.py'))
        smoke = importlib.util.module_from_spec(spec); spec.loader.exec_module(smoke)
        with sqlite3.connect(':memory:') as database:
            database.executescript("CREATE TABLE stack_runs(id TEXT PRIMARY KEY,state TEXT);"
                                  "CREATE TABLE stack_run_results(run_id TEXT PRIMARY KEY,state TEXT);"
                                  "CREATE TABLE stack_campaigns(id TEXT PRIMARY KEY);"
                                  "CREATE TABLE stack_campaign_cases(campaign_id TEXT,run_id TEXT);"
                                  "INSERT INTO stack_runs VALUES('standalone','queued'),('child','queued'),('finished','queued'),('failed','queued');"
                                  "INSERT INTO stack_run_results VALUES('finished','succeeded'),('failed','failed');"
                                  "INSERT INTO stack_campaigns VALUES('campaign');"
                                  "INSERT INTO stack_campaign_cases VALUES('campaign','child');")
            self.assertEqual(database.execute(smoke.PENDING_RUNS_SQL).fetchone()[0], 2)
            database.execute("INSERT INTO stack_run_results VALUES('standalone','succeeded')")
            self.assertEqual(database.execute(smoke.PENDING_RUNS_SQL).fetchone()[0], 1)
            database.execute("INSERT INTO stack_run_results VALUES('child','failed')")
            self.assertEqual(database.execute(smoke.PENDING_RUNS_SQL).fetchone()[0], 0)
            self.assertEqual(database.execute("SELECT count(*) FROM stack_runs WHERE state='queued'").fetchone()[0], 4)

    def test_hosted_guard_requires_exact_workspace_repository_and_nonroot_hosted_runner(self):
        root = pathlib.Path(__file__).resolve().parent.parent
        env = {'CI': 'true', 'GITHUB_ACTIONS': 'true', 'RUNNER_ENVIRONMENT': 'github-hosted',
               'GITHUB_REPOSITORY': 'automaster5013/AgentTrust', 'GITHUB_WORKSPACE': str(root)}
        with patch.object(guard, 'os', types.SimpleNamespace(name='posix', getuid=lambda: 1000, environ=env)):
            guard.require_hosted(root, env)
            for name, value in [('CI', 'false'), ('RUNNER_ENVIRONMENT', 'self-hosted'),
                                ('GITHUB_REPOSITORY', 'other/repo'), ('GITHUB_WORKSPACE', str(root.parent))]:
                with self.subTest(name=name), self.assertRaises(ValueError):
                    guard.require_hosted(root, dict(env, **{name: value}))
        with patch.object(guard, 'os', types.SimpleNamespace(name='posix', getuid=lambda: 0, environ=env)):
            with self.assertRaises(ValueError): guard.require_hosted(root, env)


if __name__ == '__main__':
    unittest.main()
